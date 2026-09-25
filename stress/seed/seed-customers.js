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
  const target = Number(process.env.STRESS_CUSTOMERS || 10000);
  const existing = await prisma.customer.count({
    where: { businessId: business.id, mobile: { startsWith: "0399" } },
  });
  const needed = Math.max(0, target - existing);
  console.log(`Customer/Khata volume seed. Target ${target}. Existing ${existing}. Inserting ${needed}.`);

  const rows = Array.from({ length: needed }, (_, index) => {
    const sequence = existing + index + 1;
    const id = String(sequence).padStart(6, "0");
    const opening = 500 + (sequence % 50) * 10;
    const mobile = `0399${String(sequence).padStart(7, "0")}`.slice(0, 11); // 0399XXXXXXX
    return {
      businessId: business.id,
      name: `Stress customer ${id}`,
      mobile,
      email: `stress_customer_${id}@example.test`,
      openingBalance: opening,
      currentBalance: opening,
      totalSpent: 0,
      visitCount: 0,
    };
  });

  await createInBatches("customers", rows, (slice) =>
    prisma.customer.createMany({ data: slice, skipDuplicates: true }),
  );

  const total = await prisma.customer.count({
    where: { businessId: business.id, mobile: { startsWith: "0399" } },
  });
  const withBalance = await prisma.customer.count({
    where: { businessId: business.id, mobile: { startsWith: "0399" }, currentBalance: { gt: 0 } },
  });
  console.log(JSON.stringify({
    scenario: "WORST-CASE SINGLE TENANT",
    businessId: business.id,
    customers: total,
    withKhataBalance: withBalance,
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
