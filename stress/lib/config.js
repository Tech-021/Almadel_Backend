const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

const PROFILES = {
  smoke: {
    businessCounts: [10],
    teamCounts: [20],
    productCounts: [50],
    stockProducts: 20,
    updatesPerProduct: 5,
    contentionLevels: [5],
    readConcurrency: [1, 5],
    mixedConcurrency: [5],
    mixedSeconds: 15,
    maxConcurrency: 5,
    dbScaleCheckpoints: [100, 200],
  },
  standard: {
    businessCounts: [100, 500, 1000],
    teamCounts: [100, 1000],
    productCounts: [100, 1000],
    stockProducts: 100,
    updatesPerProduct: 10,
    contentionLevels: [10, 50, 100],
    readConcurrency: [1, 10, 50, 100],
    mixedConcurrency: [10, 25, 50, 100],
    mixedSeconds: 30,
    maxConcurrency: 100,
    dbScaleCheckpoints: [100, 1000, 5000, 10000],
  },
  heavy: {
    businessCounts: [100, 500, 1000, 5000, 10000],
    teamCounts: [100, 1000, 10000],
    productCounts: [100, 1000, 5000, 10000],
    stockProducts: 100,
    updatesPerProduct: 10,
    contentionLevels: [10, 50, 100, 250],
    readConcurrency: [1, 10, 50, 100],
    mixedConcurrency: [10, 25, 50, 100, 200, 500],
    mixedSeconds: 45,
    maxConcurrency: 200,
    dbScaleCheckpoints: [100, 1000, 5000, 10000],
  },
};

function parseArgs(argv) {
  const args = {
    suite: "all",
    profile: process.env.STRESS_PROFILE || "smoke",
    confirmHeavy: process.env.STRESS_ALLOW_HEAVY === "true",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--suite") args.suite = argv[++i];
    else if (token === "--profile") args.profile = argv[++i];
    else if (token === "--confirm-heavy") args.confirmHeavy = true;
    else if (token === "--help" || token === "-h") args.help = true;
  }

  return args;
}

function loadConfig(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const profileName = String(args.profile || "smoke").toLowerCase();
  const profile = PROFILES[profileName];

  if (!profile) {
    throw new Error(`Unknown profile '${profileName}'. Use smoke, standard, or heavy.`);
  }

  if (profileName === "heavy" && !args.confirmHeavy) {
    throw new Error(
      "The heavy profile is not the default. Re-run with --confirm-heavy or STRESS_ALLOW_HEAVY=true.",
    );
  }

  const envInt = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number.`);
    }
    return value;
  };

  return {
    args,
    profileName,
    profile: {
      ...profile,
      maxConcurrency: Math.min(
        profile.maxConcurrency,
        envInt("STRESS_MAX_CONCURRENCY", profile.maxConcurrency),
      ),
    },
    root: ROOT,
    baseUrl: (process.env.STRESS_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, ""),
    timeoutMs: envInt("STRESS_REQUEST_TIMEOUT_MS", 10000),
    maxErrorRate: Number(process.env.STRESS_MAX_ERROR_RATE ?? 0.1),
    maxP95Ms: envInt("STRESS_MAX_P95_MS", 5000),
    businesses: envInt("STRESS_BUSINESSES", 10000),
    teamMembers: envInt("STRESS_TEAM_MEMBERS", 10000),
    products: envInt("STRESS_PRODUCTS", 10000),
    stockRecords: envInt("STRESS_STOCK_RECORDS", 10000),
    stockHistory: envInt("STRESS_STOCK_HISTORY", 1),
    realisticBusinesses: envInt("STRESS_REALISTIC_BUSINESSES", 10),
    realisticStaff: envInt("STRESS_REALISTIC_STAFF", 3),
    realisticAccountants: envInt("STRESS_REALISTIC_ACCOUNTANTS", 1),
    realisticProducts: envInt("STRESS_REALISTIC_PRODUCTS", 10),
    help: Boolean(args.help),
  };
}

function concurrencyForStage(index, profile) {
  const ramp = [10, 25, 50, 100, 200, 500];
  const picked = ramp[Math.min(index, ramp.length - 1)];
  return Math.max(1, Math.min(picked, profile.maxConcurrency));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  PROFILES,
  concurrencyForStage,
  ensureDir,
  loadConfig,
  ROOT,
};
