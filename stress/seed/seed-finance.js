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

async function ensureCashAccount(business) {
  let account = await prisma.account.findFirst({
    where: { businessId: business.id, name: "Stress Cash in hand" },
  });
  if (!account) {
    account = await prisma.account.create({
      data: {
        businessId: business.id,
        name: "Stress Cash in hand",
        type: "cash",
        openingBalance: 100000,
      },
    });
  }
  let bank = await prisma.account.findFirst({
    where: { businessId: business.id, name: "Stress Bank" },
  });
  if (!bank) {
    bank = await prisma.account.create({
      data: {
        businessId: business.id,
        name: "Stress Bank",
        type: "bank",
        openingBalance: 250000,
      },
    });
  }
  return { cash: account, bank };
}

async function main() {
  const hash = await passwordHash();
  const owner = await ensureSeedOwner(hash);
  const business = await ensureWorstCaseBusiness(owner);
  const accounts = await ensureCashAccount(business);

  const supplierTarget = Number(process.env.STRESS_SUPPLIERS || 1000);
  const expenseTarget = Number(process.env.STRESS_EXPENSES || 10000);
  const ledgerTarget = Number(process.env.STRESS_LEDGER || 10000);
  const paymentTarget = Number(process.env.STRESS_PAYMENTS || 5000);

  console.log("Cash/Accounts volume seed");
  console.log(`suppliers=${supplierTarget} expenses=${expenseTarget} ledger=${ledgerTarget} payments=${paymentTarget}`);

  const existingSuppliers = await prisma.supplier.count({
    where: { businessId: business.id, mobile: { startsWith: "0388" } },
  });
  const suppliersNeeded = Math.max(0, supplierTarget - existingSuppliers);
  const supplierRows = Array.from({ length: suppliersNeeded }, (_, index) => {
    const sequence = existingSuppliers + index + 1;
    const id = String(sequence).padStart(6, "0");
    const opening = 200 + (sequence % 40) * 5;
    return {
      businessId: business.id,
      name: `Stress supplier ${id}`,
      mobile: `0388${id}`,
      email: `stress_supplier_${id}@example.test`,
      openingBalance: opening,
      currentBalance: opening,
    };
  });
  await createInBatches("suppliers", supplierRows, (slice) =>
    prisma.supplier.createMany({ data: slice, skipDuplicates: true }),
  );

  const existingExpenses = await prisma.expense.count({
    where: { businessId: business.id, category: { startsWith: "Stress expense" } },
  });
  const expensesNeeded = Math.max(0, expenseTarget - existingExpenses);
  const expenseRows = Array.from({ length: expensesNeeded }, (_, index) => {
    const sequence = existingExpenses + index + 1;
    return {
      businessId: business.id,
      accountId: accounts.cash.id,
      amount: 50 + (sequence % 100),
      category: `Stress expense ${(sequence % 20) + 1}`,
      description: `Stress seeded expense ${sequence}`,
      createdById: owner.id,
    };
  });
  await createInBatches("expenses", expenseRows, (slice) =>
    prisma.expense.createMany({ data: slice }),
  );

  const existingLedger = await prisma.ledgerTransaction.count({
    where: { businessId: business.id, note: { startsWith: "stress seed ledger" } },
  });
  const ledgerNeeded = Math.max(0, ledgerTarget - existingLedger);
  const ledgerRows = Array.from({ length: ledgerNeeded }, (_, index) => {
    const sequence = existingLedger + index + 1;
    const credit = sequence % 2 === 0;
    return {
      businessId: business.id,
      accountId: credit ? accounts.bank.id : accounts.cash.id,
      type: credit ? "other" : "expense",
      direction: credit ? "credit" : "debit",
      amount: 25 + (sequence % 75),
      note: `stress seed ledger ${sequence}`,
      createdById: owner.id,
    };
  });
  await createInBatches("ledger", ledgerRows, (slice) =>
    prisma.ledgerTransaction.createMany({ data: slice }),
  );

  const customers = await prisma.customer.findMany({
    where: { businessId: business.id, mobile: { startsWith: "0399" } },
    select: { id: true, currentBalance: true },
    take: paymentTarget,
    orderBy: { id: "asc" },
  });
  const existingPayments = await prisma.payment.count({
    where: { businessId: business.id, reference: { startsWith: "STRESS-PAY-" } },
  });
  const paymentsNeeded = Math.max(0, Math.min(paymentTarget, customers.length) - existingPayments);
  const paymentRows = [];
  for (let index = 0; index < paymentsNeeded; index += 1) {
    const customer = customers[index];
    if (!customer) break;
    const sequence = existingPayments + index + 1;
    const id = String(sequence).padStart(6, "0");
    const amount = Math.min(50, Number(customer.currentBalance) || 50);
    paymentRows.push({
      businessId: business.id,
      accountId: accounts.cash.id,
      customerId: customer.id,
      amount,
      type: "customer",
      method: "cash",
      reference: `STRESS-PAY-${id}`,
      createdById: owner.id,
    });
  }
  await createInBatches("payments", paymentRows, (slice) =>
    prisma.payment.createMany({ data: slice, skipDuplicates: true }),
  );
  // Balances were set at customer seed time; payment rows here are volume history for list/report reads.

  const summary = {
    scenario: "WORST-CASE SINGLE TENANT",
    businessId: business.id,
    accounts: await prisma.account.count({ where: { businessId: business.id } }),
    suppliers: await prisma.supplier.count({ where: { businessId: business.id, mobile: { startsWith: "0388" } } }),
    expenses: await prisma.expense.count({ where: { businessId: business.id } }),
    ledgerTransactions: await prisma.ledgerTransaction.count({ where: { businessId: business.id } }),
    payments: await prisma.payment.count({ where: { businessId: business.id, reference: { startsWith: "STRESS-PAY-" } } }),
    customers: await prisma.customer.count({ where: { businessId: business.id, mobile: { startsWith: "0399" } } }),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
