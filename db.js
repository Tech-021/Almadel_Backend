require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

let prisma;

function getPrisma() {
  if (!prisma) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    prisma = new PrismaClient({
      adapter,
    });
  }
  return prisma;
}

module.exports = {
  get prisma() {
    return getPrisma();
  },
  /** Reset the cached client after env changes (stress scripts only). */
  resetPrismaClient() {
    const current = prisma;
    prisma = undefined;
    return current ? current.$disconnect() : Promise.resolve();
  },
};
