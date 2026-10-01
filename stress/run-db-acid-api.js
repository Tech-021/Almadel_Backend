const fs = require("fs");
const path = require("path");

const { loadStressEnv, assertStressEnvironment, assertConnectedStressDatabase } = require("./lib/safety");
loadStressEnv();
assertStressEnvironment();
// Keep stress runners off Redis even if a later dotenv load re-enables it.
process.env.ENABLE_REDIS = "false";

const { ensureDir, loadConfig, ROOT } = require("./lib/config");
const { appSnapshot, gitRevision, postgresSnapshot } = require("./lib/monitor");
const { runAcidApiSuite } = require("./suites/acid-api");

function writeReport(dir, report) {
  const suite = report.suites.acidApi;
  const lines = [];
  lines.push(`# Almadel API/service ACID report ${report.id}`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`- Scenario: **${suite.scenario}**`);
  lines.push(`- Checks: **${suite.summary.pass}/${suite.summary.total} PASS**`);
  if (suite.summary.fail) lines.push(`- Failures: **${suite.summary.fail}**`);
  lines.push("- Exercises checkout/payment/stock/close service paths (not raw SQL-only).");
  lines.push("");
  lines.push("## Environment");
  lines.push("");
  lines.push(`- Date: ${report.startedAt}`);
  lines.push(`- Profile: ${report.profile}`);
  lines.push(`- Git: ${report.git}`);
  lines.push(`- PostgreSQL: ${report.database?.version || "unavailable"}`);
  lines.push(`- Business id: ${suite.businessId}`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Test | Expected | Actual | Result |");
  lines.push("| --- | --- | --- | --- |");
  for (const c of suite.cases) {
    lines.push(
      `| ${c.test} | ${String(c.expected).replaceAll("|", "/")} | ${String(c.actual).replaceAll("|", "/")} | ${c.result} |`,
    );
  }
  lines.push("");

  const md = lines.join("\n");
  fs.writeFileSync(path.join(dir, "report.md"), md);
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
}

async function main() {
  const config = loadConfig(["--suite", "database", ...process.argv.slice(2)]);
  const db = require("../db");
  await db.resetPrismaClient();
  const prisma = db.prisma;
  await assertConnectedStressDatabase(prisma);

  const runId = `stress-db-acid-api-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const dir = ensureDir(path.join(config.root || ROOT, "stress", "results", runId));
  const report = {
    id: runId,
    kind: "database-acid-api",
    startedAt: new Date().toISOString(),
    profile: config.profileName,
    suites: {},
  };

  try {
    report.git = await gitRevision(ROOT);
    report.app = await appSnapshot();
    report.database = await postgresSnapshot(prisma);
    console.log(`\nRunning API/service ACID suite (${config.profileName})`);
    report.suites.acidApi = await runAcidApiSuite(config);
    report.finishedAt = new Date().toISOString();
    writeReport(dir, report);
    const s = report.suites.acidApi.summary;
    console.log(`\nAPI ACID report written to ${dir}`);
    console.log(`API ACID: ${s.pass}/${s.total} PASS`);
    if (s.fail) process.exitCode = 1;
  } catch (error) {
    report.fatal = error.message || String(error);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(dir, "report.md"), `# Failed\n\n${report.fatal}\n`);
    throw error;
  } finally {
    try {
      const { _resetRedisForTests } = require("../utils/redis");
      await _resetRedisForTests();
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
