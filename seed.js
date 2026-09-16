const { prisma } = require("./db");

async function seed() {
  console.log("Seeding database...");
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  const adminId = admin ? admin.id : null;

  // Hardcoded products removed - users should add their own products
  const products = [];

  for (const prod of products) {
    await prisma.product.upsert({
      where: { barcode: prod.barcode },
      update: prod,
      create: prod,
    });
  }

  // Hardcoded sales removed - users should have their own sales data
  const sales = [];

  for (const sale of sales) {
    const existing = await prisma.sale.findUnique({
      where: { invoiceNumber: sale.invoiceNumber },
    });
    if (!existing) {
      await prisma.sale.create({ data: sale });
    }
  }

  console.log("Seeding complete!");
}

seed()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
