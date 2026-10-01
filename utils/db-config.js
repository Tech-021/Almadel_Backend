/**
 * PostgreSQL connection settings for Prisma + node-pg Pool.
 * Use DATABASE_DIRECT_URL for migrations when DATABASE_URL points at PgBouncer.
 */

function poolMaxConnections() {
  const parsed = Number(process.env.DB_POOL_MAX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function poolIdleMs() {
  const parsed = Number(process.env.DB_POOL_IDLE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
}

function poolConnectMs() {
  const parsed = Number(process.env.DB_POOL_CONNECT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

function primaryDatabaseUrl() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return url;
}

function readDatabaseUrl() {
  const replica = String(process.env.DATABASE_READ_URL || "").trim();
  if (replica) {
    return replica;
  }
  return primaryDatabaseUrl();
}

function isReadReplicaConfigured() {
  return Boolean(String(process.env.DATABASE_READ_URL || "").trim());
}

function isPgBouncerMode() {
  return process.env.PGBOUNCER === "true" || primaryDatabaseUrl().includes("pgbouncer=true");
}

function buildPoolOptions(connectionString) {
  return {
    connectionString,
    max: poolMaxConnections(),
    idleTimeoutMillis: poolIdleMs(),
    connectionTimeoutMillis: poolConnectMs(),
  };
}

module.exports = {
  buildPoolOptions,
  isPgBouncerMode,
  isReadReplicaConfigured,
  poolMaxConnections,
  primaryDatabaseUrl,
  readDatabaseUrl,
};
