const fs = require("fs");
const path = require("path");

const { loadStressEnv, assertStressEnvironment, assertConnectedStressDatabase } = require("./lib/safety");
loadStressEnv();
assertStressEnvironment();

const { ensureDir, loadConfig, ROOT } = require("./lib/config");
const { assertApiUsesStressDatabase } = require("./lib/anchor");
const { appSnapshot, gitRevision, postgresSnapshot } = require("./lib/monitor");
const {
  runFrontendPathSuite,
  runHighConcurrencySuite,
  runHistorySuite,
  runImageCatalogSuite,
  runListGrowthSuite,
  writeGapReport,
} = require("./suites/gaps");

function combineGapReports(outDir, reports) {
  const lines = [];
  lines.push("# Almadel Combined Gap Scalability Report");
  lines.push(`**Report ID:** ${path.basename(outDir)}`);
  lines.push("");
  lines.push("## 1. Purpose");
  lines.push("");
  lines.push(
    "This report closes the gaps called out after the earlier standard API and database-scale runs. Each gap was tested separately, with its own human-readable report, then merged here.",
  );
  lines.push("");
  lines.push("## 2. Bottom line for leadership");
  lines.push("");
  const allStages = reports.flatMap((report) => report.suite.stages || []);
  const fails = allStages.filter((stage) => stage.grade === "FAIL").length;
  const warnings = allStages.filter((stage) => stage.grade === "WARNING").length;
  if (fails) {
    lines.push(`**Attention needed.** Across all gap suites there were **${fails} FAIL** and **${warnings} WARNING** stages.`);
  } else if (warnings) {
    lines.push(`**Mostly stable with warnings.** **${warnings} WARNING** stages and **0 FAIL**.`);
  } else {
    lines.push("**PASS.** All gap suites stayed inside pass thresholds for the measured stages.");
  }
  lines.push("");
  lines.push("These tests specifically cover: hundreds of concurrent users, large sale/activity history, image-heavy catalogs, unbounded list-endpoint growth, and frontend/network-path measurements.");
  lines.push("");
  lines.push("## 3. Individual gap findings");
  lines.push("");
  for (const report of reports) {
    lines.push(`### ${report.title}`);
    lines.push("");
    lines.push(report.bottomLineExtra || report.explain.split("\n")[0]);
    lines.push("");
    lines.push(`Full detail: \`${path.relative(ROOT, report.dir)}/report.md\``);
    lines.push("");
  }
  lines.push("## 4. What is now proven");
  lines.push("");
  lines.push("- Concurrent user behavior was measured at hundreds of simultaneous clients against key read and mixed endpoints.");
  lines.push("- Dashboard/sales behavior was measured after seeding a multi-week-style sale and activity history.");
  lines.push("- Product catalogs with uploaded images were exercised, including list payload size.");
  lines.push("- Large-tenant list endpoints were measured for latency and response size under concurrent reads.");
  lines.push("- Public frontend document load and a client-perceived API session chain were measured.");
  lines.push("");
  lines.push("## 5. Remaining caveats");
  lines.push("");
  lines.push("- The public Vercel frontend is not pointed at `almadel_stress`, so authenticated UI clicks against the stress database were simulated as an API client session chain.");
  lines.push("- Image uploads used small synthetic PNG files to measure endpoint and payload behavior without filling the disk with megabyte photos.");
  lines.push("- Sale history was synthetic and concentrated on the worst-case stress tenant.");
  lines.push("");
  const md = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(outDir, "report.md"), md);
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ kind: "gap-combined", reports: reports.map((r) => ({ id: r.id, title: r.title, dir: r.dir })) }, null, 2));
  fs.writeFileSync(
    path.join(outDir, "report.html"),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>gap-combined</title>
<style>body{font-family:Georgia,serif;max-width:920px;margin:40px auto;padding:0 20px;line-height:1.55}</style>
</head><body><pre style="white-space:pre-wrap;font-family:inherit">${md
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</pre></body></html>`,
  );
}

async function main() {
  const config = loadConfig(["--profile", process.env.STRESS_PROFILE || "standard", ...process.argv.slice(2)]);
  const { prisma, resetPrismaClient } = require("../db");
  await resetPrismaClient();
  const connectedDatabase = await assertConnectedStressDatabase(prisma);

  await assertApiUsesStressDatabase(config, prisma);

  const batchId = `gap-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const batchDir = ensureDir(path.join(ROOT, "stress", "results", batchId));
  const meta = {
    id: batchId,
    startedAt: new Date().toISOString(),
    profile: config.profileName,
    connectedDatabase,
    git: await gitRevision(ROOT),
    app: await appSnapshot(),
    database: await postgresSnapshot(prisma),
  };
  console.log(`Connected database: ${connectedDatabase}`);

  const reports = [];

  const jobs = [
    {
      key: "high-concurrency",
      title: "Hundreds of concurrent users",
      purpose:
        "Measure absolute request-handling capacity at hundreds of concurrent clients. This closes the earlier gap where only lower concurrency baselines existed.",
      whatWasTested:
        "Concurrent GET traffic against health, products, staff, dashboard, and business list, plus mixed search/stock bursts at 100 / 200 / 300 concurrent users (or until stop thresholds).",
      explain:
        "If p95 or errors climb sharply between 100 and 300 concurrent users, that is the practical concurrency ceiling for those endpoints on this server size. Inventory and list endpoints that return large payloads usually degrade first.",
      bottomLineExtra: "This is request scalability under many simultaneous clients, not database row-growth scalability.",
      run: () => runHighConcurrencySuite(config),
    },
    {
      key: "history",
      title: "Large sale and activity history",
      purpose:
        "Measure application behavior after the tenant already has weeks of sales-like history, not only an empty transaction log.",
      whatWasTested:
        "Synthetic sales, payments, and activity logs were inserted for the worst-case stress business. Then sales list and dashboard endpoints were read under concurrent load.",
      explain:
        "A system can look fast on empty history and slow once invoices accumulate. This suite checks whether sales/dashboard paths remain usable after thousands of historical sales.",
      bottomLineExtra: "History volume was seeded directly for speed, then measured through real HTTP read endpoints.",
      run: () => runHistorySuite(config),
    },
    {
      key: "images",
      title: "Image-heavy product catalog",
      purpose:
        "Measure create/list behavior when products carry image URLs and the image upload endpoint is exercised.",
      whatWasTested:
        "Repeated `POST /products/images` uploads, product creates with imageUrl, and a full product list to capture response payload size.",
      explain:
        "Image catalogs increase storage I/O and list payload size. Even with small synthetic PNGs, this shows whether upload and list paths remain healthy as imaged products grow.",
      bottomLineExtra: "Uploads used tiny PNG fixtures so the test measures endpoint scalability without filling disk with large photos.",
      run: () => runImageCatalogSuite(config),
    },
    {
      key: "list-growth",
      title: "Unbounded list endpoint growth",
      purpose:
        "Prove whether full-collection list endpoints remain usable on the large tenant under concurrent reads, and capture response sizes.",
      whatWasTested:
        "Concurrent reads of products, staff, my-businesses, dashboard, and paginated sales against the large stress tenant.",
      explain:
        "Endpoints without pagination return more bytes as the tenant grows. This suite makes that risk visible with latency and byte measurements your lead can compare.",
      bottomLineExtra: "Sales listing is paginated; products and staff lists currently are not.",
      run: () => runListGrowthSuite(config),
    },
    {
      key: "frontend",
      title: "Frontend network path and client session",
      purpose:
        "Measure end-user-facing network path timing for the public Almadel web app plus a client-perceived API session chain against the stress API.",
      whatWasTested:
        "Document loads for the public Vercel frontend, and a browser-equivalent session chain (health + authenticated product/staff reads) against the local stress API.",
      explain:
        "Backend-only numbers miss CDN/frontend latency. This suite adds that layer, while being explicit that the public frontend is not wired to the stress database.",
      bottomLineExtra: "Authenticated UI against almadel_stress was simulated via API client session because Vercel still targets the normal API.",
      run: () => runFrontendPathSuite(config),
    },
  ];

  try {
    for (const job of jobs) {
      console.log(`\n=== Running gap suite: ${job.key} ===`);
      const suite = await job.run();
      const id = `${batchId}-${job.key}`;
      const dir = ensureDir(path.join(batchDir, job.key));
      const report = {
        id,
        title: job.title,
        purpose: job.purpose,
        whatWasTested: job.whatWasTested,
        explain: job.explain,
        bottomLineExtra: job.bottomLineExtra,
        suite,
        dir,
        meta,
      };
      writeGapReport(dir, report);
      reports.push(report);
      console.log(`Wrote ${dir}/report.md`);
    }

    combineGapReports(batchDir, reports);
    fs.writeFileSync(path.join(batchDir, "batch-summary.json"), JSON.stringify({ ...meta, finishedAt: new Date().toISOString(), children: reports.map((r) => r.id) }, null, 2));
    console.log(`\nCombined gap report: ${batchDir}/report.md`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
