const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

describe("redis soft cache", () => {
  let prevEnable;
  let prevUrl;

  before(() => {
    prevEnable = process.env.ENABLE_REDIS;
    prevUrl = process.env.REDIS_URL;
  });

  after(async () => {
    if (prevEnable === undefined) delete process.env.ENABLE_REDIS;
    else process.env.ENABLE_REDIS = prevEnable;
    if (prevUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevUrl;
    const { _resetRedisForTests } = require("../../utils/redis");
    const { _resetCacheStatsForTests } = require("../../utils/ttl-cache");
    await _resetRedisForTests();
    _resetCacheStatsForTests();
  });

  it("memory fallback works when Redis disabled", async () => {
    process.env.ENABLE_REDIS = "false";
    const { _resetRedisForTests } = require("../../utils/redis");
    const {
      cacheGet,
      cacheSet,
      getCacheStats,
      _resetCacheStatsForTests,
    } = require("../../utils/ttl-cache");
    await _resetRedisForTests();
    _resetCacheStatsForTests();

    const key = `dashboard:admin:test-mem-${Date.now()}`;
    assert.equal(await cacheGet(key), undefined);
    await cacheSet(key, { ok: true, n: 1 }, 5000);
    const hit = await cacheGet(key);
    assert.deepEqual(hit, { ok: true, n: 1 });
    const stats = getCacheStats();
    assert.ok(stats.hits >= 1);
    assert.equal(stats.redisEnabled, false);
  });

  it("Redis get/set JSON when enabled and reachable", async () => {
    process.env.ENABLE_REDIS = "true";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    const { _resetRedisForTests, getRedisClient, redisSetJson, redisGetJson, redisDel } =
      require("../../utils/redis");
    await _resetRedisForTests();

    const client = await getRedisClient();
    if (!client) {
      // Environment without Redis — skip soft assertion
      return;
    }

    const key = `cache:test:${Date.now()}`;
    const payload = { hello: "redis", amount: 12.5 };
    assert.equal(await redisSetJson(key, payload, 10), true);
    assert.deepEqual(await redisGetJson(key), payload);
    await redisDel(key);
    await _resetRedisForTests();
  });

  it("cacheInvalidateBusiness clears memory keys", async () => {
    process.env.ENABLE_REDIS = "false";
    const { _resetRedisForTests } = require("../../utils/redis");
    const {
      cacheGet,
      cacheSet,
      cacheInvalidateBusiness,
      _resetCacheStatsForTests,
    } = require("../../utils/ttl-cache");
    await _resetRedisForTests();
    _resetCacheStatsForTests();

    const biz = 999001;
    await cacheSet(`dashboard:admin:${biz}`, { a: 1 }, 10000);
    await cacheSet(`report:stock:${biz}`, { b: 2 }, 10000);
    await cacheInvalidateBusiness(biz);
    assert.equal(await cacheGet(`dashboard:admin:${biz}`), undefined);
    assert.equal(await cacheGet(`report:stock:${biz}`), undefined);
  });
});
