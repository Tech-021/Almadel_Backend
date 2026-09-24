const fs = require("fs");
const path = require("path");

// Load stress env before any module that constructs Prisma.
const { loadStressEnv, assertStressEnvironment, assertConnectedStressDatabase } = require("./lib/safety");
loadStressEnv();
assertStressEnvironment();

const { ensureDir, loadConfig, ROOT } = require("./lib/config");
const { appSnapshot, gitRevision, postgresSnapshot } = require("./lib/monitor");
const { runDatabaseScaleSuite } = require("./suites/database-scale");

function parseFresh(argv) {
  return argv.includes("--fresh") || process.env.STRESS_DB_SCALE_FRESH === "true";
}

function curveFor(checkpoints, queryName) {
  return checkpoints.map((checkpoint) => {
    const query = checkpoint.queries.find((row) => row.test === queryName);
    return {
      size: checkpoint.size,
      p95Ms: query?.p95Ms ?? null,
      averageMs: query?.averageMs ?? null,
      grade: query?.grade ?? "n/a",
      rows: query?.rows ?? null,
    };
  });
}

function writeScaleReport(dir, report) {
  const db = report.suites.databaseScale;
  const checkpoints = db.checkpoints || [];
  const lines = [];

  lines.push("# Almadel Database Scalability Report");
  lines.push(`**Report ID:** ${report.id}`);
  lines.push("");
  lines.push("## 1. Purpose");
  lines.push("");
  lines.push(
    "This report measures how database query cost and stock correctness change as Almadel data grows. Unlike a single snapshot against an already-full database, this run grows the stress dataset through checkpoints and measures the same queries at each size. That produces a scalability curve.",
  );
  lines.push("");
  lines.push("## 2. Bottom line");
  lines.push("");
  lines.push(
    `Checkpoints measured: **${db.summary.checkpoints}**. PASS: **${db.summary.pass}**. WARNING: **${db.summary.warning}**. FAIL: **${db.summary.fail}**.`,
  );
  if (db.summary.fail === 0 && db.summary.warning === 0) {
    lines.push("");
    lines.push(
      "Across the measured sizes, query timings stayed inside pass thresholds and concurrent stock decrements remained correct.",
    );
  } else if (db.summary.fail === 0) {
    lines.push("");
    lines.push(
      "No hard failures were recorded, but one or more checkpoints crossed the warning latency band. Those queries are the first candidates for pagination or index review as data continues to grow.",
    );
  } else {
    lines.push("");
    lines.push(
      "At least one checkpoint failed latency or integrity thresholds. Treat that size as the current practical limit for the measured query path until optimized.",
    );
  }
  lines.push("");
  lines.push("## 3. How the test worked");
  lines.push("");
  lines.push(
    "For each checkpoint size, the suite grew businesses, team members, products, and stock logs to that size inside `almadel_stress`, then timed the same Prisma queries and ran a concurrent stock-decrement isolation check. API HTTP load was not part of this report.",
  );
  lines.push("");
  lines.push(`Profile: **${report.profile}**. Worst-case business id: **${db.businessId}**.`);
  lines.push(`Connected database verified at runtime: **${report.connectedDatabase}**.`);
  lines.push("");
  lines.push("## 4. Checkpoint summary");
  lines.push("");
  lines.push("| Size | Businesses | Team | Products | Stock logs | Checkpoint grade | Isolation |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const checkpoint of checkpoints) {
    lines.push(
      `| ${checkpoint.size} | ${checkpoint.counts.businesses} | ${checkpoint.counts.teamMembers} | ${checkpoint.counts.products} | ${checkpoint.counts.stockLogs} | ${checkpoint.grade} | ${checkpoint.isolation.result} (${checkpoint.isolation.concurrency} writers) |`,
    );
  }
  lines.push("");
  lines.push("## 5. Scalability curves");
  lines.push("");
  lines.push(
    "The tables below show how p95 latency changed as row counts increased. Rising p95 with size is expected for unbounded list queries. A sharp jump is more important than a small absolute number.",
  );
  lines.push("");

  const tracked = [
    "list all products",
    "list team members",
    "owner business list",
    "search products",
    "barcode lookup",
    "stock aggregate",
  ];
  for (const name of tracked) {
    const curve = curveFor(checkpoints, name);
    lines.push(`### ${name}`);
    lines.push("");
    lines.push("| Dataset size | Avg | P95 | Rows | Grade |");
    lines.push("| ---: | ---: | ---: | ---: | --- |");
    for (const point of curve) {
      lines.push(
        `| ${point.size} | ${point.averageMs ?? "-"} ms | ${point.p95Ms ?? "-"} ms | ${point.rows ?? ""} | ${point.grade} |`,
      );
    }
    lines.push("");
    if (curve.length >= 2) {
      const first = curve[0];
      const last = curve[curve.length - 1];
      if (first.p95Ms != null && last.p95Ms != null && first.p95Ms > 0) {
        const factor = (last.p95Ms / first.p95Ms).toFixed(1);
        lines.push(
          `From size **${first.size}** to **${last.size}**, p95 moved from **${first.p95Ms} ms** to **${last.p95Ms} ms** (about **${factor}x**).`,
        );
        lines.push("");
      }
    }
  }

  lines.push("## 6. Isolation / inventory correctness during growth");
  lines.push("");
  lines.push(
    "At every checkpoint, many writers decremented the same product using conditional updates. Expected final stock had to equal starting stock minus successful decrements.",
  );
  lines.push("");
  lines.push("| Size | Writers | Successful | Expected stock | Actual stock | Result |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | --- |");
  for (const checkpoint of checkpoints) {
    const iso = checkpoint.isolation;
    lines.push(
      `| ${checkpoint.size} | ${iso.concurrency} | ${iso.successful} | ${iso.expected} | ${iso.actual} | ${iso.result} |`,
    );
  }
  lines.push("");
  lines.push("## 7. What this proves");
  lines.push("");
  lines.push("- Database query cost can be compared across growing dataset sizes.");
  lines.push("- Stock isolation behavior was checked while the tenant was large, not only on a tiny sample.");
  lines.push("- This is not an HTTP concurrency result. Use the API scalability report for request ramps.");
  lines.push("");
  lines.push("## 8. Environment");
  lines.push("");
  lines.push(`- Date: ${report.startedAt}`);
  lines.push(`- PostgreSQL: ${report.database?.version || "n/a"}`);
  lines.push(`- Host: ${report.app?.host || "n/a"}`);
  lines.push(`- Node: ${report.app?.node || "n/a"}`);
  lines.push("");

  const md = `${lines.join("\n")}\n`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), md);
  fs.writeFileSync(
    path.join(dir, "report.html"),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report.id}</title>
<style>body{font-family:Georgia,serif;max-width:920px;margin:40px auto;padding:0 20px;line-height:1.55}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #d9e2ec;padding:8px;text-align:left}th{background:#f0f4f8}</style>
</head><body><pre style="white-space:pre-wrap;font-family:inherit">${md
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</pre></body></html>`,
  );
  fs.writeFileSync(path.join(dir, "database-scale.json"), JSON.stringify(db, null, 2));
}

async function main() {
  const argv = process.argv.slice(2);
  const config = loadConfig(["--suite", "database-scale", ...argv]);
  const fresh = parseFresh(argv);

  const { prisma, resetPrismaClient } = require("../db");
  await resetPrismaClient();
  const connectedDatabase = await assertConnectedStressDatabase(prisma);

  const runId = `stress-db-scale-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const dir = ensureDir(path.join(ROOT, "stress", "results", runId));
  const report = {
    id: runId,
    kind: "database-scale",
    startedAt: new Date().toISOString(),
    profile: config.profileName,
    connectedDatabase,
    suites: {},
  };

  try {
    report.git = await gitRevision(ROOT);
    report.app = await appSnapshot();
    report.database = await postgresSnapshot(prisma);
    console.log(`\nRunning DB scalability checkpoints (${config.profileName})${fresh ? " [fresh]" : ""}`);
    console.log(`Connected database: ${connectedDatabase}`);
    report.suites.databaseScale = await runDatabaseScaleSuite(config, { fresh });
    report.finishedAt = new Date().toISOString();
    writeScaleReport(dir, report);
    console.log(`\nDB scale report written to ${dir}`);
  } catch (error) {
    report.fatal = error.message || String(error);
    report.finishedAt = new Date().toISOString();
    try {
      writeScaleReport(dir, report);
    } catch {}
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
