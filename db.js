require("dotenv").config({ override: false });

const { Pool } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { buildPoolOptions } = require("./utils/db-config");
const {
  listShardIndexes,
  shardIndexForBusinessId,
  shardPrimaryUrl,
  shardReadUrl,
} = require("./utils/shard-config");
const { getTenantDbStore } = require("./utils/tenant-db-context");

/** @type {Map<number, { prisma, prismaRead, primaryPool, readPool }>} */
const shardClients = new Map();

function createClient(connectionString, label) {
  const pool = new Pool(buildPoolOptions(connectionString));
  pool.on("error", (error) => {
    console.error(`Postgres pool error (${label}):`, error.message);
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });
  return { client, pool };
}

function getClientsForShard(index) {
  const cached = shardClients.get(index);
  if (cached) return cached;

  const primaryUrl = shardPrimaryUrl(index);
  const readUrl = shardReadUrl(index);
  const primary = createClient(primaryUrl, `primary-shard-${index}`);
  let prismaRead = primary.client;
  let readPool = primary.pool;

  if (readUrl && readUrl !== primaryUrl) {
    const read = createClient(readUrl, `read-shard-${index}`);
    prismaRead = read.client;
    readPool = read.pool;
  }

  const entry = {
    prisma: primary.client,
    prismaRead,
    primaryPool: primary.pool,
    readPool,
  };
  shardClients.set(index, entry);
  return entry;
}

function getDefaultClients() {
  return getClientsForShard(0);
}

function resolveActiveClients() {
  const tenant = getTenantDbStore();
  if (tenant) {
    return tenant;
  }
  return getDefaultClients();
}

function getPrimaryPrisma() {
  return resolveActiveClients().prisma;
}

function getReadPrisma() {
  return resolveActiveClients().prismaRead;
}

function getClientsForBusiness(businessId) {
  const index = shardIndexForBusinessId(businessId);
  return getClientsForShard(index);
}

async function disconnectPools() {
  const tasks = [];
  for (const entry of shardClients.values()) {
    if (entry.primaryPool) tasks.push(entry.primaryPool.end());
    if (entry.readPool && entry.readPool !== entry.primaryPool) {
      tasks.push(entry.readPool.end());
    }
  }
  shardClients.clear();
  await Promise.all(tasks);
}

module.exports = {
  get prisma() {
    return getPrimaryPrisma();
  },
  get prismaRead() {
    return getReadPrisma();
  },
  getClientsForBusiness,
  getClientsForShard,
  disconnectPools,
  async resetPrismaClient() {
    const disconnects = [];
    for (const entry of shardClients.values()) {
      disconnects.push(entry.prisma.$disconnect().catch(() => {}));
      if (entry.prismaRead !== entry.prisma) {
        disconnects.push(entry.prismaRead.$disconnect().catch(() => {}));
      }
    }
    await Promise.all(disconnects);
    await disconnectPools();
  },
  /** Health / ops: ping every configured shard primary (+ read when set). */
  async checkAllShardsHealth() {
    const results = [];
    for (const index of listShardIndexes()) {
      const entry = getClientsForShard(index);
      const row = {
        shard: index,
        primary: "unknown",
        read: "unknown",
        readReplicaConfigured: Boolean(shardReadUrl(index)),
      };
      try {
        await entry.prisma.$queryRaw`SELECT 1`;
        row.primary = "up";
      } catch (error) {
        row.primary = "down";
        row.primaryError = error.message;
      }

      if (row.readReplicaConfigured && entry.prismaRead !== entry.prisma) {
        try {
          await entry.prismaRead.$queryRaw`SELECT 1`;
          row.read = "up";
        } catch (error) {
          row.read = "down";
          row.readError = error.message;
        }
      } else {
        row.read = "primary";
      }
      results.push(row);
    }
    return results;
  },
};
