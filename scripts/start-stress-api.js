#!/usr/bin/env node
/**
 * Start API on STRESS_BASE_URL port using .env.stress (almadel_stress).
 * Usage: npm run stress:api
 *        (separate terminal) npm run stress:reads
 */
const path = require("path");

const root = path.join(__dirname, "..");

require("dotenv").config({ path: path.join(root, ".env"), quiet: true });
const liveJwt = process.env.JWT_SECRET;

require("dotenv").config({
  path: path.join(root, ".env.stress"),
  override: true,
  quiet: true,
});

if (liveJwt && (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).includes("replace"))) {
  process.env.JWT_SECRET = liveJwt;
}

const port = process.env.STRESS_API_PORT || "4010";
process.env.API_PORT = port;
process.env.API_HOST = process.env.API_HOST || "127.0.0.1";

if (process.env.NODE_ENV !== "stress" || process.env.STRESS_TEST !== "true") {
  console.error("Refusing to start: .env.stress must set NODE_ENV=stress and STRESS_TEST=true");
  process.exit(1);
}

const dbName = (() => {
  try {
    return decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1).split("/")[0]);
  } catch {
    return "";
  }
})();

if (dbName !== "almadel_stress") {
  console.error(`Refusing to start: DATABASE_URL must target almadel_stress (got '${dbName || "invalid"}').`);
  process.exit(1);
}

console.log("================================================");
console.log("STRESS API");
console.log(`  Port:     ${port}`);
console.log(`  Database: ${dbName}`);
console.log(`  Base URL: ${process.env.STRESS_BASE_URL || `http://127.0.0.1:${port}`}`);
console.log("================================================");

const net = require("net");
const host = process.env.API_HOST || "127.0.0.1";
const listenPort = Number(process.env.API_PORT || 4010);

function portBusy() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(listenPort, host);
  });
}

portBusy().then((busy) => {
  if (busy) {
    console.error(
      `Port ${host}:${listenPort} is already in use. A stress API may already be running.`,
    );
    console.error(`  Check: curl -sS http://${host}:${listenPort}/health`);
    console.error(`  Stop:  fuser -k ${listenPort}/tcp   (or kill the node PID from ss -tlnp | grep ${listenPort})`);
    process.exit(1);
  }
  require(path.join(root, "index.js"));
});
