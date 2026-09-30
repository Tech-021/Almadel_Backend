/**
 * API/service-layer ACID concurrency suite.
 * Exercises production service paths (not only raw SQL).
 */

const { WORST_CASE_BUSINESS } = require("../lib/constants");
const { createPartyPayment } = require("../../modules/finance/payment.service");
const { createSale } = require("../../modules/sales/checkout.service");
const { receiveStock } = require("../../modules/stock/stock.service");
const { toMoneyNumber } = require("../../utils/money");

function prisma() {
  return require("../../db").prisma;
}

function row(test, expected, actual, pass, extra = {}) {
  return {
    test,
    expected,
    actual,
    result: pass ? "PASS" : "FAIL",
    ...extra,
  };
}

async function resolveBusiness() {
  const business = await prisma().business.findFirst({
    where: { name: WORST_CASE_BUSINESS },
    select: { id: true, ownerId: true, name: true },
  });
  if (!business) throw new Error(`Missing business ${WORST_CASE_BUSINESS}`);
  return business;
}

async function ensureCashAccount(businessId) {
  return prisma().account.upsert({
    where: { businessId_name: { businessId, name: "Cash in hand" } },
    update: {},
    create: { businessId, name: "Cash in hand", type: "cash", openingBalance: 0 },
  });
}

async function testConcurrentCheckout(business) {
  const results = [];
  const stamp = Date.now();
  const product = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `ACID-API-STOCK-${stamp}`,
      name: "acid api stock",
      price: 10,
      sellingPrice: 10,
      stock: 1,
      createdByUserId: business.ownerId,
    },
  });

  // Ensure register open
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  await prisma().dailyClosing.deleteMany({
    where: { businessId: business.id, businessDate: day },
  }).catch(() => {});

  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      prisma().$transaction((tx) =>
        createSale(
          tx,
          { id: business.ownerId, businessId: business.id },
          [{ productId: product.id, quantity: 1 }],
          { paymentMethod: "cash", offlineInvoiceNumber: `ACID-API-CHK-${stamp}-${i}` },
        ),
      ),
    ),
  );

  const success = outcomes.filter((o) => o.status === "fulfilled").length;
  const after = await prisma().product.findUnique({ where: { id: product.id } });
  const sales = await prisma().sale.count({
    where: { businessId: business.id, invoiceNumber: { startsWith: `ACID-API-CHK-${stamp}` } },
  });
  const logs = await prisma().stockLog.count({
    where: { productId: product.id, note: "SALE" },
  });

  const pass = success === 1 && after.stock === 0 && sales === 1 && logs === 1;
  results.push(
    row(
      "Concurrent checkout stock=1 (10 requests)",
      "1 success, stock=0, 1 sale, 1 stock log",
      `success=${success}, stock=${after.stock}, sales=${sales}, logs=${logs}`,
      pass,
    ),
  );

  await prisma().ledgerTransaction.deleteMany({
    where: { payment: { sale: { invoiceNumber: { startsWith: `ACID-API-CHK-${stamp}` } } } },
  }).catch(() => {});
  await prisma().payment.deleteMany({
    where: { sale: { invoiceNumber: { startsWith: `ACID-API-CHK-${stamp}` } } },
  }).catch(() => {});
  await prisma().saleItem.deleteMany({
    where: { sale: { invoiceNumber: { startsWith: `ACID-API-CHK-${stamp}` } } },
  }).catch(() => {});
  await prisma().sale.deleteMany({
    where: { businessId: business.id, invoiceNumber: { startsWith: `ACID-API-CHK-${stamp}` } },
  }).catch(() => {});
  await prisma().stockLog.deleteMany({ where: { productId: product.id } }).catch(() => {});
  await prisma().product.delete({ where: { id: product.id } }).catch(() => {});

  return results;
}

async function testConcurrentPayments(business) {
  const results = [];
  const stamp = Date.now();
  const account = await ensureCashAccount(business.id);
  const customer = await prisma().customer.create({
    data: {
      businessId: business.id,
      name: "acid pay race",
      mobile: `0388${String(stamp).slice(-7)}`,
      openingBalance: 100,
      currentBalance: 100,
    },
  });

  const race = await Promise.allSettled([
    prisma().$transaction((tx) =>
      createPartyPayment(tx, {
        businessId: business.id,
        userId: business.ownerId,
        accountId: account.id,
        partyId: customer.id,
        type: "customer",
        amount: 80,
        reference: `race-a-${stamp}`,
      }),
    ),
    prisma().$transaction((tx) =>
      createPartyPayment(tx, {
        businessId: business.id,
        userId: business.ownerId,
        accountId: account.id,
        partyId: customer.id,
        type: "customer",
        amount: 80,
        reference: `race-b-${stamp}`,
      }),
    ),
  ]);

  const ok = race.filter((r) => r.status === "fulfilled").length;
  const after = await prisma().customer.findUnique({ where: { id: customer.id } });
  const payments = await prisma().payment.count({
    where: { customerId: customer.id, reference: { startsWith: `race-` } },
  });
  const ledgers = await prisma().ledgerTransaction.count({
    where: { payment: { customerId: customer.id, reference: { startsWith: `race-` } } },
  });

  const pass =
    ok === 1 &&
    toMoneyNumber(after.currentBalance) === 20 &&
    payments === 1 &&
    ledgers === 1;

  results.push(
    row(
      "Concurrent payments 80+80 on balance 100",
      "1 success, balance=20, 1 payment, 1 ledger",
      `ok=${ok}, balance=${toMoneyNumber(after.currentBalance)}, payments=${payments}, ledgers=${ledgers}`,
      pass,
    ),
  );

  // 50+50 both should succeed
  await prisma().customer.update({
    where: { id: customer.id },
    data: { currentBalance: 100 },
  });
  const both = await Promise.allSettled([
    prisma().$transaction((tx) =>
      createPartyPayment(tx, {
        businessId: business.id,
        userId: business.ownerId,
        accountId: account.id,
        partyId: customer.id,
        type: "customer",
        amount: 50,
        reference: `split-a-${stamp}`,
      }),
    ),
    prisma().$transaction((tx) =>
      createPartyPayment(tx, {
        businessId: business.id,
        userId: business.ownerId,
        accountId: account.id,
        partyId: customer.id,
        type: "customer",
        amount: 50,
        reference: `split-b-${stamp}`,
      }),
    ),
  ]);
  const bothOk = both.filter((r) => r.status === "fulfilled").length;
  const afterSplit = await prisma().customer.findUnique({ where: { id: customer.id } });
  results.push(
    row(
      "Concurrent payments 50+50 on balance 100",
      "2 success, balance=0",
      `ok=${bothOk}, balance=${toMoneyNumber(afterSplit.currentBalance)}`,
      bothOk === 2 && toMoneyNumber(afterSplit.currentBalance) === 0,
    ),
  );

  // Idempotent retry
  await prisma().customer.update({
    where: { id: customer.id },
    data: { currentBalance: 40 },
  });
  const key = `idem-${stamp}`;
  const first = await prisma().$transaction((tx) =>
    createPartyPayment(tx, {
      businessId: business.id,
      userId: business.ownerId,
      accountId: account.id,
      partyId: customer.id,
      type: "customer",
      amount: 10,
      idempotencyKey: key,
    }),
  );
  let reuseOk = false;
  try {
    await prisma().$transaction((tx) =>
      createPartyPayment(tx, {
        businessId: business.id,
        userId: business.ownerId,
        accountId: account.id,
        partyId: customer.id,
        type: "customer",
        amount: 10,
        idempotencyKey: key,
      }),
    );
  } catch (e) {
    reuseOk = e.code === "PAYMENT_ALREADY_PROCESSED" && e.payment?.id === first.id;
  }
  const afterIdem = await prisma().customer.findUnique({ where: { id: customer.id } });
  const payCount = await prisma().payment.count({
    where: { customerId: customer.id, reference: key },
  });
  results.push(
    row(
      "Duplicate payment retry (idempotencyKey)",
      "reuse existing; balance decremented once",
      `reuseOk=${reuseOk}, balance=${toMoneyNumber(afterIdem.currentBalance)}, payments=${payCount}`,
      reuseOk && toMoneyNumber(afterIdem.currentBalance) === 30 && payCount === 1,
    ),
  );

  await prisma().ledgerTransaction.deleteMany({
    where: { payment: { customerId: customer.id } },
  }).catch(() => {});
  await prisma().payment.deleteMany({ where: { customerId: customer.id } }).catch(() => {});
  await prisma().customer.delete({ where: { id: customer.id } }).catch(() => {});

  return results;
}

async function testCloseThenCheckout(business) {
  const results = [];
  const stamp = Date.now();
  const day = new Date();
  day.setHours(0, 0, 0, 0);

  await prisma().dailyClosing.upsert({
    where: { businessId_businessDate: { businessId: business.id, businessDate: day } },
    update: { status: "closed", closedAt: new Date(), expectedCash: 0, countedCash: 0, difference: 0 },
    create: {
      businessId: business.id,
      businessDate: day,
      status: "closed",
      openingCash: 0,
      expectedCash: 0,
      countedCash: 0,
      difference: 0,
      closedAt: new Date(),
    },
  });

  const product = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `ACID-API-CLOSED-${stamp}`,
      name: "closed day",
      price: 5,
      sellingPrice: 5,
      stock: 5,
      createdByUserId: business.ownerId,
    },
  });

  let rejected = false;
  let code = null;
  try {
    await prisma().$transaction((tx) =>
      createSale(
        tx,
        { id: business.ownerId, businessId: business.id },
        [{ productId: product.id, quantity: 1 }],
        { paymentMethod: "cash", offlineInvoiceNumber: `ACID-API-CLOSED-${stamp}` },
      ),
    );
  } catch (e) {
    rejected = true;
    code = e.code;
  }

  const sales = await prisma().sale.count({
    where: { invoiceNumber: `ACID-API-CLOSED-${stamp}` },
  });
  const after = await prisma().product.findUnique({ where: { id: product.id } });

  results.push(
    row(
      "Checkout rejected when register closed",
      "REGISTER_CLOSED; no sale; stock unchanged",
      `rejected=${rejected}, code=${code}, sales=${sales}, stock=${after.stock}`,
      rejected && code === "REGISTER_CLOSED" && sales === 0 && after.stock === 5,
    ),
  );

  await prisma().dailyClosing.updateMany({
    where: { businessId: business.id, businessDate: day },
    data: { status: "reopened", reopenedAt: new Date() },
  });
  await prisma().product.delete({ where: { id: product.id } }).catch(() => {});

  return results;
}

async function testCloseVsCheckoutRace(business) {
  const results = [];
  const stamp = Date.now();
  const day = new Date();
  day.setHours(0, 0, 0, 0);

  await prisma().dailyClosing.deleteMany({
    where: { businessId: business.id, businessDate: day },
  }).catch(() => {});

  const product = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `ACID-API-RACE-${stamp}`,
      name: "race day",
      price: 7,
      sellingPrice: 7,
      stock: 3,
      createdByUserId: business.ownerId,
    },
  });

  const [saleOutcome, closeOutcome] = await Promise.allSettled([
    prisma().$transaction((tx) =>
      createSale(
        tx,
        { id: business.ownerId, businessId: business.id },
        [{ productId: product.id, quantity: 1 }],
        { paymentMethod: "cash", offlineInvoiceNumber: `ACID-API-RACE-${stamp}` },
      ),
    ),
    prisma().$transaction(async (tx) => {
      await tx.$queryRaw`
        INSERT INTO daily_closings (
          "businessId", "businessDate", status, "openingCash", "expectedCash", "createdAt", "updatedAt"
        ) VALUES (${business.id}, ${day}::date, 'open', 0, 0, NOW(), NOW())
        ON CONFLICT ("businessId", "businessDate")
        DO UPDATE SET "updatedAt" = daily_closings."updatedAt"
      `;
      const updated = await tx.dailyClosing.updateMany({
        where: { businessId: business.id, businessDate: day, status: { not: "closed" } },
        data: {
          status: "closed",
          countedCash: 0,
          expectedCash: 0,
          difference: 0,
          closedAt: new Date(),
          closedById: business.ownerId,
        },
      });
      if (updated.count !== 1) throw new Error("close lost race");
      return true;
    }),
  ]);

  const closing = await prisma().dailyClosing.findUnique({
    where: { businessId_businessDate: { businessId: business.id, businessDate: day } },
  });
  const sale = await prisma().sale.findFirst({
    where: { invoiceNumber: `ACID-API-RACE-${stamp}` },
  });

  // Valid serializations:
  // A) sale fulfilled and closing closed (sale before close)
  // B) sale rejected REGISTER_CLOSED and closing closed
  const saleOk = saleOutcome.status === "fulfilled";
  const closeOk = closeOutcome.status === "fulfilled";
  const valid =
    closing?.status === "closed" &&
    ((saleOk && sale) || (!saleOk && !sale && saleOutcome.reason?.code === "REGISTER_CLOSED"));

  results.push(
    row(
      "Checkout vs close race serialization",
      "closed day; sale either included before close or rejected",
      `saleOk=${saleOk}, closeOk=${closeOk}, status=${closing?.status}, hasSale=${Boolean(sale)}`,
      valid && closeOk,
    ),
  );

  if (sale) {
    await prisma().ledgerTransaction.deleteMany({ where: { payment: { saleId: sale.id } } }).catch(() => {});
    await prisma().payment.deleteMany({ where: { saleId: sale.id } }).catch(() => {});
    await prisma().saleItem.deleteMany({ where: { saleId: sale.id } }).catch(() => {});
    await prisma().sale.delete({ where: { id: sale.id } }).catch(() => {});
  }
  await prisma().stockLog.deleteMany({ where: { productId: product.id } }).catch(() => {});
  await prisma().product.delete({ where: { id: product.id } }).catch(() => {});
  await prisma().dailyClosing.updateMany({
    where: { businessId: business.id, businessDate: day },
    data: { status: "reopened" },
  }).catch(() => {});

  return results;
}

async function testReceiveAtomicity(business) {
  const results = [];
  const stamp = Date.now();
  const product = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `ACID-API-RCV-${stamp}`,
      name: "receive",
      price: 1,
      sellingPrice: 1,
      stock: 10,
      createdByUserId: business.ownerId,
    },
  });

  let rolledBack = false;
  try {
    await prisma().$transaction(async (tx) => {
      await receiveStock(tx, {
        businessId: business.id,
        productId: product.id,
        quantity: 5,
        note: "acid receive",
        userId: business.ownerId,
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    rolledBack = /forced rollback/.test(e.message);
  }

  const afterFail = await prisma().product.findUnique({ where: { id: product.id } });
  const logsFail = await prisma().stockLog.count({ where: { productId: product.id } });
  results.push(
    row(
      "Receive rollback leaves no partial state",
      "stock unchanged, 0 logs",
      `stock=${afterFail.stock}, logs=${logsFail}`,
      rolledBack && afterFail.stock === 10 && logsFail === 0,
    ),
  );

  await prisma().$transaction(async (tx) => {
    await receiveStock(tx, {
      businessId: business.id,
      productId: product.id,
      quantity: 3,
      note: "acid receive ok",
      userId: business.ownerId,
    });
  });
  const afterOk = await prisma().product.findUnique({ where: { id: product.id } });
  const logsOk = await prisma().stockLog.count({ where: { productId: product.id } });
  results.push(
    row(
      "Successful receive increments stock + one log",
      "stock=13, logs=1",
      `stock=${afterOk.stock}, logs=${logsOk}`,
      afterOk.stock === 13 && logsOk === 1,
    ),
  );

  await prisma().stockLog.deleteMany({ where: { productId: product.id } }).catch(() => {});
  await prisma().product.delete({ where: { id: product.id } }).catch(() => {});
  return results;
}

async function testCategoryAtomicity(business) {
  const results = [];
  const stamp = Date.now();
  const cat = await prisma().category.create({
    data: { businessId: business.id, name: `ACID-CAT-API-${stamp}` },
  });
  const product = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `ACID-API-CAT-${stamp}`,
      name: "cat p",
      category: cat.name,
      price: 1,
      sellingPrice: 1,
      stock: 0,
      createdByUserId: business.ownerId,
    },
  });

  let rolledBack = false;
  try {
    await prisma().$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { businessId: business.id, category: cat.name },
        data: { category: `${cat.name}-REN` },
      });
      await tx.category.update({
        where: { id: cat.id },
        data: { name: `${cat.name}-REN` },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    rolledBack = /forced rollback/.test(e.message);
  }

  const catAfter = await prisma().category.findUnique({ where: { id: cat.id } });
  const prodAfter = await prisma().product.findUnique({ where: { id: product.id } });
  results.push(
    row(
      "Category rename rollback keeps product/category consistent",
      "original names restored",
      `cat=${catAfter.name}, productCategory=${prodAfter.category}`,
      rolledBack && catAfter.name === cat.name && prodAfter.category === cat.name,
    ),
  );

  await prisma().product.delete({ where: { id: product.id } }).catch(() => {});
  await prisma().category.delete({ where: { id: cat.id } }).catch(() => {});
  return results;
}

async function testProductDeleteRestrict(business) {
  const results = [];
  const stamp = Date.now();
  const product = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `ACID-API-DEL-${stamp}`,
      name: "del",
      price: 2,
      sellingPrice: 2,
      stock: 5,
      createdByUserId: business.ownerId,
    },
  });

  // Ensure open register
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  await prisma().dailyClosing.updateMany({
    where: { businessId: business.id, businessDate: day, status: "closed" },
    data: { status: "reopened" },
  }).catch(() => {});

  const sale = await prisma().$transaction((tx) =>
    createSale(
      tx,
      { id: business.ownerId, businessId: business.id },
      [{ productId: product.id, quantity: 1 }],
      { paymentMethod: "cash", offlineInvoiceNumber: `ACID-API-DEL-${stamp}` },
    ),
  );

  let blocked = false;
  try {
    await prisma().product.delete({ where: { id: product.id } });
  } catch (e) {
    blocked = e.code === "P2003" || /foreign key|restrict/i.test(e.message || "");
  }
  const itemStill = await prisma().saleItem.count({ where: { saleId: sale.id } });

  results.push(
    row(
      "Product hard-delete blocked when SaleItem exists",
      "FK restrict; sale items intact",
      `blocked=${blocked}, items=${itemStill}`,
      blocked && itemStill >= 1,
    ),
  );

  await prisma().ledgerTransaction.deleteMany({ where: { payment: { saleId: sale.id } } }).catch(() => {});
  await prisma().payment.deleteMany({ where: { saleId: sale.id } }).catch(() => {});
  await prisma().saleItem.deleteMany({ where: { saleId: sale.id } }).catch(() => {});
  await prisma().sale.delete({ where: { id: sale.id } }).catch(() => {});
  await prisma().stockLog.deleteMany({ where: { productId: product.id } }).catch(() => {});
  await prisma().product.delete({ where: { id: product.id } }).catch(() => {});

  return results;
}

async function runAcidApiSuite() {
  const business = await resolveBusiness();
  const cases = [];
  cases.push(...(await testConcurrentCheckout(business)));
  cases.push(...(await testConcurrentPayments(business)));
  cases.push(...(await testCloseThenCheckout(business)));
  cases.push(...(await testCloseVsCheckoutRace(business)));
  cases.push(...(await testReceiveAtomicity(business)));
  cases.push(...(await testCategoryAtomicity(business)));
  cases.push(...(await testProductDeleteRestrict(business)));

  const fail = cases.filter((c) => c.result !== "PASS").length;
  return {
    scenario: "API/SERVICE ACID CONCURRENCY",
    businessId: business.id,
    cases,
    summary: {
      total: cases.length,
      pass: cases.length - fail,
      fail,
    },
  };
}

module.exports = { runAcidApiSuite };
