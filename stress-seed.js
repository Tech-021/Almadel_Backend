require("dotenv").config();

const { prisma } = require("./db");

const ROW_COUNT = 30_000;
const BATCH_SIZE = 1_000;
const TEST_BUSINESS_NAME = "Synthetic DB Stress Test";
const TEST_OWNER_EMAIL = "stress-owner@invalid.example";

function assertStressDatabase() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL must point to the stress-test database.");

  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(rawUrl).pathname.slice(1).split("/")[0]);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
  }

  if (databaseName !== "almadel_stress") {
    throw new Error(
      `Refusing to seed database '${databaseName}'. This script only permits 'almadel_stress'.`,
    );
  }
}

async function main() {
  assertStressDatabase();

  let owner = await prisma.user.findUnique({ where: { email: TEST_OWNER_EMAIL } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        email: TEST_OWNER_EMAIL,
        fullName: "Synthetic Stress Test Owner",
        // This synthetic account is for relational test data only, not login use.
        passwordHash: "not-a-login-account",
        role: "staff",
      },
    });
  }

  let business = await prisma.business.findFirst({
    where: { ownerId: owner.id, name: TEST_BUSINESS_NAME },
  });
  if (!business) {
    business = await prisma.business.create({
      data: {
        name: TEST_BUSINESS_NAME,
        mobileNumber: "0000000000",
        ownerId: owner.id,
      },
    });
  }

  let inserted = 0;
  for (let offset = 0; offset < ROW_COUNT; offset += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, ROW_COUNT - offset);
    const products = Array.from({ length: count }, (_, index) => {
      const sequence = offset + index + 1;
      return {
        businessId: business.id,
        createdByUserId: owner.id,
        barcode: `STRESS-${String(sequence).padStart(6, "0")}`,
        sku: `TEST-SKU-${String(sequence).padStart(6, "0")}`,
        name: `Synthetic product ${String(sequence).padStart(6, "0")}`,
        category: `Synthetic category ${sequence % 20}`,
        costPrice: 10 + (sequence % 500),
        price: 15 + (sequence % 700),
        sellingPrice: 15 + (sequence % 700),
        stock: sequence % 250,
        lowStockThreshold: 5,
      };
    });

    const result = await prisma.product.createMany({ data: products, skipDuplicates: true });
    inserted += result.count;
    console.log(`Processed ${Math.min(offset + count, ROW_COUNT)}/${ROW_COUNT} rows`);
  }

  const total = await prisma.product.count({ where: { businessId: business.id } });
  console.log(
    JSON.stringify(
      {
        database: "almadel_stress",
        businessId: business.id,
        targetRows: ROW_COUNT,
        insertedThisRun: inserted,
        totalSyntheticProducts: total,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
