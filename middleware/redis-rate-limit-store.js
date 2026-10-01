const { getRedisClient, isRedisEnabled } = require("../utils/redis");

/**
 * express-rate-limit store backed by Redis (shared across PM2 cluster / LB nodes).
 */
class RedisRateLimitStore {
  constructor(options = {}) {
    this.prefix = options.prefix || "ratelimit:";
    this.windowMs = options.windowMs || 15 * 60 * 1000;
  }

  init(options) {
    if (options.windowMs) {
      this.windowMs = options.windowMs;
    }
  }

  redisKey(key) {
    return `${this.prefix}${key}`;
  }

  async increment(key) {
    const client = await getRedisClient();
    if (!client) {
      return undefined;
    }

    const redisKey = this.redisKey(key);
    const hits = await client.incr(redisKey);
    if (hits === 1) {
      await client.pExpire(redisKey, this.windowMs);
    }
    const ttlMs = await client.pTTL(redisKey);
    const resetTime =
      ttlMs > 0 ? new Date(Date.now() + ttlMs) : new Date(Date.now() + this.windowMs);

    return { totalHits: hits, resetTime };
  }

  async decrement(key) {
    const client = await getRedisClient();
    if (!client) return;
    await client.decr(this.redisKey(key));
  }

  async resetKey(key) {
    const client = await getRedisClient();
    if (!client) return;
    await client.del(this.redisKey(key));
  }
}

function shouldUseRedisStore() {
  if (process.env.AUTH_RATE_LIMIT_REDIS === "false") {
    return false;
  }
  return isRedisEnabled();
}

function createRedisRateLimitStore(windowMs) {
  if (!shouldUseRedisStore()) {
    return undefined;
  }
  return new RedisRateLimitStore({ windowMs });
}

module.exports = {
  RedisRateLimitStore,
  createRedisRateLimitStore,
};
