const { PASSWORD } = require("../lib/constants");
const { phoneFor } = require("../lib/anchor");
const { requestJson } = require("../lib/http");
const { gradeStage, summarizeSamples } = require("../lib/metrics");
const { productBody } = require("./products");

const MIX = [
  { name: "product-read", weight: 40 },
  { name: "product-search", weight: 15 },
  { name: "stock-read", weight: 10 },
  { name: "stock-update", weight: 10 },
  { name: "team-read", weight: 10 },
  { name: "business-read", weight: 5 },
  { name: "product-create", weight: 5 },
  { name: "team-create", weight: 3 },
  { name: "business-create", weight: 2 },
];

function pick(sequence) {
  const total = MIX.reduce((sum, item) => sum + item.weight, 0);
  let cursor = sequence % total;
  for (const item of MIX) {
    if (cursor < item.weight) return item.name;
    cursor -= item.weight;
  }
  return MIX[0].name;
}

async function runMixedSuite(config, anchor, runSalt) {
  const stages = [];
  let aborted = null;
  let sequence = 1;
  let barcode = null;

  const search = await requestJson(config, {
    method: "GET",
    path: "/products/search?q=Loadtest",
    token: anchor.token,
    businessId: anchor.businessId,
  });
  barcode = search.json?.products?.[0]?.barcode || null;
  if (!barcode) {
    const body = productBody(runSalt, 1, 50);
    const created = await requestJson(config, {
      method: "POST",
      path: "/products",
      token: anchor.token,
      businessId: anchor.businessId,
      body,
    });
    barcode = created.json?.barcode || null;
  }

  for (const concurrency of config.profile.mixedConcurrency) {
    const samples = [];
    const deadline = Date.now() + config.profile.mixedSeconds * 1000;
    let stopReason = null;

    async function worker() {
      while (Date.now() < deadline && !stopReason) {
        const current = sequence;
        sequence += 1;
        const kind = pick(current);
        const sample = await execute(config, anchor, runSalt, kind, current, barcode);
        sample.kind = kind;
        samples.push(sample);
        if (samples.length >= 20 && samples.length % 25 === 0) {
          const failed = samples.filter((entry) => !entry.ok).length;
          if (failed / samples.length > config.maxErrorRate) {
            stopReason = `error rate exceeded ${config.maxErrorRate}`;
          }
        }
      }
    }

    const started = performance.now();
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const summary = summarizeSamples(samples, {
      test: "mixed",
      scenario: "Realistic mixed traffic on one existing business. Creates stay inside this timed stage.",
      concurrency,
      elapsedMs: performance.now() - started,
      seconds: config.profile.mixedSeconds,
      mix: MIX,
    });
    summary.grade = gradeStage(summary, config);
    summary.byKind = {};
    for (const item of MIX) {
      summary.byKind[item.name] = summarizeSamples(samples.filter((sample) => sample.kind === item.name));
    }
    stages.push(summary);

    if (stopReason || summary.latency.p95Ms > config.maxP95Ms || summary.errorRate > config.maxErrorRate) {
      aborted = {
        test: "mixed",
        stage: `${concurrency} users`,
        concurrency,
        requestsPerSecond: summary.requestsPerSecond,
        errorRate: summary.errorRate,
        p95Ms: summary.latency.p95Ms,
        p99Ms: summary.latency.p99Ms,
        reason: stopReason || `p95 or error threshold exceeded`,
        dominantErrors: summary.errorGroups,
        at: new Date().toISOString(),
      };
      break;
    }
  }

  return { stages, aborted };
}

async function execute(config, anchor, runSalt, kind, sequence, barcode) {
  if (kind === "product-read" || kind === "stock-read") {
    return requestJson(config, {
      method: "GET",
      path: "/products",
      token: anchor.token,
      businessId: anchor.businessId,
    });
  }
  if (kind === "product-search") {
    return requestJson(config, {
      method: "GET",
      path: "/products/search?q=Loadtest",
      token: anchor.token,
      businessId: anchor.businessId,
    });
  }
  if (kind === "stock-update" && barcode) {
    return requestJson(config, {
      method: "POST",
      path: "/stock/add",
      token: anchor.token,
      businessId: anchor.businessId,
      body: { barcode, quantity: 1, note: "mixed workload" },
    });
  }
  if (kind === "team-read") {
    return requestJson(config, {
      method: "GET",
      path: "/admin/staff",
      token: anchor.token,
      businessId: anchor.businessId,
    });
  }
  if (kind === "business-read") {
    return requestJson(config, {
      method: "GET",
      path: "/business/my-businesses",
      token: anchor.token,
    });
  }
  if (kind === "product-create") {
    return requestJson(config, {
      method: "POST",
      path: "/products",
      token: anchor.token,
      businessId: anchor.businessId,
      body: productBody(runSalt, 500000 + sequence, 0),
    });
  }
  if (kind === "team-create") {
    const role = sequence % 2 === 0 ? "accountant" : "staff";
    return requestJson(config, {
      method: "POST",
      path: "/admin/staff",
      token: anchor.token,
      businessId: anchor.businessId,
      body: {
        email: `loadtest_mixed_${role}_${runSalt}_${sequence}@example.test`,
        password: PASSWORD,
        fullName: `Loadtest mixed ${role} ${sequence}`,
        role,
      },
    });
  }
  const email = `loadtest_mixed_business_${runSalt}_${sequence}@example.test`;
  const signup = await requestJson(config, {
    method: "POST",
    path: "/auth/sign-up",
    body: { email, password: PASSWORD, fullName: `Loadtest Mixed Owner ${sequence}` },
  });
  if (!signup.ok) return signup;
  return requestJson(config, {
    method: "POST",
    path: "/business/setup",
    token: signup.json.token,
    body: {
      name: `loadtest_mixed_business_${runSalt}_${sequence}`,
      mobileNumber: phoneFor(runSalt + 17, sequence),
      businessType: "Mobile Shop",
    },
  });
}

module.exports = { runMixedSuite };
