/**
 * Lead-approved live almadel load: concurrent signup → draft → business activate.
 *
 * Usage:
 *   node stress/run-live-business-load.js --confirm-live-almadel --profile standard
 *
 * Completes onboarding via fulfillOnboardingFromCheckoutSession with a fake
 * completed Stripe session (live has no /billing/stress-complete-onboarding).
 * All emails/names use prefix loadtest_live_ for later cleanup.
 */

const fs = require("fs");
const path = require("path");

function loadLiveEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Skip broken / multi-token lines (e.g. SMTP_FROM with unquoted <...>)
    if (key === "SMTP_FROM") continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Force .env values so a leftover almadel_stress shell env cannot win.
    process.env[key] = value;
  }
  delete process.env.STRESS_TEST;
  if (process.env.NODE_ENV === "stress") {
    process.env.NODE_ENV = "production";
  }
}

function parseArgs(argv) {
  const args = {
    confirm: false,
    profile: "standard",
    baseUrl: "http://127.0.0.1:4001",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--confirm-live-almadel") args.confirm = true;
    else if (t === "--profile") args.profile = argv[++i];
    else if (t === "--base-url") args.baseUrl = argv[++i];
  }
  return args;
}

const PROFILES = {
  smoke: { counts: [10], maxConcurrency: 5 },
  standard: { counts: [100, 500, 1000], maxConcurrency: 100 },
  heavy: { counts: [100, 500, 1000, 5000], maxConcurrency: 200 },
  xlarge: { counts: [100, 500, 1000, 5000, 10000], maxConcurrency: 200 },
};

function concurrencyForStage(index, maxConcurrency) {
  const ramp = [10, 25, 50, 100, 200];
  return Math.max(1, Math.min(ramp[Math.min(index, ramp.length - 1)], maxConcurrency));
}

function phoneFor(salt, sequence) {
  // 03 + 9 digits
  const n = String((Number(salt) * 100000 + sequence) % 1000000000).padStart(9, "0");
  return `03${n}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.confirm) {
    throw new Error(
      "Refusing to load-test live almadel. Re-run with --confirm-live-almadel (lead-approved only).",
    );
  }

  loadLiveEnv();
  const dbUrl = String(process.env.DATABASE_URL || "");
  if (!/\/almadel(\?|$)/.test(dbUrl.replace(/\/almadel_stress/, ""))) {
    // Accept .../almadel or .../almadel?schema=public, reject almadel_stress
  }
  if (dbUrl.includes("almadel_stress")) {
    throw new Error("DATABASE_URL points at almadel_stress. This script is for live almadel only.");
  }
  if (!dbUrl.includes("/almadel")) {
    throw new Error(`DATABASE_URL does not look like live almadel: ${dbUrl.replace(/:[^:@/]+@/, ":***@")}`);
  }

  const profile = PROFILES[args.profile];
  if (!profile) throw new Error(`Unknown profile ${args.profile}`);

  const { requestJson, runPool } = require("./lib/http");
  const { summarizeSamples, gradeStage } = require("./lib/metrics");
  const { PASSWORD } = require("./lib/constants");
  const { resetPrismaClient, prisma } = require("../db");
  const { fulfillOnboardingFromCheckoutSession } = require("../modules/business/onboarding.service");

  await resetPrismaClient();
  const dbName = await prisma.$queryRaw`SELECT current_database() AS name`.then((r) => r[0]?.name);
  if (dbName !== "almadel") {
    throw new Error(`Connected to '${dbName}', expected 'almadel'. Aborting.`);
  }

  const config = {
    baseUrl: args.baseUrl.replace(/\/$/, ""),
    timeoutMs: Number(process.env.LIVE_LOAD_TIMEOUT_MS || 60000),
    maxErrorRate: Number(process.env.LIVE_LOAD_MAX_ERROR_RATE || 0.1),
    // For 5k/10k runs, signup bcrypt makes p95 exceed 5s; override with LIVE_LOAD_MAX_P95_MS.
    maxP95Ms: Number(process.env.LIVE_LOAD_MAX_P95_MS || (args.profile === "xlarge" || args.profile === "heavy" ? 120000 : 5000)),
    // If true, keep ramping even when p95 exceeds maxP95Ms (still stops on high error rate).
    continueOnSlow: args.profile === "xlarge" || process.env.LIVE_LOAD_CONTINUE_ON_SLOW === "true",
  };

  const runId = `live-business-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const runSalt = Number(String(Date.now()).slice(-6));
  const dir = path.join(__dirname, "results", runId);
  fs.mkdirSync(dir, { recursive: true });

  console.log(JSON.stringify({
    warning: "LIVE ALMADEL LOAD TEST",
    database: dbName,
    baseUrl: config.baseUrl,
    profile: args.profile,
    counts: profile.counts,
    prefix: "loadtest_live_",
    runId,
  }, null, 2));

  const stages = [];
  let created = 0;
  let aborted = null;
  const roles = {};

  for (let index = 0; index < profile.counts.length; index += 1) {
    const target = profile.counts[index];
    const needed = target - created;
    if (needed <= 0) continue;
    const concurrency = concurrencyForStage(index, profile.maxConcurrency);
    const items = Array.from({ length: needed }, (_, offset) => created + offset + 1);
    const samples = [];
    let stopReason = null;
    const started = performance.now();

    await runPool(items, concurrency, async (sequence) => {
      if (stopReason) return null;
      const email = `loadtest_live_${runSalt}_${String(sequence).padStart(6, "0")}@example.test`;
      const t0 = performance.now();

      const signup = await requestJson(config, {
        method: "POST",
        path: "/auth/sign-up",
        body: {
          email,
          password: PASSWORD,
          fullName: `Live Load Owner ${sequence}`,
        },
      });
      const signupRole = signup.json?.user?.role || null;
      if (signupRole) roles[signupRole] = (roles[signupRole] || 0) + 1;

      if (!signup.ok) {
        const sample = {
          ...signup,
          latencyMs: performance.now() - t0,
          parts: { signupMs: signup.latencyMs, setupMs: 0, fulfillMs: 0 },
          signupRole,
        };
        samples.push(sample);
        return sample;
      }

      const setup = await requestJson(config, {
        method: "POST",
        path: "/business/setup",
        token: signup.json.token,
        body: {
          name: `loadtest_live_${runSalt}_${String(sequence).padStart(6, "0")}`,
          mobileNumber: phoneFor(runSalt, sequence),
          businessType: "Mobile Shop",
          workspaceMode: "pos",
        },
      });
      if (!setup.ok) {
        const sample = {
          ...setup,
          latencyMs: performance.now() - t0,
          parts: { signupMs: signup.latencyMs, setupMs: setup.latencyMs, fulfillMs: 0 },
          signupRole,
        };
        samples.push(sample);
        return sample;
      }

      const userId = Number(signup.json.user.id);
      const fillStarted = performance.now();
      let fulfillOk = false;
      let fulfillStatus = 201;
      let fulfillError = "";
      let businessId = null;
      try {
        // Omit subscription so fulfill does not call Stripe APIs (avoids rate limits during load).
        const business = await fulfillOnboardingFromCheckoutSession(
          {
            id: `cs_live_load_${userId}_${sequence}`,
            status: "complete",
            payment_status: "paid",
            customer: `cus_live_load_${userId}`,
            client_reference_id: `onboarding-${userId}`,
            metadata: { onboardingUserId: String(userId) },
          },
          userId,
        );
        fulfillOk = Boolean(business?.id);
        businessId = business?.id || null;
        if (!fulfillOk) {
          fulfillStatus = 400;
          fulfillError = "fulfill returned no business";
        }
      } catch (error) {
        fulfillOk = false;
        fulfillStatus = error.status || 500;
        fulfillError = error.message || String(error);
      }
      const fulfillMs = performance.now() - fillStarted;

      const sample = {
        ok: fulfillOk,
        status: fulfillStatus,
        latencyMs: performance.now() - t0,
        bytes: 0,
        json: { businessId },
        errorClass: fulfillOk ? null : "server",
        errorMessage: fulfillError,
        parts: {
          signupMs: signup.latencyMs,
          setupMs: setup.latencyMs,
          fulfillMs,
        },
        signupRole,
        businessId,
      };
      samples.push(sample);

      if (samples.length >= 20 && samples.length % 25 === 0) {
        const failed = samples.filter((s) => !s.ok).length;
        if (failed / samples.length > config.maxErrorRate) {
          stopReason = `error rate exceeded ${config.maxErrorRate}`;
        }
      }
      return sample;
    }, () => Boolean(stopReason));

    const elapsedMs = performance.now() - started;
    const summary = summarizeSamples(samples, {
      test: "live-business-create",
      scenario: "LIVE almadel: signup → draft → fulfill (fake Stripe session).",
      stage: String(target),
      target,
      concurrency,
      elapsedMs,
    });
    const average = (values) =>
      values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
    summary.parts = {
      signupAvgMs: average(samples.map((s) => s.parts?.signupMs || 0)),
      setupAvgMs: average(samples.map((s) => s.parts?.setupMs || 0)),
      fulfillAvgMs: average(samples.map((s) => s.parts?.fulfillMs || 0)),
    };
    summary.grade = gradeStage(summary, config);
    summary.stoppedEarly = Boolean(stopReason);
    stages.push(summary);
    created += summary.successful;

    console.log(
      `stage ${target}: ${summary.successful}/${summary.requests} ok, concurrency ${concurrency}, p95 ${summary.latency.p95Ms}ms, grade ${summary.grade}`,
    );

    const tooSlow = summary.latency.p95Ms > config.maxP95Ms;
    const tooManyErrors = summary.errorRate > config.maxErrorRate || Boolean(stopReason);
    if (tooManyErrors || (tooSlow && !config.continueOnSlow)) {
      aborted = {
        test: "live-business-create",
        stage: String(target),
        concurrency,
        errorRate: summary.errorRate,
        p95Ms: summary.latency.p95Ms,
        reason:
          stopReason ||
          (summary.errorRate > config.maxErrorRate
            ? `error rate ${summary.errorRate}`
            : `p95 ${summary.latency.p95Ms}ms exceeded ${config.maxP95Ms}ms`),
        at: new Date().toISOString(),
      };
      break;
    }
    if (tooSlow && config.continueOnSlow) {
      console.log(
        `stage ${target}: p95 ${summary.latency.p95Ms}ms above ${config.maxP95Ms}ms but continuing (xlarge/continue-on-slow).`,
      );
    }
  }

  const businesses = await prisma.business.count({
    where: { name: { startsWith: `loadtest_live_${runSalt}_` } },
  });
  const users = await prisma.user.count({
    where: { email: { startsWith: `loadtest_live_${runSalt}_` } },
  });

  const report = {
    id: runId,
    kind: "live-business-load",
    database: "almadel",
    baseUrl: config.baseUrl,
    profile: args.profile,
    runSalt,
    prefix: `loadtest_live_${runSalt}_`,
    startedAt: new Date().toISOString(),
    created,
    aborted,
    rolesSeen: roles,
    dataset: { liveLoadBusinesses: businesses, liveLoadUsers: users },
    stages,
    cleanup: `node stress/cleanup-live-loadtest.js --confirm-live-almadel --salt ${runSalt}`,
  };

  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
  const md = [
    `# Live almadel business create load — ${runId}`,
    "",
    "**Lead-approved** concurrent signup → onboarding draft → business activation on live `almadel`.",
    "",
    `- API: ${config.baseUrl}`,
    `- Profile: ${args.profile}`,
    `- Prefix: \`loadtest_live_${runSalt}_\``,
    `- Created (successful fulfills counted): **${created}**`,
    `- DB rows: users=${users}, businesses=${businesses}`,
    `- Signup roles seen: ${JSON.stringify(roles)}`,
    aborted ? `- Stopped early: ${aborted.reason} at stage ${aborted.stage}` : "- Completed without early stop",
    "",
    "## Stages",
    "",
    ...stages.map(
      (s) =>
        `- **${s.stage}** @ ${s.concurrency} conc: ${s.successful}/${s.requests} ok, avg ${s.latency.averageMs}ms, p95 ${s.latency.p95Ms}ms, grade **${s.grade}** (signupAvg ${s.parts?.signupAvgMs}ms, setupAvg ${s.parts?.setupAvgMs}ms, fulfillAvg ${s.parts?.fulfillAvgMs}ms)`,
    ),
    "",
    "## Cleanup",
    "",
    "```bash",
    report.cleanup,
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "report.md"), md);

  console.log(`\nReport: ${dir}`);
  console.log(md);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error.message || error);
  try {
    const { prisma } = require("../db");
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
