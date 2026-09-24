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
  const target = Number(process.env.STRESS_PRODUCTS || 10000);
  const existing = await prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
  });
  const needed = Math.max(0, target - existing);
  console.log(`Product volume seed for one tenant. Target ${target}. Existing ${existing}. Inserting ${needed}.`);

  const rows = Array.from({ length: needed }, (_, index) => {
    const sequence = existing + index + 1;
    const id = String(sequence).padStart(6, "0");
    return {
      businessId: business.id,
      createdByUserId: owner.id,
      barcode: `STRESS-P-${id}`,
      sku: `STRESS-SKU-${id}`,
      name: `Stress product ${id}`,
      category: `Stress category ${sequence % 20}`,
      costPrice: 10,
      price: 15,
      sellingPrice: 15,
      stock: 0,
      lowStockThreshold: 5,
    };
  });

  await createInBatches("products", rows, (slice) =>
    prisma.product.createMany({ data: slice, skipDuplicates: true }),
  );
  const total = await prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
  });
  console.log(JSON.stringify({ scenario: "WORST-CASE SINGLE TENANT", businessId: business.id, products: total }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
