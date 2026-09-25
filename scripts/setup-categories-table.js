const { prisma } = require("../db");

async function setupCategories() {
  console.log("Creating categories table in PostgreSQL if not exists...");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      "businessId" INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "categories_businessId_name_key" UNIQUE ("businessId", name)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "categories_businessId_idx" ON categories ("businessId");
  `);

  console.log("Categories table created successfully.");

  // Pre-populate categories from existing products so nothing is lost
  const products = await prisma.product.findMany({
    where: { category: { not: null } },
    select: { businessId: true, category: true },
  });

  console.log(`Found ${products.length} products with category.`);
  const uniqueBizCategories = new Set();
  for (const p of products) {
    if (p.category && p.category.trim() && p.businessId) {
      uniqueBizCategories.add(`${p.businessId}:::${p.category.trim()}`);
    }
  }

  let seeded = 0;
  for (const item of uniqueBizCategories) {
    const [bizIdStr, catName] = item.split(":::");
    const businessId = Number(bizIdStr);
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO categories ("businessId", name, "createdAt", "updatedAt")
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("businessId", name) DO NOTHING;
      `, businessId, catName);
      seeded++;
    } catch (e) {
      console.warn("Seeding notice:", e.message);
    }
  }

  console.log(`Pre-populated ${seeded} existing categories from products into DB!`);
}

setupCategories()
  .catch((e) => {
    console.error("Setup error:", e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
