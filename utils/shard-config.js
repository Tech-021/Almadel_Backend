/**
 * Horizontal DB shards (optional). SHARD_COUNT=1 → single DATABASE_URL (default).
 * Auth / business_members stay on shard 0; tenant routes use shard by businessId.
 */

function shardCount() {
  const parsed = Number(process.env.SHARD_COUNT);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function isShardingEnabled() {
  return shardCount() > 1;
}

function shardIndexForBusinessId(businessId) {
  const count = shardCount();
  const id = Number(businessId);
  if (!Number.isInteger(id) || id <= 0 || count <= 1) {
    return 0;
  }
  return id % count;
}

function shardPrimaryUrl(index) {
  if (index === 0) {
    const url = String(process.env.DATABASE_URL || "").trim();
    if (!url) throw new Error("DATABASE_URL is not configured.");
    return url;
  }
  const key = `DATABASE_SHARD_${index}_URL`;
  const url = String(process.env[key] || "").trim();
  if (!url) {
    throw new Error(`${key} is required when SHARD_COUNT=${shardCount()}.`);
  }
  return url;
}

function shardReadUrl(index) {
  const shardKey = `DATABASE_SHARD_${index}_READ_URL`;
  const shardRead = String(process.env[shardKey] || "").trim();
  if (shardRead) return shardRead;

  if (index === 0) {
    const globalRead = String(process.env.DATABASE_READ_URL || "").trim();
    if (globalRead) return globalRead;
    return null;
  }

  return null;
}

function listShardIndexes() {
  const count = shardCount();
  return Array.from({ length: count }, (_, i) => i);
}

module.exports = {
  isShardingEnabled,
  listShardIndexes,
  shardCount,
  shardIndexForBusinessId,
  shardPrimaryUrl,
  shardReadUrl,
};
