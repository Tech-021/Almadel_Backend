const fs = require("fs");
const path = require("path");

const { loadStressEnv, assertStressEnvironment, assertConnectedStressDatabase } = require("./lib/safety");
loadStressEnv();
assertStressEnvironment();
process.env.ENABLE_REDIS = "false";

const { ensureDir, loadConfig, ROOT } = require("./lib/config");
const { appSnapshot, gitRevision, postgresSnapshot } = require("./lib/monitor");
const { runAcidSuite } = require("./suites/acid");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function writeAcidReport(dir, report) {
  const suite = report.suites.acid;
  const lines = [];
  lines.push(`# Almadel dedicated ACID report ${report.id}`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`- Scenario: **${suite.scenario}**`);
  lines.push(`- ACID checks: **${suite.summary.acidPass}/${suite.summary.acidTotal} PASS**`);
  if (suite.summary.acidFail) lines.push(`- Failures: **${suite.summary.acidFail}**`);
  lines.push(
    `- Table coverage: **${suite.coverage.coveredCount}/${suite.coverage.totalTables}** application tables touched`,
  );
  lines.push("- Direct database tests on `almadel_stress` (not HTTP API load).");
  lines.push("");
  lines.push("## Environment");
  lines.push("");
  lines.push(`- Date: ${report.startedAt}`);
  lines.push(`- Profile: ${report.profile}`);
  lines.push(`- Git: ${report.git}`);
  lines.push(`- Node: ${report.app?.node}`);
  lines.push(`- Host: ${report.app?.host}`);
  lines.push(`- PostgreSQL: ${report.database?.version || "unavailable"}`);
  lines.push(`- Worst-case business id: ${suite.businessId}`);
  lines.push("");
  lines.push("## Results by principle");
  lines.push("");
  lines.push("| Principle | Pass | Fail | Total |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const p of suite.byPrinciple) {
    lines.push(`| ${p.principle} | ${p.pass} | ${p.fail} | ${p.total} |`);
  }
  lines.push("");
  lines.push("## Detailed ACID results");
  lines.push("");
  lines.push("| Principle | Test | Tables | Expected | Actual | Result |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of suite.acid) {
    lines.push(
      `| ${row.principle} | ${row.test} | ${(row.tables || []).join(", ")} | ${String(row.expected).replaceAll("|", "/")} | ${String(row.actual).replaceAll("|", "/")} | ${row.result} |`,
    );
  }
  lines.push("");
  lines.push("## Table coverage");
  lines.push("");
  lines.push("| Table | Covered in this run |");
  lines.push("| --- | --- |");
  for (const t of suite.coverage.tables) {
    lines.push(`| ${t.table} | ${t.covered ? "yes" : "no"} |`);
  }
  if (suite.integrity?.length) {
    lines.push("");
    lines.push("## Inventory correctness (isolation)");
    lines.push("");
    lines.push("| Test | Initial | Successful | Failed | Expected | Actual | Result |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const row of suite.integrity) {
      lines.push(
        `| ${row.test} | ${row.initial} | ${row.successful} | ${row.failed} | ${row.expected} | ${row.actual} | ${row.result} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- **Atomicity:** multi-write transactions forced to fail must leave zero partial rows.");
  lines.push("- **Consistency:** unique keys, foreign keys, owner delete restrict, and stock oversell guards.");
  lines.push("- **Isolation:** concurrent conditional stock decrements must keep exact inventory.");
  lines.push("- **Durability:** committed rows remain visible via a fresh SQL read.");
  lines.push("- `_prisma_migrations` is intentionally excluded (tooling table).");
  lines.push("");

  const md = lines.join("\n");
  fs.writeFileSync(path.join(dir, "report.md"), md);
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(dir, "report.html"),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(report.id)}</title>
<style>body{font-family:Georgia,serif;max-width:1000px;margin:32px auto;line-height:1.45;padding:0 16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d9e2ec;padding:6px 8px;text-align:left}th{background:#f0f4f8}</style>
</head><body><pre style="white-space:pre-wrap;font-family:inherit">${md
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</pre></body></html>\n`,
  );
}

async function main() {
  const config = loadConfig(["--suite", "database", ...process.argv.slice(2)]);
  const { prisma, resetPrismaClient } = require("../db");
  await resetPrismaClient();
  await assertConnectedStressDatabase(prisma);

  const runId = `stress-db-acid-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const dir = ensureDir(path.join(config.root || ROOT, "stress", "results", runId));

  const report = {
    id: runId,
    kind: "database-acid",
    startedAt: new Date().toISOString(),
    profile: config.profileName,
    suites: {},
  };

  try {
    report.git = await gitRevision(ROOT);
    report.app = await appSnapshot();
    report.database = await postgresSnapshot(prisma);

    console.log(`\nRunning dedicated ACID suite (${config.profileName})`);
    report.suites.acid = await runAcidSuite(config);
    report.finishedAt = new Date().toISOString();
    writeAcidReport(dir, report);

    const s = report.suites.acid.summary;
    console.log(`\nACID report written to ${dir}`);
    console.log(`ACID: ${s.acidPass}/${s.acidTotal} PASS`);
    console.log(
      `Table coverage: ${report.suites.acid.coverage.coveredCount}/${report.suites.acid.coverage.totalTables}`,
    );
    if (s.acidFail) process.exitCode = 1;
  } catch (error) {
    report.fatal = error.message || String(error);
    report.finishedAt = new Date().toISOString();
    try {
      fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(dir, "report.md"), `# Failed\n\n${report.fatal}\n`);
    } catch {
      // ignore
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
