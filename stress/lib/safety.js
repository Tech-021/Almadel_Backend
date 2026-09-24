const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const { ROOT } = require("./config");

function databaseNameFromUrl(rawUrl) {
  const databaseName = decodeURIComponent(new URL(rawUrl).pathname.slice(1).split("/")[0] || "");
  if (!databaseName) {
    throw new Error("DATABASE_URL does not include a database name.");
  }
  return databaseName;
}

function loadStressEnv() {
  const envFile = path.join(ROOT, ".env.stress");
  if (!fs.existsSync(envFile)) {
    throw new Error(
      "Missing .env.stress. Copy .env.stress.example to .env.stress and point it at almadel_stress.",
    );
  }

  dotenv.config({ path: envFile, override: true });
  return envFile;
}

async function assertConnectedStressDatabase(prismaClient) {
  const rows = await prismaClient.$queryRaw`SELECT current_database() AS db`;
  const connected = String(rows[0]?.db || "");
  if (connected !== "almadel_stress") {
    throw new Error(
      `Prisma is connected to '${connected}', not 'almadel_stress'. Refusing to continue. Restart the stress command after fixing env load order.`,
    );
  }
  return connected;
}

function assertStressEnvironment() {
  const problems = [];

  if (process.env.NODE_ENV !== "stress") {
    problems.push("NODE_ENV must be 'stress'.");
  }
  if (process.env.STRESS_TEST !== "true") {
    problems.push("STRESS_TEST must be 'true'.");
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    problems.push("DATABASE_URL is required.");
  }

  let databaseName = "";
  if (rawUrl) {
    try {
      databaseName = databaseNameFromUrl(rawUrl);
    } catch (error) {
      problems.push(error.message);
    }
  }

  if (databaseName && databaseName !== "almadel_stress") {
    problems.push(
      `Refusing database '${databaseName}'. Stress scripts only run against 'almadel_stress'.`,
    );
  }

  if (process.env.DATABASE_NAME && process.env.DATABASE_NAME !== "almadel_stress") {
    problems.push("DATABASE_NAME must be 'almadel_stress' when it is set.");
  }

  if (problems.length > 0) {
    throw new Error(problems.join(" "));
  }

  const banner = [
    "================================================",
    "ALMADEL STRESS TEST ENVIRONMENT",
    "Database: almadel_stress",
    "Environment: stress",
    "================================================",
  ].join("\n");
  console.log(banner);

  return { databaseName: "almadel_stress" };
}

module.exports = {
  assertConnectedStressDatabase,
  assertStressEnvironment,
  loadStressEnv,
};
