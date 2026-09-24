const { loadStressEnv, assertStressEnvironment } = require("../lib/safety");

loadStressEnv();
assertStressEnvironment();

const { prisma } = require("./common");

async function ids(model, where) {
  const rows = await prisma[model].findMany({ where, select: { id: true } });
  return rows.map((row) => row.id);
}

async function main() {
  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { name: { startsWith: "stress_" } },
        { name: { startsWith: "loadtest_" } },
      ],
    },
    select: { id: true },
  });
  const businessIds = businesses.map((row) => row.id);
  console.log(`Cleanup matched ${businessIds.length} stress businesses.`);

  if (businessIds.length > 0) {
    const saleIds = await ids("sale", { businessId: { in: businessIds } });
    await prisma.stockLog.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.ledgerTransaction.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.payment.deleteMany({ where: { businessId: { in: businessIds } } });
    if (saleIds.length > 0) {
      await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    }
    await prisma.sale.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.expense.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.dailyClosing.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.account.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.activityLog.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.customer.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.supplier.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.businessMember.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  }

  await prisma.product.deleteMany({
    where: {
      OR: [
        { barcode: { startsWith: "STRESS-" } },
        { barcode: { startsWith: "LOADTEST-" } },
      ],
    },
  });

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: "loadtest_" } },
        { email: { startsWith: "stress_" } },
        { email: "stress-owner@invalid.example" },
      ],
    },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.businessMember.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  console.log(JSON.stringify({ deletedBusinesses: businessIds.length, deletedUsers: userIds.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
