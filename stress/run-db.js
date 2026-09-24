const fs = require("fs");
const path = require("path");

const { loadStressEnv, assertStressEnvironment, assertConnectedStressDatabase } = require("./lib/safety");
loadStressEnv();
assertStressEnvironment();

const { ensureDir, loadConfig } = require("./lib/config");
const { appSnapshot, gitRevision, postgresSnapshot } = require("./lib/monitor");
const { writeDbReport } = require("./lib/report");
const { runDatabaseSuite } = require("./suites/database");

async function main() {
  const config = loadConfig(["--suite", "database", ...process.argv.slice(2)]);

  const { prisma, resetPrismaClient } = require("../db");
  await resetPrismaClient();
  await assertConnectedStressDatabase(prisma);
  const runId = `stress-db-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const dir = ensureDir(path.join(config.root, "stress", "results", runId));

  const report = {
    id: runId,
    kind: "database",
    startedAt: new Date().toISOString(),
    profile: config.profileName,
    baseUrl: "n/a (direct database)",
    suites: {},
    integrity: [],
    stops: [],
    scenarioNotes: [
      "This report measures ACID behavior and query performance against the seeded stress database.",
      "It does not send HTTP API load. Use npm run stress:all for API testing.",
    ],
  };

  try {
    report.git = await gitRevision(config.root);
    report.app = await appSnapshot();
    report.database = await postgresSnapshot(prisma);

    console.log(`\nRunning database ACID + benchmarks (${config.profileName})`);
    report.suites.database = await runDatabaseSuite(config);
    report.integrity = report.suites.database.integrity || [];
    report.dataset = {
      "worst-case business id": report.suites.database.businessId,
      staff: report.suites.database.volume.staffMembers,
      accountants: report.suites.database.volume.accountants,
      products: report.suites.database.volume.products,
      stockLogs: report.suites.database.volume.stockLogs,
      "stress businesses": report.suites.database.volume.stressBusinesses,
      "stress team users": report.suites.database.volume.stressTeamUsers,
    };
    report.databaseAfter = report.suites.database.databaseAfter;
    report.finishedAt = new Date().toISOString();
    writeDbReport(dir, report);
    console.log(`\nDB report written to ${dir}`);
    console.log(`ACID: ${report.suites.database.summary.acidPass}/${report.suites.database.summary.acidTotal} PASS`);
  } catch (error) {
    report.fatal = error.message || String(error);
    report.finishedAt = new Date().toISOString();
    try {
      writeDbReport(dir, report);
    } catch (writeError) {
      console.error(writeError.message || writeError);
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
