const express = require("express");
const { checkAllShardsHealth, prisma, prismaRead } = require("../../db");
const { isReadReplicaConfigured } = require("../../utils/db-config");
const { isShardingEnabled, shardCount } = require("../../utils/shard-config");
const { isRedisEnabled, getRedisClient } = require("../../utils/redis");

const healthRouter = express.Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "almadel-backend" });
});

healthRouter.get("/health/live", (_req, res) => {
  res.json({ ok: true, live: true });
});

healthRouter.get("/health/ready", async (_req, res) => {
  const checks = {
    ok: true,
    db: { primary: "unknown", read: "unknown" },
    shards: [],
    shardingEnabled: isShardingEnabled(),
    shardCount: shardCount(),
    redis: isRedisEnabled() ? "unknown" : "disabled",
    readReplicaConfigured: isReadReplicaConfigured(),
    poolMaxPerProcess: Number(process.env.DB_POOL_MAX || 10),
  };

  if (checks.shardCount > 1) {
    checks.shards = await checkAllShardsHealth();
    checks.ok = checks.shards.every((s) => s.primary === "up" && s.read !== "down");
  } else {
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db.primary = "up";
    } catch (error) {
      checks.ok = false;
      checks.db.primary = "down";
      checks.db.primaryError = error.message;
    }

    if (isReadReplicaConfigured()) {
      try {
        await prismaRead.$queryRaw`SELECT 1`;
        checks.db.read = "up";
      } catch (error) {
        checks.ok = false;
        checks.db.read = "down";
        checks.db.readError = error.message;
      }
    } else {
      checks.db.read = "primary";
    }
  }

  if (isRedisEnabled()) {
    try {
      const client = await getRedisClient();
      checks.redis = client ? "up" : "down";
      if (!client) checks.ok = false;
    } catch (error) {
      checks.ok = false;
      checks.redis = "down";
      checks.redisError = error.message;
    }
  }

  res.status(checks.ok ? 200 : 503).json(checks);
});

module.exports = { healthRouter };
