/**
 * Demo data for local development: one shop ("Noor Mobiles") with its owner, staff and an accountant,
 * a catalogue, customers on khata, suppliers, and 90 days of sales, expenses and closings —
 * enough for every list, figure and chart in the web app to show real shapes.
 *
 * Writes the same rows checkout and finance write (sale → payment → ledger credit; expense → ledger
 * debit), so the dashboard, reports, cash book and daily closing all agree with each other.
 *
 *   npm run db:seed:demo            # create or rebuild the demo shop (idempotent)
 *   npm run db:seed:demo -- --days 30
 *
 * Only touches the demo users and the business they own. Refuses to run with NODE_ENV=production.
 * Data, not schema, so it is a seed script rather than a Prisma migration (migrations also run in production).
 */
require("dotenv").config({ override: false });

const bcrypt = require("bcryptjs");
const { prisma } = require("../db");

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}

const argDays = process.argv.indexOf("--days");
const DAYS = argDays > -1 ? Math.max(1, Number(process.argv[argDays + 1]) || 90) : 90;
const PASSWORD = "Demo@12345";

const USERS = [
  { email: "demo@almadel.pk", fullName: "Imran Noor", role: "admin", member: "owner" },
  { email: "ali.staff@almadel.pk", fullName: "Ali Raza", role: "staff", member: "staff" },
  { email: "sana.staff@almadel.pk", fullName: "Sana Iqbal", role: "staff", member: "staff" },
  { email: "accounts@almadel.pk", fullName: "Usman Khalid", role: "accountant", member: "accountant" },
];

const CATEGORIES = ["Phones", "Chargers", "Cables", "Audio", "Cases & Glass", "Power Banks"];

// name, category, cost, price, opening stock, low-stock alert
const PRODUCTS = [
  ["Infinix Hot 40", "Phones", 31500, 34900, 9, 3],
  ["Tecno Spark 20", "Phones", 27800, 30999, 6, 3],
  ["Samsung Galaxy A15", "Phones", 42000, 46500, 4, 2],
  ["Redmi 13C", "Phones", 29500, 32800, 0, 2],
  ["Vivo Y03", "Phones", 24800, 27500, 7, 3],
  ["Samsung 25W Charger", "Chargers", 1650, 2350, 2, 10],
  ["Anker 20W USB-C Charger", "Chargers", 2400, 3300, 14, 6],
  ["Faster 3.1A Car Charger", "Chargers", 650, 1100, 22, 8],
  ["Type-C Cable 1m", "Cables", 240, 450, 0, 15],
  ["Type-C Cable 2m Braided", "Cables", 380, 700, 31, 12],
  ["Lightning Cable 1m", "Cables", 320, 600, 4, 10],
  ["Micro USB Cable", "Cables", 150, 300, 48, 15],
  ["Airbuds Pro", "Audio", 2300, 3500, 18, 6],
  ["Audionic Handsfree", "Audio", 450, 850, 26, 10],
  ["JBL Go 3 Speaker", "Audio", 6800, 8900, 5, 2],
  ["Tempered Glass A15", "Cases & Glass", 120, 400, 60, 20],
  ["Tempered Glass Universal 6.7\"", "Cases & Glass", 110, 350, 3, 20],
  ["Silicone Case Hot 40", "Cases & Glass", 220, 600, 17, 8],
  ["Clear Case A15", "Cases & Glass", 180, 500, 0, 8],
  ["Power Bank 10000mAh", "Power Banks", 2600, 3800, 12, 4],
  ["Power Bank 20000mAh", "Power Banks", 3900, 5400, 8, 4],
  ["Ronin R-750 Power Bank", "Power Banks", 4400, 6200, 2, 3],
];

const CUSTOMERS = [
  ["Bilal Ahmed", "03214451182", 28300],
  ["Rashid Electronics", "03004418820", 46500],
  ["Hamza Traders", "03335512094", 12750],
  ["Ayesha Malik", "03451120934", 0],
  ["Faisal Mobile Zone", "03017723418", 31200],
  ["Kamran Shah", "03128876510", 4200],
  ["Nadia Hussain", "03239901276", 0],
  ["Zubair Communication", "03065512879", 18900],
  ["Shahid Iqbal", "03458812093", 2600],
  ["Mehwish Ali", "03311198740", 0],
  ["Waqas Telecom", "03007712655", 22400],
  ["Saad Qureshi", "03156690322", 0],
];

const SUPPLIERS = [
  ["Hall Road Wholesale", "03004561230", 85000],
  ["Infinix Distributor Lahore", "03218890011", 140000],
  ["Accessories Hub Karachi", "03332234567", 26500],
  ["Anker Pakistan", "03451239876", 0],
];

const WALK_IN_NAMES = ["Walk-in Customer", "Walk-in Customer", "Walk-in Customer", "Usman", "Hira", "Asad", "Zainab", "Talha", "Maryam", "Owais"];

/* ---------- deterministic randomness: the same shop every run ---------- */
let state = 0x2f6b9a13;
const rand = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return ((state >>> 0) % 1_000_000) / 1_000_000;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
const money = (n) => Math.round(n * 100) / 100;

/** Busier on weekends and in the evening, like a mobile shop in a market. */
const WEEKDAY_WEIGHT = [1.35, 0.85, 0.9, 0.95, 1.05, 1.25, 1.45]; // Sun..Sat
const HOURS = [10, 11, 12, 12, 13, 14, 15, 16, 17, 17, 18, 18, 19, 19, 19, 20, 20, 21, 21, 22];

function invoiceNumber(date, n) {
  // Local calendar date (toISOString would give yesterday's date before 5 AM UTC+5).
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `ALM-${d}-${String(n).padStart(4, "0")}`;
}

function atTime(day, hour, minute) {
  const d = new Date(day);
  d.setHours(hour, minute, between(0, 59), 0);
  return d;
}

async function resetDemoBusiness(ownerId) {
  const business = await prisma.business.findUnique({ where: { ownerId } });
  if (!business) return;
  const where = { businessId: business.id };
  // Children before parents: sale items restrict product deletes, ledger rows restrict accounts.
  await prisma.ledgerTransaction.deleteMany({ where });
  await prisma.payment.deleteMany({ where });
  await prisma.expense.deleteMany({ where });
  await prisma.saleItem.deleteMany({ where: { sale: { businessId: business.id } } });
  await prisma.sale.deleteMany({ where });
  await prisma.stockLog.deleteMany({ where });
  await prisma.product.deleteMany({ where });
  await prisma.customer.deleteMany({ where });
  await prisma.supplier.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.dailyClosing.deleteMany({ where });
  await prisma.activityLog.deleteMany({ where });
  await prisma.category.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.businessMember.deleteMany({ where });
  await prisma.business.delete({ where: { id: business.id } });
}

async function main() {
  console.log(`Seeding the demo shop with ${DAYS} days of trading…`);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // Users (upsert: keeps ids stable so existing sessions survive a re-seed)
  const users = {};
  for (const u of USERS) {
    users[u.member === "owner" ? "owner" : u.email] = await prisma.user.upsert({
      where: { email: u.email },
      update: { fullName: u.fullName, role: u.role, passwordHash },
      create: { email: u.email, fullName: u.fullName, role: u.role, passwordHash },
    });
  }
  const owner = users.owner;
  const staffUsers = USERS.filter((u) => u.member === "staff").map((u) => users[u.email]);
  // A staff member belongs to one business: free them from any other before re-adding.
  await prisma.businessMember.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
  await resetDemoBusiness(owner.id);

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const firstDay = new Date(today);
  firstDay.setDate(firstDay.getDate() - (DAYS - 1));

  const business = await prisma.business.create({
    data: {
      name: "Noor Mobiles",
      businessType: "Mobile Shop",
      businessCategory: "Mobiles & accessories",
      mobileNumber: "03001234567",
      whatsappNumber: "03001234567",
      email: "hello@noormobiles.pk",
      address: "Shop 14, Hafeez Centre, Gulberg III",
      city: "Lahore",
      area: "Gulberg",
      province: "Punjab",
      accountingStartDate: firstDay,
      openingCashBalance: 25000,
      openingBankBalance: 180000,
      hasCustomerUdhaar: true,
      hasSupplierUdhaar: true,
      workspaceMode: "financial",
      subscriptionStatus: "active",
      trialEndsAt: new Date(now.getTime() + 21 * 86400000),
      currentPeriodEnd: new Date(now.getTime() + 21 * 86400000),
      ownerId: owner.id,
    },
  });
  const businessId = business.id;

  await prisma.businessMember.createMany({
    data: USERS.map((u) => ({ businessId, userId: (u.member === "owner" ? owner : users[u.email]).id, role: u.member })),
  });
  await prisma.branch.create({ data: { businessId, name: "Main Branch", code: "HC-14", city: "Lahore", phone: "03001234567", isMain: true } });
  await prisma.category.createMany({ data: CATEGORIES.map((name) => ({ businessId, name })) });

  const [cash, online, bank] = await prisma.account.createManyAndReturn({
    data: [
      { businessId, name: "Cash in hand", type: "cash", openingBalance: 25000 },
      { businessId, name: "Online / Wallet", type: "online", openingBalance: 0 },
      { businessId, name: "Meezan Bank", type: "bank", openingBalance: 180000 },
    ],
  });

  // Catalogue. Sales draw stock down, so open with what was sold on top of what is left today.
  const products = await prisma.product.createManyAndReturn({
    data: PRODUCTS.map(([name, category, cost, price, stock, low], i) => ({
      businessId,
      barcode: `8964${String(100200 + i * 37).padStart(8, "0")}`,
      sku: `NM-${String(i + 1).padStart(3, "0")}`,
      name,
      category,
      costPrice: cost,
      price,
      sellingPrice: price,
      stock,
      lowStockThreshold: low,
      discountType: name === "Airbuds Pro" ? "percentage" : "none",
      discountValue: name === "Airbuds Pro" ? 5 : 0,
      createdByUserId: owner.id,
      createdAt: firstDay,
    })),
  });
  const sold = new Map(products.map((p) => [p.id, 0]));
  // Phones sell rarely, accessories often.
  const weighted = products.flatMap((p) => Array(p.category === "Phones" ? 1 : p.category === "Power Banks" || p.category === "Audio" ? 3 : 6).fill(p));

  const customers = await prisma.customer.createManyAndReturn({
    data: CUSTOMERS.map(([name, mobile, balance]) => ({
      businessId,
      name,
      mobile,
      openingBalance: balance,
      currentBalance: balance,
      createdAt: firstDay,
    })),
  });
  await prisma.supplier.createMany({
    data: SUPPLIERS.map(([name, mobile, balance]) => ({ businessId, name, mobile, openingBalance: balance, currentBalance: balance, createdAt: firstDay })),
  });

  /* ---------- sales, day by day ---------- */
  const sales = [];
  const customerSpend = new Map();
  let invoiceSeq = 0;
  for (let d = 0; d < DAYS; d += 1) {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + d);
    const isToday = day.getTime() === today.getTime();
    const growth = 0.8 + (d / DAYS) * 0.4; // the shop is growing
    const count = Math.round(between(14, 24) * WEEKDAY_WEIGHT[day.getDay()] * growth);
    for (let s = 0; s < count; s += 1) {
      const createdAt = atTime(day, pick(HOURS), between(0, 59));
      if (isToday && createdAt > now) continue; // today: only sales up to now
      const lines = new Map();
      const lineCount = rand() < 0.62 ? 1 : rand() < 0.75 ? 2 : between(3, 4);
      for (let l = 0; l < lineCount; l += 1) {
        const p = pick(weighted);
        lines.set(p.id, { product: p, quantity: (lines.get(p.id)?.quantity ?? 0) + (p.category === "Phones" ? 1 : between(1, 2)) });
      }
      const items = [...lines.values()].map(({ product, quantity }) => {
        const price = Number(product.price);
        const discountAmount = product.discountType === "percentage" ? money((price * quantity * Number(product.discountValue)) / 100) : 0;
        sold.set(product.id, sold.get(product.id) + quantity);
        return {
          productId: product.id,
          barcode: product.barcode,
          name: product.name,
          price,
          quantity,
          discountType: product.discountType,
          discountValue: Number(product.discountValue),
          discountAmount,
          total: money(price * quantity - discountAmount),
        };
      });
      const subtotal = money(items.reduce((sum, i) => sum + i.price * i.quantity, 0));
      const lineDiscounts = money(items.reduce((sum, i) => sum + i.discountAmount, 0));
      const billDiscount = rand() < 0.12 ? Math.min(500, Math.round(subtotal * 0.03 / 10) * 10) : 0;
      const totalAmount = money(subtotal - lineDiscounts - billDiscount);
      const regular = rand() < 0.22 ? pick(customers) : null;
      const paymentMethod = rand() < (subtotal > 20000 ? 0.55 : 0.32) ? "online" : "cash";
      if (regular) customerSpend.set(regular.id, (customerSpend.get(regular.id) ?? { total: 0, visits: 0, last: createdAt }));
      if (regular) {
        const c = customerSpend.get(regular.id);
        c.total += totalAmount;
        c.visits += 1;
        if (createdAt > c.last) c.last = createdAt;
      }
      invoiceSeq += 1;
      sales.push({
        sale: {
          businessId,
          invoiceNumber: invoiceNumber(day, invoiceSeq),
          subtotal,
          discountType: billDiscount ? "fixed" : "none",
          discountValue: billDiscount,
          discountAmount: money(lineDiscounts + billDiscount),
          totalAmount,
          totalItems: items.reduce((sum, i) => sum + i.quantity, 0),
          paymentMethod,
          customerName: regular?.name ?? pick(WALK_IN_NAMES),
          customerMobile: regular?.mobile ?? null,
          customerId: regular?.id ?? null,
          userId: rand() < 0.45 ? owner.id : pick(staffUsers).id,
          createdAt,
        },
        items,
      });
    }
  }
  sales.sort((a, b) => a.sale.createdAt - b.sale.createdAt);

  const BATCH = 400;
  for (let i = 0; i < sales.length; i += BATCH) {
    const slice = sales.slice(i, i + BATCH);
    const created = await prisma.sale.createManyAndReturn({ data: slice.map((s) => s.sale), select: { id: true, invoiceNumber: true } });
    const idByInvoice = new Map(created.map((c) => [c.invoiceNumber, c.id]));
    await prisma.saleItem.createMany({ data: slice.flatMap((s) => s.items.map((item) => ({ ...item, saleId: idByInvoice.get(s.sale.invoiceNumber) }))) });
    const payments = await prisma.payment.createManyAndReturn({
      data: slice.map((s) => ({
        businessId,
        accountId: s.sale.paymentMethod === "cash" ? cash.id : online.id,
        saleId: idByInvoice.get(s.sale.invoiceNumber),
        customerId: s.sale.customerId,
        amount: s.sale.totalAmount,
        type: "sale",
        method: s.sale.paymentMethod,
        createdById: s.sale.userId,
        occurredAt: s.sale.createdAt,
        createdAt: s.sale.createdAt,
      })),
      select: { id: true, saleId: true, accountId: true, amount: true, occurredAt: true, createdById: true },
    });
    const invoiceBySale = new Map(created.map((c) => [c.id, c.invoiceNumber]));
    await prisma.ledgerTransaction.createMany({
      data: payments.map((p) => ({
        businessId,
        accountId: p.accountId,
        paymentId: p.id,
        type: "sale",
        direction: "credit",
        amount: p.amount,
        reference: invoiceBySale.get(p.saleId),
        occurredAt: p.occurredAt,
        createdAt: p.occurredAt,
        createdById: p.createdById,
      })),
    });
    process.stdout.write(`\r  sales ${Math.min(i + BATCH, sales.length)}/${sales.length}`);
  }
  process.stdout.write("\n");

  // Stock: open high enough to cover what was sold, end at today's levels.
  for (const p of products) {
    const qty = sold.get(p.id);
    await prisma.stockLog.create({
      data: { businessId, productId: p.id, barcode: p.barcode, quantity: p.stock + qty, previousStock: 0, newStock: p.stock + qty, note: "Opening stock", userId: owner.id, createdAt: firstDay },
    });
  }
  for (const [id, c] of customerSpend) {
    await prisma.customer.update({ where: { id }, data: { totalSpent: money(c.total), visitCount: c.visits, lastVisit: c.last } });
  }

  /* ---------- khata recoveries ---------- */
  let recovered = 0;
  for (const c of customers.filter((x) => Number(x.openingBalance) > 0)) {
    let balance = Number(c.openingBalance);
    const instalments = between(1, 3);
    for (let k = 0; k < instalments && balance > 2000; k += 1) {
      const amount = Math.round((balance * (0.15 + rand() * 0.25)) / 100) * 100;
      const when = atTime(new Date(firstDay.getTime() + between(5, DAYS - 1) * 86400000), between(11, 20), between(0, 59));
      if (when > now) continue;
      const viaOnline = rand() < 0.5;
      const payment = await prisma.payment.create({
        data: { businessId, accountId: viaOnline ? online.id : cash.id, customerId: c.id, amount, type: "customer", method: viaOnline ? "jazzcash" : "cash", reference: `KHT-${c.id}-${k + 1}`, createdById: owner.id, occurredAt: when, createdAt: when },
      });
      await prisma.ledgerTransaction.create({
        data: { businessId, accountId: payment.accountId, paymentId: payment.id, type: "customer_payment", direction: "credit", amount, reference: payment.reference, occurredAt: when, createdAt: when, createdById: owner.id },
      });
      balance -= amount;
      recovered += 1;
    }
    await prisma.customer.update({ where: { id: c.id }, data: { currentBalance: balance } });
  }

  /* ---------- expenses ---------- */
  const expenses = [];
  for (let d = 0; d < DAYS; d += 1) {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + d);
    if (day.getDate() === 1) expenses.push({ category: "Rent", description: "Shop rent", amount: 65000, account: bank, day, hour: 11 });
    if (day.getDate() === 5) expenses.push({ category: "Salaries", description: "Staff salaries", amount: 70000, account: bank, day, hour: 12 });
    if (day.getDate() === 10) expenses.push({ category: "Utilities", description: "Electricity bill", amount: between(14000, 22000), account: cash, day, hour: 13 });
    if (rand() < 0.75) expenses.push({ category: "Tea & refreshments", description: "Chai for the counter", amount: between(3, 12) * 100, account: cash, day, hour: 17 });
    if (rand() < 0.18) expenses.push({ category: "Transport", description: "Rickshaw to Hall Road", amount: between(4, 9) * 100, account: cash, day, hour: 15 });
  }
  for (const e of expenses) {
    const when = atTime(e.day, e.hour, between(0, 59));
    if (when > now) continue;
    const expense = await prisma.expense.create({
      data: { businessId, accountId: e.account.id, amount: e.amount, category: e.category, description: e.description, occurredAt: when, createdAt: when, createdById: owner.id },
    });
    await prisma.ledgerTransaction.create({
      data: { businessId, accountId: e.account.id, expenseId: expense.id, type: "expense", direction: "debit", amount: e.amount, reference: e.category, note: e.description, occurredAt: when, createdAt: when, createdById: owner.id },
    });
  }

  /* ---------- daily closings (every past day closed; today stays open) ---------- */
  const cashByDay = new Map();
  for (const { sale } of sales) {
    if (sale.paymentMethod !== "cash") continue;
    const key = sale.createdAt.toDateString();
    cashByDay.set(key, (cashByDay.get(key) ?? 0) + sale.totalAmount);
  }
  const closings = [];
  for (let d = 0; d < DAYS - 1; d += 1) {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + d);
    const expected = money(12000 + (cashByDay.get(day.toDateString()) ?? 0));
    const diff = rand() < 0.8 ? 0 : pick([-500, -200, 100, 300]);
    closings.push({
      businessId,
      businessDate: new Date(day), // local midnight, exactly as the closing endpoints key a day
      status: "closed",
      openingCash: 12000,
      expectedCash: expected,
      countedCash: expected + diff,
      difference: diff,
      closedById: owner.id,
      closedAt: atTime(day, 22, 40),
    });
  }
  await prisma.dailyClosing.createMany({ data: closings });

  await prisma.activityLog.createMany({
    data: [
      { action: "AUTH_LOGIN", category: "Auth", details: "Imran Noor signed in", minutesAgo: 240 },
      { action: "PRODUCT_CREATE", category: "Products", details: "Added Ronin R-750 Power Bank", minutesAgo: 190 },
      { action: "STOCK_IN", category: "Stock", details: "Received 20 × Type-C Cable 2m Braided", minutesAgo: 150 },
      { action: "PAYMENT_RECEIVED", category: "Finance", details: "Bilal Ahmed paid Rs 5,000 via JazzCash", minutesAgo: 75 },
      { action: "SALE_CREATE", category: "Sales", details: "Sale completed at counter 1", minutesAgo: 20 },
    ].map(({ minutesAgo, ...log }) => ({
      ...log,
      businessId,
      userId: owner.id,
      userName: owner.fullName,
      userEmail: owner.email,
      userRole: "admin",
      timestamp: new Date(now.getTime() - minutesAgo * 60000),
    })),
  });

  const revenue = sales.reduce((sum, s) => sum + s.sale.totalAmount, 0);
  console.log(`Done. ${sales.length} sales (Rs ${Math.round(revenue).toLocaleString("en-IN")}), ${products.length} products, ${customers.length} customers, ${recovered} khata payments, ${expenses.length} expenses, ${closings.length} closings.`);
  console.log(`Sign in: ${USERS[0].email} / ${PASSWORD}  (staff: ${USERS[1].email}, accountant: ${USERS[3].email}, same password)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
