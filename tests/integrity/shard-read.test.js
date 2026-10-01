const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("shard routing", () => {
  it("defaults to single shard", () => {
    const prev = process.env.SHARD_COUNT;
    delete process.env.SHARD_COUNT;
    delete require.cache[require.resolve("../../utils/shard-config")];
    const { shardCount, shardIndexForBusinessId, isShardingEnabled } = require("../../utils/shard-config");
    assert.equal(shardCount(), 1);
    assert.equal(isShardingEnabled(), false);
    assert.equal(shardIndexForBusinessId(42), 0);
    if (prev === undefined) delete process.env.SHARD_COUNT;
    else process.env.SHARD_COUNT = prev;
  });

  it("routes businessId by modulo when SHARD_COUNT>1", () => {
    process.env.SHARD_COUNT = "4";
    delete require.cache[require.resolve("../../utils/shard-config")];
    const { shardIndexForBusinessId } = require("../../utils/shard-config");
    assert.equal(shardIndexForBusinessId(10), 2);
    assert.equal(shardIndexForBusinessId(11), 3);
    delete process.env.SHARD_COUNT;
    delete require.cache[require.resolve("../../utils/shard-config")];
  });
});

describe("tenant db context", () => {
  it("runWithTenantDb exposes store inside callback", () => {
    const { runWithTenantDb, getTenantDbStore } = require("../../utils/tenant-db-context");
    const payload = { prisma: { tag: "tenant" } };
    runWithTenantDb(payload, () => {
      assert.deepEqual(getTenantDbStore(), payload);
    });
    assert.equal(getTenantDbStore(), undefined);
  });
});
