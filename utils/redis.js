/**
 * Shared Redis client for Almadel backend.
 * Complements PostgreSQL (Socket.IO + soft caches). Never durable business state.
 */

const { createClient } = require("redis");
const { logger } = require("./logger");

let client = null;
let connectPromise = null;
let declaredDisabled = false;
let connectFailed = false;

function isRedisEnabled() {
  return process.env.ENABLE_REDIS === "true" && Boolean(process.env.REDIS_URL);
}

function keyPrefix() {
  const raw = process.env.REDIS_KEY_PREFIX || "almadel:";
  return raw.endsWith(":") ? raw : `${raw}:`;
}

function prefixed(key) {
  const p = keyPrefix();
  const k = String(key);
  return k.startsWith(p) ? k : `${p}${k}`;
}

function buildRedisUrl() {
  const base = String(process.env.REDIS_URL || "").trim();
  if (!base) return null;
  const db = process.env.REDIS_DB;
  if (db == null || String(db).trim() === "") return base;
  try {
    const u = new URL(base);
    u.pathname = `/${String(db).trim()}`;
    return u.toString();
  } catch {
    return base;
  }
}

async function getRedisClient() {
  if (!isRedisEnabled()) {
    if (!declaredDisabled) {
      declaredDisabled = true;
      logger.info("Redis disabled (set ENABLE_REDIS=true to enable).");
    }
    return null;
  }
  if (connectFailed) return null;
  if (client?.isOpen) return client;

  if (!connectPromise) {
    connectPromise = (async () => {
      const url = buildRedisUrl();
      const c = createClient({
        url,
        socket: {
          connectTimeout: 1500,
          reconnectStrategy(retries) {
            if (retries > 5) return false;
            return Math.min(retries * 200, 1000);
          },
        },
      });
      c.on("error", (err) => {
        logger.warn("Redis client warning:", err.message);
      });
      try {
        await Promise.race([
          c.connect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Redis connection timeout")), 2000),
          ),
        ]);
        client = c;
        logger.info("Redis connected:", url.replace(/\/\/.*@/, "//***@"));
        return client;
      } catch (err) {
        connectFailed = true;
        connectPromise = null;
        try {
          await c.quit();
        } catch {
          // ignore
        }
        logger.warn("Redis unavailable; continuing without Redis:", err.message);
        return null;
      }
    })();
  }

  return connectPromise;
}

/** Alias */
async function getRedis() {
  return getRedisClient();
}

async function redisGet(key) {
  const c = await getRedisClient();
  if (!c) return null;
  try {
    return await c.get(prefixed(key));
  } catch (err) {
    logger.warn("redisGet failed:", err.message);
    return null;
  }
}

async function redisSet(key, value, ttlSeconds) {
  const c = await getRedisClient();
  if (!c) return false;
  try {
    const k = prefixed(key);
    const v = value == null ? "" : String(value);
    if (ttlSeconds != null && Number(ttlSeconds) > 0) {
      await c.set(k, v, { EX: Math.ceil(Number(ttlSeconds)) });
    } else {
      await c.set(k, v);
    }
    return true;
  } catch (err) {
    logger.warn("redisSet failed:", err.message);
    return false;
  }
}

async function redisDel(keyOrKeys) {
  const c = await getRedisClient();
  if (!c) return 0;
  const keys = (Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys])
    .filter(Boolean)
    .map((k) => prefixed(k));
  if (!keys.length) return 0;
  try {
    return await c.del(keys);
  } catch (err) {
    logger.warn("redisDel failed:", err.message);
    return 0;
  }
}

async function redisGetJson(key) {
  const raw = await redisGet(key);
  if (raw == null || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function redisSetJson(key, obj, ttlSeconds) {
  try {
    return redisSet(key, JSON.stringify(obj), ttlSeconds);
  } catch (err) {
    logger.warn("redisSetJson failed:", err.message);
    return false;
  }
}

/**
 * Delete keys matching a glob under the app prefix (SCAN-based).
 * pattern is relative to prefix, e.g. "cache:*:123*"
 */
async function redisDeleteByPattern(pattern) {
  const c = await getRedisClient();
  if (!c) return 0;
  const match = prefixed(pattern);
  let deleted = 0;
  try {
    // node-redis scanIterator yields *arrays* of keys per SCAN page (often []).
    for await (const keys of c.scanIterator({ MATCH: match, COUNT: 100 })) {
      const batch = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
      if (batch.length) deleted += await c.del(batch);
    }
  } catch (err) {
    logger.warn("redisDeleteByPattern failed:", err.message);
  }
  return deleted;
}

/** Create a fresh pub/sub pair for Socket.IO adapter (not the shared cache client). */
async function createPubSubClients() {
  if (!isRedisEnabled()) return null;
  const url = buildRedisUrl();
  const pubClient = createClient({
    url,
    socket: { connectTimeout: 1500, reconnectStrategy: false },
  });
  const subClient = pubClient.duplicate();
  pubClient.on("error", (error) => logger.warn("Redis publisher warning:", error.message));
  subClient.on("error", (error) => logger.warn("Redis subscriber warning:", error.message));
  await Promise.race([
    Promise.all([pubClient.connect(), subClient.connect()]),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connection timeout")), 2000)),
  ]);
  return { pubClient, subClient };
}

/** Test helper: disconnect and reset singleton state */
async function _resetRedisForTests() {
  const current = client;
  client = null;
  connectPromise = null;
  declaredDisabled = false;
  connectFailed = false;
  if (current?.isOpen) {
    try {
      await current.quit();
    } catch {
      try {
        await current.disconnect();
      } catch {
        // ignore
      }
    }
  }
}

module.exports = {
  isRedisEnabled,
  getRedis,
  getRedisClient,
  redisGet,
  redisSet,
  redisDel,
  redisGetJson,
  redisSetJson,
  redisDeleteByPattern,
  createPubSubClients,
  keyPrefix,
  prefixed,
  _resetRedisForTests,
};
