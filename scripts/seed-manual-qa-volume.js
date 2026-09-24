/**
 * Seed the live Almadel app database (`almadel`) with demo volume data
 * so colleagues can manually test products / stock / staff in the app.
 *
 * Targets ONLY the database named `almadel` from `.env`.
 * Does NOT use `.env.stress` or the stress safety guards.
 *
 * Login for the demo tenant (printed again at the end):
 *   email:    qa.demo@almadel.app
 *   password: DemoQA@2026!
 */
require("dotenv").config();

const bcrypt = require("bcryptjs");
const { prisma, resetPrismaClient } = require("../db");

const OWNER_EMAIL = "qa.demo@almadel.app";
const OWNER_PASSWORD = "DemoQA@2026!";
const OWNER_NAME = "Almadel QA Demo";
const BUSINESS_NAME = "Almadel QA Demo Shop";
const BARCODE_PREFIX = "DEMO-QA-P-";
const STAFF_EMAIL_PREFIX = "qa.staff_";
const CATEGORY_PREFIX = "Demo category ";

const TARGET = Number(process.env.QA_VOLUME_TARGET || 10000);
const BATCH = 500;
const CATEGORY_COUNT = Number(process.env.QA_CATEGORY_COUNT || TARGET);

const CATEGORIES = Array.from(
  { length: CATEGORY_COUNT },
  (_, i) => `${CATEGORY_PREFIX}${String(i + 1).padStart(5, "0")}`,
);

function assertAppDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing from .env");
  const db = new URL(url).pathname.replace(/^\//, "").split("?")[0];
  if (db !== "almadel") {
    throw new Error(`Refusing to seed: expected database "almadel", got "${db}". Check .env.`);
  }
  if (process.env.STRESS_MODE === "true" || process.env.DOTENV_CONFIG_PATH?.includes("stress")) {
    throw new Error("Refusing to seed: stress env detected. Use plain `node scripts/seed-manual-qa-volume.js` with app .env.");
  }
  return db;
}

async function createInBatches(label, rows, insert) {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const slice = rows.slice(offset, offset + BATCH);
    const result = await insert(slice);
    inserted += result.count ?? slice.length;
    console.log(`${label}: ${Math.min(offset + slice.length, rows.length)}/${rows.length}`);
  }
  return inserted;
}

async function ensureOwner(hash) {
  return prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {
      fullName: OWNER_NAME,
      passwordHash: hash,
      role: "admin",
    },
    create: {
      email: OWNER_EMAIL,
      fullName: OWNER_NAME,
      passwordHash: hash,
      role: "admin",
    },
  });
}

async function ensureBusiness(owner) {
  let business = await prisma.business.findFirst({
    where: { name: BUSINESS_NAME, ownerId: owner.id },
  });
  const trialEndsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  if (!business) {
    business = await prisma.business.create({
      data: {
        name: BUSINESS_NAME,
        businessType: "Mobile Shop",
        mobileNumber: "03001234567",
        whatsappNumber: "03001234567",
        email: OWNER_EMAIL,
        address: "QA Demo Street",
        city: "Karachi",
        area: "Clifton",
        province: "Sindh",
        manageStock: true,
        workspaceMode: "pos",
        subscriptionStatus: "active",
        trialEndsAt,
        ownerId: owner.id,
      },
    });
  } else {
    business = await prisma.business.update({
      where: { id: business.id },
      data: {
        subscriptionStatus: "active",
        trialEndsAt,
        manageStock: true,
      },
    });
  }

  await prisma.businessMember.upsert({
    where: { businessId_userId: { businessId: business.id, userId: owner.id } },
    update: { role: "owner" },
    create: { businessId: business.id, userId: owner.id, role: "owner" },
  });

  return business;
}

async function seedProducts(business, owner) {
  const existing = await prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: BARCODE_PREFIX } },
  });
  const needed = Math.max(0, TARGET - existing);
  console.log(`Products: target ${TARGET}, existing ${existing}, inserting ${needed}`);

  const rows = Array.from({ length: needed }, (_, index) => {
    const sequence = existing + index + 1;
    const id = String(sequence).padStart(6, "0");
    const cost = 500 + (sequence % 50) * 10;
    const sell = cost + 200 + (sequence % 20) * 5;
    return {
      businessId: business.id,
      createdByUserId: owner.id,
      barcode: `${BARCODE_PREFIX}${id}`,
      sku: `DEMO-QA-SKU-${id}`,
      name: `Demo product ${id}`,
      category: CATEGORIES[sequence % CATEGORIES.length],
      costPrice: cost,
      price: sell,
      sellingPrice: sell,
      stock: 50 + (sequence % 200),
      lowStockThreshold: 5,
    };
  });

  await createInBatches("products", rows, (slice) =>
    prisma.product.createMany({ data: slice, skipDuplicates: true }),
  );

  const total = await prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: BARCODE_PREFIX } },
  });
  const withStock = await prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: BARCODE_PREFIX }, stock: { gt: 0 } },
  });
  const categoryGroups = await prisma.product.groupBy({
    by: ["category"],
    where: { businessId: business.id, barcode: { startsWith: BARCODE_PREFIX } },
  });

  const stockAgg = await prisma.product.aggregate({
    where: { businessId: business.id, barcode: { startsWith: BARCODE_PREFIX } },
    _sum: { stock: true },
  });
  const valueAgg = await prisma.$queryRaw`
    SELECT COALESCE(SUM(stock * "costPrice"), 0)::float AS value
    FROM products
    WHERE "businessId" = ${business.id} AND barcode LIKE ${BARCODE_PREFIX + "%"}
  `;
  await prisma.business.update({
    where: { id: business.id },
    data: { currentStockValue: Number(valueAgg[0]?.value || 0) },
  });

  return {
    products: total,
    withStock,
    categories: categoryGroups.length,
    totalUnits: stockAgg._sum.stock || 0,
    currentStockValue: Number(valueAgg[0]?.value || 0),
  };
}

async function seedStaff(business, hash) {
  const existing = await prisma.user.count({
    where: { email: { startsWith: STAFF_EMAIL_PREFIX } },
  });
  const needed = Math.max(0, TARGET - existing);
  console.log(`Staff: target ${TARGET}, existing ${existing}, inserting ${needed}`);

  const users = Array.from({ length: needed }, (_, index) => {
    const sequence = existing + index + 1;
    const id = String(sequence).padStart(6, "0");
    const role = sequence % 5 === 0 ? "accountant" : "staff";
    return {
      email: `${STAFF_EMAIL_PREFIX}${id}@almadel.app`,
      fullName: `QA ${role} ${id}`,
      passwordHash: hash,
      role,
    };
  });

  await createInBatches("staff-users", users, (slice) =>
    prisma.user.createMany({ data: slice, skipDuplicates: true }),
  );

  const staffRows = await prisma.user.findMany({
    where: { email: { startsWith: STAFF_EMAIL_PREFIX } },
    select: { id: true, email: true, role: true },
    orderBy: { email: "asc" },
  });

  const memberships = staffRows.map((user) => ({
    businessId: business.id,
    userId: user.id,
    role: user.role === "accountant" ? "accountant" : "staff",
  }));

  const existingMembers = await prisma.businessMember.count({
    where: { businessId: business.id, role: { in: ["staff", "accountant"] } },
  });
  if (existingMembers < TARGET) {
    await createInBatches("staff-members", memberships, (slice) =>
      prisma.businessMember.createMany({ data: slice, skipDuplicates: true }),
    );
  }

  const members = await prisma.businessMember.count({
    where: { businessId: business.id, role: { in: ["staff", "accountant"] } },
  });
  return { staffUsers: staffRows.length, staffMembers: members };
}

async function main() {
  const database = assertAppDatabase();
  console.log(`Seeding manual QA volume into database: ${database}`);
  console.log(`Target volume: ${TARGET} products (+stock), ${CATEGORY_COUNT} categories, ${TARGET} staff`);

  const hash = await bcrypt.hash(OWNER_PASSWORD, Number(process.env.PASSWORD_HASH_ROUNDS ?? 10));
  const owner = await ensureOwner(hash);
  const business = await ensureBusiness(owner);
  console.log(`Business ready: id=${business.id} name="${business.name}"`);

  const productStats = await seedProducts(business, owner);
  const staffStats = await seedStaff(business, hash);

  const summary = {
    database,
    businessId: business.id,
    businessName: business.name,
    login: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    products: productStats.products,
    productsWithStock: productStats.withStock,
    categories: productStats.categories,
    totalStockUnits: productStats.totalUnits,
    currentStockValue: productStats.currentStockValue,
    staffMembers: staffStats.staffMembers,
  };

  console.log("\n=== MANUAL QA SEED COMPLETE ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nColleague login:");
  console.log(`  Email:    ${OWNER_EMAIL}`);
  console.log(`  Password: ${OWNER_PASSWORD}`);
  console.log(`  Business: ${BUSINESS_NAME}`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    await resetPrismaClient().catch(() => {});
  });
