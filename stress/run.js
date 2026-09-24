const fs = require("fs");
const path = require("path");

const { loadStressEnv, assertStressEnvironment, assertConnectedStressDatabase } = require("./lib/safety");
loadStressEnv();
assertStressEnvironment();

const { ensureDir, loadConfig } = require("./lib/config");
const { assertApiUsesStressDatabase, ensureAnchor, signIn } = require("./lib/anchor");
const { appSnapshot, gitRevision, postgresSnapshot } = require("./lib/monitor");
const { loadMailTimings, writeReport } = require("./lib/report");
const { gradeStage } = require("./lib/metrics");
const { SEED_OWNER_EMAIL, WORST_CASE_BUSINESS } = require("./lib/constants");
const { runBusinessSuite } = require("./suites/business");
const { probeTeamList, runTeamSuite } = require("./suites/team");
const { probeProductReads, runProductSuite } = require("./suites/products");
const { runStockSuite } = require("./suites/stock");
const { runReadSuite } = require("./suites/reads");
const { runMixedSuite } = require("./suites/mixed");

const HELP = `Almadel stress runner

  npm run stress:all
  npm run stress:business
  npm run stress -- --suite team --profile standard
  npm run stress:all -- --profile heavy --confirm-heavy

Profiles: smoke (default), standard, heavy.
Heavy requires --confirm-heavy.
`;

async function datasetCounts(prisma) {
  const [businesses, team, products, stockLogs] = await Promise.all([
    prisma.business.count({
      where: { OR: [{ name: { startsWith: "stress_" } }, { name: { startsWith: "loadtest_" } }] },
    }),
    prisma.businessMember.count({
      where: { user: { OR: [{ email: { startsWith: "stress_" } }, { email: { startsWith: "loadtest_" } }] } },
    }),
    prisma.product.count({
      where: { OR: [{ barcode: { startsWith: "STRESS-" } }, { barcode: { startsWith: "LOADTEST-" } }] },
    }),
    prisma.stockLog.count({
      where: { OR: [{ barcode: { startsWith: "STRESS-" } }, { barcode: { startsWith: "LOADTEST-" } }] },
    }),
  ]);
  return {
    "stress businesses": businesses,
    "stress memberships": team,
    "stress products": products,
    "stress stock logs": stockLogs,
  };
}

async function readAnchorForTarget(config, anchor, prisma) {
  if (process.env.STRESS_READ_TARGET !== "seed") return anchor;
  const business = await prisma.business.findFirst({ where: { name: WORST_CASE_BUSINESS } });
  if (!business) {
    throw new Error("No worst-case seed business found. Run the seed scripts first.");
  }
  const session = await signIn(config, SEED_OWNER_EMAIL);
  return {
    token: session.token,
    businessId: business.id,
    email: SEED_OWNER_EMAIL,
    businessName: business.name,
  };
}

async function main() {
  const config = loadConfig();
  if (config.help) {
    console.log(HELP);
    return;
  }

  const { prisma, resetPrismaClient } = require("../db");
  await resetPrismaClient();
  await assertConnectedStressDatabase(prisma);
  const runId = `stress-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const dir = ensureDir(path.join(config.root, "stress", "results", runId));
  const runSalt = Number(String(Date.now()).slice(-4));
  const report = {
    id: runId,
    startedAt: new Date().toISOString(),
    profile: config.profileName,
    baseUrl: config.baseUrl,
    suites: {},
    integrity: [],
    stops: [],
    scenarioNotes: [
      "API suites create records through HTTP and stop ramping when error rate or p95 crosses the configured limit.",
      "Database volume seeds are separate commands and are not launched by stress:all.",
    ],
  };

  try {
    await assertApiUsesStressDatabase(config, prisma);
    report.git = await gitRevision(config.root);
    report.app = await appSnapshot();
    report.database = await postgresSnapshot(prisma);

    const suite = config.args.suite;
    const selected = suite === "all"
      ? ["business", "team", "products", "stock", "reads", "mixed"]
      : [suite];

    let anchor = null;
    const needsAnchor = selected.some((name) => name !== "business");
    if (needsAnchor) anchor = await ensureAnchor(config);

    for (const name of selected) {
      console.log(`\nRunning ${name} (${config.profileName})`);
      if (name === "business") {
        report.suites.business = await runBusinessSuite(config, runSalt);
      } else if (name === "team") {
        report.suites.team = await runTeamSuite(config, anchor, runSalt);
        report.suites.team.listProbe = await probeTeamList(config, anchor, config.profile.readConcurrency);
        report.suites.team.stages.push(...report.suites.team.listProbe);
      } else if (name === "products") {
        report.suites.products = await runProductSuite(config, anchor, runSalt);
        const probes = await probeProductReads(config, anchor, config.profile.readConcurrency);
        report.suites.products.stages.push(...probes);
      } else if (name === "stock") {
        report.suites.stock = await runStockSuite(config, anchor, runSalt);
        report.integrity.push(...(report.suites.stock.integrity || []));
      } else if (name === "reads") {
        const target = await readAnchorForTarget(config, anchor, prisma);
        report.suites.reads = await runReadSuite(config, target);
      } else if (name === "mixed") {
        report.suites.mixed = await runMixedSuite(config, anchor, runSalt);
      } else {
        throw new Error(`Unknown suite '${name}'.`);
      }

      const current = report.suites[name];
      if (current?.aborted) report.stops.push(current.aborted);
      fs.writeFileSync(path.join(dir, `api-${name}.json`), JSON.stringify(current, null, 2));
    }

    report.dataset = await datasetCounts(prisma);
    report.databaseAfter = await postgresSnapshot(prisma);
    report.mail = loadMailTimings(config.root, report.startedAt);
    report.finishedAt = new Date().toISOString();
    for (const suite of Object.values(report.suites)) {
      for (const stage of suite.stages || []) {
        if (!stage.grade) stage.grade = gradeStage(stage, config);
      }
    }
    writeReport(dir, report);
    console.log(`\nReport written to ${dir}`);
  } catch (error) {
    report.fatal = error.message || String(error);
    report.finishedAt = new Date().toISOString();
    try {
      report.mail = loadMailTimings(config.root, report.startedAt);
      writeReport(dir, report);
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
