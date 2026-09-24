const fs = require("fs");
const path = require("path");
const { summarizeSamples, gradeStage } = require("../lib/metrics");
const { requestJson, runPool } = require("../lib/http");
const { ensureAnchor, signIn } = require("../lib/anchor");
const { SEED_OWNER_EMAIL, WORST_CASE_BUSINESS, PASSWORD } = require("../lib/constants");
const { productBody } = require("./products");

function prisma() {
  return require("../../db").prisma;
}

async function seedOwnerSession(config) {
  const business = await prisma().business.findFirst({ where: { name: WORST_CASE_BUSINESS } });
  if (!business) throw new Error("Worst-case business missing. Run stress:db:scale or seed team/products first.");
  const session = await signIn(config, SEED_OWNER_EMAIL);
  return { token: session.token, businessId: business.id, email: SEED_OWNER_EMAIL };
}

async function concurrentGet(config, auth, pathName, concurrency, iterations = 1) {
  const samples = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let i = 0; i < iterations; i += 1) {
        const sample = await requestJson(config, {
          method: "GET",
          path: pathName,
          token: auth.token,
          businessId: auth.businessId,
        });
        samples.push(sample);
      }
    }),
  );
  const summary = summarizeSamples(samples, {
    test: `GET ${pathName}`,
    concurrency,
    elapsedMs: performance.now() - started,
    rowsReturned: Array.isArray(samples[0]?.json)
      ? samples[0].json.length
      : samples[0]?.json?.staff?.length ?? samples[0]?.json?.products?.length ?? samples[0]?.json?.sales?.length ?? null,
    responseBytes: samples[0]?.bytes ?? 0,
  });
  summary.grade = gradeStage(summary, config);
  return summary;
}

async function runHighConcurrencySuite(config) {
  const auth = await ensureAnchor(config);
  const levels = config.profileName === "heavy" ? [100, 200, 500] : [100, 200, 300];
  const stages = [];
  const stops = [];

  for (const concurrency of levels) {
    console.log(`high-concurrency level ${concurrency}`);
    for (const pathName of ["/health", "/products", "/admin/staff", "/dashboard", "/business/my-businesses"]) {
      const requiresAuth = pathName !== "/health";
      const samples = [];
      const started = performance.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const sample = pathName === "/health"
            ? await requestJson(config, { path: "/health" })
            : await requestJson(config, {
                method: "GET",
                path: pathName,
                token: auth.token,
                businessId: auth.businessId,
              });
          samples.push(sample);
        }),
      );
      const summary = summarizeSamples(samples, {
        test: `high-concurrency ${pathName}`,
        endpoint: pathName,
        concurrency,
        elapsedMs: performance.now() - started,
        responseBytes: samples[0]?.bytes ?? 0,
      });
      summary.grade = gradeStage(summary, config);
      stages.push(summary);
    }

    // mixed burst: product search + stock add if barcode exists
    const search = await requestJson(config, {
      method: "GET",
      path: "/products/search?q=Loadtest",
      token: auth.token,
      businessId: auth.businessId,
    });
    const barcode = search.json?.products?.[0]?.barcode;
    const mixedSamples = [];
    const mixedStarted = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async (_, index) => {
        if (index % 5 === 0 && barcode) {
          mixedSamples.push(
            await requestJson(config, {
              method: "POST",
              path: "/stock/add",
              token: auth.token,
              businessId: auth.businessId,
              body: { barcode, quantity: 1, note: "high concurrency" },
            }),
          );
        } else {
          mixedSamples.push(
            await requestJson(config, {
              method: "GET",
              path: "/products/search?q=Loadtest",
              token: auth.token,
              businessId: auth.businessId,
            }),
          );
        }
      }),
    );
    const mixed = summarizeSamples(mixedSamples, {
      test: "high-concurrency mixed burst",
      concurrency,
      elapsedMs: performance.now() - mixedStarted,
    });
    mixed.grade = gradeStage(mixed, config);
    stages.push(mixed);

    if (mixed.errorRate > config.maxErrorRate || mixed.latency.p95Ms > config.maxP95Ms) {
      stops.push({
        test: "high-concurrency",
        stage: String(concurrency),
        concurrency,
        reason: mixed.errorRate > config.maxErrorRate ? "error rate" : "p95",
        p95Ms: mixed.latency.p95Ms,
        errorRate: mixed.errorRate,
        at: new Date().toISOString(),
      });
      break;
    }
  }

  return { kind: "gap-high-concurrency", stages, stops, scenario: "Hundreds of concurrent API users" };
}

async function seedSaleHistory(businessId, userId, target) {
  const existing = await prisma().sale.count({ where: { businessId } });
  const needed = Math.max(0, target - existing);
  if (needed === 0) return existing;

  const product = await prisma().product.findFirst({
    where: { businessId, barcode: { startsWith: "STRESS-P-" } },
  });
  if (!product) throw new Error("Need STRESS-P products before sale-history seed.");

  const account = await prisma().account.upsert({
    where: { businessId_name: { businessId, name: "Cash in hand" } },
    update: {},
    create: { businessId, name: "Cash in hand", type: "cash" },
  });

  const batch = 100;
  for (let offset = 0; offset < needed; offset += batch) {
    const count = Math.min(batch, needed - offset);
    const saleRows = Array.from({ length: count }, (_, i) => {
      const sequence = existing + offset + i + 1;
      const daysAgo = sequence % 60;
      const occurredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      const amount = 15 + (sequence % 40);
      return {
        businessId,
        invoiceNumber: `STRESS-HIST-${String(sequence).padStart(7, "0")}`,
        subtotal: amount,
        totalAmount: amount,
        totalItems: 1,
        paymentMethod: "cash",
        discountType: "none",
        discountValue: 0,
        discountAmount: 0,
        userId,
        createdAt: occurredAt,
        amount,
        occurredAt,
      };
    });

    await prisma().sale.createMany({
      data: saleRows.map(({ amount, occurredAt, ...sale }) => sale),
      skipDuplicates: true,
    });

    const created = await prisma().sale.findMany({
      where: {
        businessId,
        invoiceNumber: { in: saleRows.map((row) => row.invoiceNumber) },
      },
      select: { id: true, invoiceNumber: true, totalAmount: true, createdAt: true },
    });
    const byInvoice = new Map(created.map((row) => [row.invoiceNumber, row]));

    await prisma().saleItem.createMany({
      data: saleRows.map((row) => {
        const sale = byInvoice.get(row.invoiceNumber);
        return {
          saleId: sale.id,
          productId: product.id,
          barcode: product.barcode,
          name: product.name,
          price: row.amount,
          quantity: 1,
          total: row.amount,
        };
      }),
    });

    await prisma().payment.createMany({
      data: saleRows.map((row) => {
        const sale = byInvoice.get(row.invoiceNumber);
        return {
          businessId,
          accountId: account.id,
          saleId: sale.id,
          amount: row.amount,
          type: "sale",
          method: "cash",
          createdById: userId,
          occurredAt: row.occurredAt,
        };
      }),
    });

    await prisma().activityLog.createMany({
      data: saleRows.map((row) => ({
        businessId,
        action: "SALE",
        category: "Sales",
        details: `Stress history sale ${row.invoiceNumber}`,
        target: row.invoiceNumber,
        userId,
        userName: "Stress Seed Owner",
        userEmail: SEED_OWNER_EMAIL,
        userRole: "admin",
        timestamp: row.occurredAt,
      })),
    });

    console.log(`sale-history: ${Math.min(existing + offset + count, target)}/${target}`);
  }
  return prisma().sale.count({ where: { businessId } });
}

async function runHistorySuite(config) {
  const auth = await seedOwnerSession(config);
  const owner = await prisma().user.findUnique({ where: { email: SEED_OWNER_EMAIL } });
  const target = config.profileName === "smoke" ? 200 : 3000;
  const sales = await seedSaleHistory(auth.businessId, owner.id, target);
  const stages = [];
  for (const concurrency of [1, 10, 50, 100].filter((n) => n <= Math.max(config.profile.maxConcurrency, 100))) {
    stages.push(await concurrentGet(config, auth, "/sales?page=1&limit=25", concurrency));
    stages.push(await concurrentGet(config, auth, "/dashboard", concurrency));
    stages.push(await concurrentGet(config, auth, "/logs", concurrency));
  }
  return {
    kind: "gap-history",
    scenario: "Large sale/activity history (simulated weeks of traffic)",
    sales,
    stages: stages.filter((stage) => stage.requests > 0),
    stops: [],
  };
}

function tinyPng() {
  // 1x1 PNG
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function uploadImage(config, auth) {
  const form = new FormData();
  form.append("image", new Blob([tinyPng()], { type: "image/png" }), "stress.png");
  const started = performance.now();
  try {
    const response = await fetch(`${config.baseUrl}/products/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "x-business-id": String(auth.businessId),
      },
      body: form,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      latencyMs: performance.now() - started,
      bytes: Buffer.byteLength(text),
      json,
      errorClass: response.ok ? null : "http",
      errorMessage: json?.message || text.slice(0, 200),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: performance.now() - started,
      bytes: 0,
      json: null,
      errorClass: "network",
      errorMessage: error.message,
    };
  }
}

async function runImageCatalogSuite(config) {
  const auth = await ensureAnchor(config);
  const count = config.profileName === "smoke" ? 20 : 200;
  const uploadSamples = [];
  const createSamples = [];
  const runSalt = Number(String(Date.now()).slice(-4));

  for (let i = 1; i <= count; i += 1) {
    const upload = await uploadImage(config, auth);
    uploadSamples.push(upload);
    const body = productBody(runSalt, 800000 + i, 5);
    body.imageUrl = upload.json?.url || null;
    body.name = `Image catalog product ${i}`;
    createSamples.push(
      await requestJson(config, {
        method: "POST",
        path: "/products",
        token: auth.token,
        businessId: auth.businessId,
        body,
      }),
    );
    if (i % 25 === 0) console.log(`image-catalog: ${i}/${count}`);
  }

  const list = await requestJson(config, {
    method: "GET",
    path: "/products",
    token: auth.token,
    businessId: auth.businessId,
  });
  const withImages = Array.isArray(list.json)
    ? list.json.filter((product) => product.imageUrl).length
    : 0;

  const stages = [
    summarizeSamples(uploadSamples, { test: "image-upload", concurrency: 1 }),
    summarizeSamples(createSamples, { test: "product-create-with-imageUrl", concurrency: 1 }),
    summarizeSamples([list], {
      test: "product-list-image-catalog",
      concurrency: 1,
      responseBytes: list.bytes,
      rowsReturned: Array.isArray(list.json) ? list.json.length : 0,
      productsWithImages: withImages,
    }),
  ];
  for (const stage of stages) stage.grade = gradeStage(stage, config);

  return {
    kind: "gap-images",
    scenario: "Image-heavy product catalog",
    uploaded: uploadSamples.filter((s) => s.ok).length,
    productsCreated: createSamples.filter((s) => s.ok).length,
    listBytes: list.bytes,
    productsWithImages: withImages,
    stages,
    stops: [],
  };
}

async function runListGrowthSuite(config) {
  const auth = await seedOwnerSession(config);
  const endpoints = [
    "/products",
    "/admin/staff",
    "/business/my-businesses",
    "/dashboard",
    "/sales?page=1&limit=25",
  ];
  const stages = [];
  for (const endpoint of endpoints) {
    for (const concurrency of [1, 10, 50]) {
      const summary = await concurrentGet(config, auth, endpoint, concurrency);
      stages.push(summary);
    }
  }
  return {
    kind: "gap-list-growth",
    scenario: "Unbounded list endpoint growth under concurrent read load on the large tenant",
    stages,
    stops: [],
    notes: [
      "GET /products and GET /admin/staff return full collections with no page parameter.",
      "GET /sales is paginated (page/limit).",
      "Response byte sizes in the stage detail show payload growth risk.",
    ],
  };
}

async function runFrontendPathSuite(config) {
  const frontendUrl = process.env.STRESS_FRONTEND_URL || "https://web-app-allmadal.vercel.app";
  const stages = [];
  const paths = ["/", "/login"];
  for (const pagePath of paths) {
    const samples = [];
    for (let i = 0; i < 10; i += 1) {
      const started = performance.now();
      try {
        const response = await fetch(`${frontendUrl}${pagePath}`, {
          redirect: "follow",
          signal: AbortSignal.timeout(config.timeoutMs),
          headers: { "User-Agent": "AlmadelStressFrontend/1.0" },
        });
        const text = await response.text();
        samples.push({
          ok: response.status >= 200 && response.status < 400,
          status: response.status,
          latencyMs: performance.now() - started,
          bytes: Buffer.byteLength(text),
          errorClass: response.ok ? null : "http",
          errorMessage: "",
        });
      } catch (error) {
        samples.push({
          ok: false,
          status: 0,
          latencyMs: performance.now() - started,
          bytes: 0,
          errorClass: "network",
          errorMessage: error.message,
        });
      }
    }
    const summary = summarizeSamples(samples, {
      test: `frontend ${pagePath}`,
      endpoint: `${frontendUrl}${pagePath}`,
      concurrency: 1,
    });
    summary.grade = gradeStage(summary, config);
    stages.push(summary);
  }

  // Client-perceived API session against stress API (browser-equivalent chain)
  const chainStarted = performance.now();
  const health = await requestJson(config, { path: "/health" });
  const auth = await ensureAnchor(config);
  const products = await requestJson(config, {
    method: "GET",
    path: "/products",
    token: auth.token,
    businessId: auth.businessId,
  });
  const staff = await requestJson(config, {
    method: "GET",
    path: "/admin/staff",
    token: auth.token,
    businessId: auth.businessId,
  });
  const chainMs = Math.round(performance.now() - chainStarted);
  const chain = summarizeSamples([health, products, staff], {
    test: "client session chain against stress API",
    concurrency: 1,
    chainTotalMs: chainMs,
  });
  chain.grade = gradeStage(chain, config);
  stages.push(chain);

  return {
    kind: "gap-frontend",
    scenario: "Frontend network path + client-perceived API session",
    frontendUrl,
    notes: [
      `Public frontend measured at ${frontendUrl}. That deployment may still point at a non-stress API.`,
      "Authenticated page flows against the stress database were simulated as a client session chain directly to the stress API, because the public frontend is not wired to almadel_stress.",
      "Local port 3000 is a different product (tech-021), not the Almadel web app.",
    ],
    stages,
    stops: [],
  };
}

function writeGapReport(dir, report) {
  const lines = [];
  lines.push(`# Almadel Gap Test Report: ${report.title}`);
  lines.push(`**Report ID:** ${report.id}`);
  lines.push("");
  lines.push("## Purpose");
  lines.push("");
  lines.push(report.purpose);
  lines.push("");
  lines.push("## Bottom line");
  lines.push("");
  const stages = report.suite.stages || [];
  const fails = stages.filter((stage) => stage.grade === "FAIL").length;
  const warnings = stages.filter((stage) => stage.grade === "WARNING").length;
  const passes = stages.filter((stage) => stage.grade === "PASS").length;
  if (fails) {
    lines.push(`**Attention needed.** ${fails} stage(s) FAILED, ${warnings} WARNING, ${passes} PASS.`);
  } else if (warnings) {
    lines.push(`**Mostly stable with warnings.** ${warnings} WARNING stage(s), ${passes} PASS, 0 FAIL.`);
  } else {
    lines.push(`**PASS.** All ${passes} measured stages stayed inside pass thresholds.`);
  }
  lines.push("");
  lines.push(report.bottomLineExtra || "");
  lines.push("");
  lines.push("## What was tested");
  lines.push("");
  lines.push(report.whatWasTested);
  lines.push("");
  if (report.suite.notes?.length) {
    lines.push("## Notes");
    lines.push("");
    for (const note of report.suite.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  lines.push("## Results");
  lines.push("");
  lines.push("| Stage | Concurrency | Requests | Success | Errors | Avg | P95 | Bytes | Grade |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const stage of stages) {
    lines.push(
      `| ${stage.test || stage.endpoint} | ${stage.concurrency ?? ""} | ${stage.requests} | ${stage.successful} | ${stage.failed} | ${stage.latency?.averageMs ?? ""} | ${stage.latency?.p95Ms ?? ""} | ${stage.responseBytes ?? stage.bytes ?? ""} | ${stage.grade || ""} |`,
    );
  }
  lines.push("");
  if (report.suite.stops?.length) {
    lines.push("## Stop conditions");
    lines.push("");
    for (const stop of report.suite.stops) {
      lines.push(
        `- Stopped at concurrency ${stop.concurrency}: ${stop.reason} (p95 ${stop.p95Ms} ms, error rate ${stop.errorRate}).`,
      );
    }
    lines.push("");
  }
  lines.push("## How to explain this to your lead");
  lines.push("");
  lines.push(report.explain);
  lines.push("");
  const md = `${lines.join("\n")}\n`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), md);
  fs.writeFileSync(
    path.join(dir, "report.html"),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report.id}</title>
<style>body{font-family:Georgia,serif;max-width:920px;margin:40px auto;padding:0 20px;line-height:1.55}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d9e2ec;padding:8px}th{background:#f0f4f8}</style>
</head><body><pre style="white-space:pre-wrap;font-family:inherit">${md
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</pre></body></html>`,
  );
}

module.exports = {
  runFrontendPathSuite,
  runHighConcurrencySuite,
  runHistorySuite,
  runImageCatalogSuite,
  runListGrowthSuite,
  writeGapReport,
};
