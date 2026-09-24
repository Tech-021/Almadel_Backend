const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

async function postgresSnapshot(prisma) {
  const [versionRows, activity, database, sizes] = await Promise.all([
    prisma.$queryRaw`SELECT version() AS version`,
    prisma.$queryRaw`
      SELECT
        count(*) FILTER (WHERE state = 'active')::int AS active,
        count(*) FILTER (WHERE state = 'idle')::int AS idle,
        count(*) FILTER (WHERE wait_event IS NOT NULL)::int AS waiting,
        count(*)::int AS total
      FROM pg_stat_activity
      WHERE datname = current_database()
    `,
    prisma.$queryRaw`
      SELECT
        xact_commit::bigint AS commits,
        xact_rollback::bigint AS rollbacks,
        deadlocks::bigint AS deadlocks,
        blks_hit::bigint AS blocks_hit,
        blks_read::bigint AS blocks_read,
        numbackends::int AS backends
      FROM pg_stat_database
      WHERE datname = current_database()
    `,
    prisma.$queryRaw`
      SELECT
        c.relname AS table_name,
        pg_total_relation_size(c.oid)::bigint AS total_bytes,
        c.reltuples::bigint AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 12
    `,
  ]);

  const db = serializeRow(database[0] || {});
  const hits = Number(db.blocks_hit || 0);
  const reads = Number(db.blocks_read || 0);
  const cacheHitRatio = hits + reads === 0 ? null : Number((hits / (hits + reads)).toFixed(4));

  return {
    version: String(versionRows[0]?.version || "").split(",")[0],
    activity: serializeRow(activity[0] || {}),
    database: { ...db, cacheHitRatio },
    largestTables: sizes.map(serializeRow),
  };
}

function serializeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]),
  );
}

async function appSnapshot() {
  const snapshot = {
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg().map((value) => Number(value.toFixed(2))),
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
    node: process.version,
  };

  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], { timeout: 4000 });
    const processes = JSON.parse(stdout);
    snapshot.pm2 = processes
      .filter((item) => /almadel/i.test(item.name || ""))
      .map((item) => ({
        name: item.name,
        status: item.pm2_env?.status,
        restarts: item.pm2_env?.restart_time,
        cpu: item.monit?.cpu,
        memoryMb: item.monit?.memory ? Math.round(item.monit.memory / 1024 / 1024) : null,
      }));
  } catch {
    snapshot.pm2 = null;
  }

  return snapshot;
}

async function gitRevision(root) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      timeout: 3000,
    });
    return stdout.trim() || "unknown";
  } catch {
    return "not a git repository";
  }
}

module.exports = {
  appSnapshot,
  gitRevision,
  postgresSnapshot,
};
