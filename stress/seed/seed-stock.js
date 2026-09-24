const { loadStressEnv, assertStressEnvironment } = require("../lib/safety");

loadStressEnv();
assertStressEnvironment();

const {
  createInBatches,
  ensureSeedOwner,
  ensureWorstCaseBusiness,
  passwordHash,
  prisma,
} = require("./common");

async function main() {
  const hash = await passwordHash();
  const owner = await ensureSeedOwner(hash);
  const business = await ensureWorstCaseBusiness(owner);
  const products = await prisma.product.findMany({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
    select: { id: true, barcode: true, stock: true },
    take: Number(process.env.STRESS_STOCK_RECORDS || 10000),
    orderBy: { id: "asc" },
  });
  if (products.length === 0) {
    throw new Error("No STRESS-P products found. Run npm run stress:seed:products first.");
  }

  await prisma.product.updateMany({
    where: { id: { in: products.map((product) => product.id) } },
    data: { stock: 1000 },
  });

  const history = Number(process.env.STRESS_STOCK_HISTORY ?? 1);
  console.log(`Stock volume seed. Products ${products.length}. History rows per product ${history}.`);
  if (history > 0) {
    const existing = new Set(
      (
        await prisma.stockLog.findMany({
          where: { businessId: business.id, note: "stress seed opening" },
          select: { productId: true },
        })
      ).map((row) => row.productId),
    );
    const logs = [];
    for (const product of products) {
      if (existing.has(product.id)) continue;
      for (let index = 0; index < history; index += 1) {
        logs.push({
          businessId: business.id,
          productId: product.id,
          barcode: product.barcode,
          quantity: 1000,
          previousStock: 0,
          newStock: 1000,
          note: "stress seed opening",
          userId: owner.id,
        });
      }
    }
    await createInBatches("stock-logs", logs, (slice) => prisma.stockLog.createMany({ data: slice }));
  }

  console.log(JSON.stringify({
    scenario: "WORST-CASE SINGLE TENANT",
    products: products.length,
    stock: 1000,
    historyPerProduct: history,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
