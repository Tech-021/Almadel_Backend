/**
 * Soft TTL cache for hot read endpoints (dashboard / reports).
 * Uses Redis when ENABLE_REDIS=true and healthy; otherwise in-process Map.
 * Not a source of truth — short-lived only.
 */

const {
  isRedisEnabled,
  redisGetJson,
  redisSetJson,
  redisDeleteByPattern,
  prefixed,
} = require("./redis");

const memory = new Map();
const CACHE_NS = "cache:";

let stats = { hits: 0, misses: 0, sets: 0, backend: "memory" };

function logicalCacheKey(key) {
  return `${CACHE_NS}${key}`;
}

function memoryGet(key) {
  const entry = memory.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memory.delete(key);
    return undefined;
  }
  return entry.value;
}

function memorySet(key, value, ttlMs) {
  memory.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
  if (memory.size > 500) {
    const now = Date.now();
    for (const [k, v] of memory) {
      if (now > v.expiresAt) memory.delete(k);
    }
  }
}

function memoryInvalidateBusiness(businessId) {
  const id = String(businessId);
  let n = 0;
  for (const key of memory.keys()) {
    // keys: dashboard:admin:6 | dashboard:my:6:12 | report:products:6:... | report:stock:6
    if (
      key === `dashboard:admin:${id}` ||
      key.startsWith(`dashboard:my:${id}:`) ||
      key.startsWith(`report:products:${id}:`) ||
      key === `report:stock:${id}` ||
      key.includes(`:${id}:`) ||
      key.endsWith(`:${id}`)
    ) {
      memory.delete(key);
      n += 1;
    }
  }
  return n;
}

/**
 * @returns {Promise<any|undefined>}
 */
async function cacheGet(key) {
  const logical = String(key);

  if (isRedisEnabled()) {
    const fromRedis = await redisGetJson(logicalCacheKey(logical));
    if (fromRedis !== undefined) {
      stats.hits += 1;
      stats.backend = "redis";
      return fromRedis;
    }
  }

  const fromMem = memoryGet(logical);
  if (fromMem !== undefined) {
    stats.hits += 1;
    stats.backend = "memory";
    return fromMem;
  }

  stats.misses += 1;
  return undefined;
}

/**
 * @param {string} key
 * @param {any} value JSON-serializable payload
 * @param {number} ttlMs
 */
async function cacheSet(key, value, ttlMs = 30000) {
  const logical = String(key);
  const ms = Math.max(0, Number(ttlMs) || 0);
  stats.sets += 1;

  // Always keep memory copy as local L1 / Redis-down fallback
  memorySet(logical, value, ms);

  if (isRedisEnabled()) {
    const ok = await redisSetJson(logicalCacheKey(logical), value, Math.ceil(ms / 1000) || 1);
    if (ok) stats.backend = "redis";
  }
}

/**
 * Best-effort bust of dashboard/report soft cache for one business.
 * Safe to call fire-and-forget after mutations.
 */
async function cacheInvalidateBusiness(businessId) {
  if (businessId == null) return { memory: 0, redis: 0 };
  const mem = memoryInvalidateBusiness(businessId);
  let redis = 0;
  if (isRedisEnabled()) {
    // Match any cache key containing this business id segment
    redis += await redisDeleteByPattern(`${CACHE_NS}dashboard:admin:${businessId}`);
    redis += await redisDeleteByPattern(`${CACHE_NS}dashboard:my:${businessId}:*`);
    redis += await redisDeleteByPattern(`${CACHE_NS}report:products:${businessId}:*`);
    redis += await redisDeleteByPattern(`${CACHE_NS}report:stock:${businessId}`);
  }
  return { memory: mem, redis };
}

function getCacheStats() {
  return { ...stats, memorySize: memory.size, redisEnabled: isRedisEnabled(), prefix: prefixed(CACHE_NS) };
}

function _resetCacheStatsForTests() {
  stats = { hits: 0, misses: 0, sets: 0, backend: "memory" };
  memory.clear();
}

module.exports = {
  cacheGet,
  cacheSet,
  cacheInvalidateBusiness,
  getCacheStats,
  _resetCacheStatsForTests,
};
