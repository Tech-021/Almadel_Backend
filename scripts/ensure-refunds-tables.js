/**
 * Creates refund tables / columns when migrate deploy was not run (local dev).
 */
const db = require("../db");
const prisma = db.prisma;

async function columnExists(table, column) {
  const rows = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function tableExists(table) {
  const rows = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function ensureRefundsSchema() {
  if (!(await columnExists("sales", "refundedAmount"))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "sales" ADD COLUMN "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0`,
    );
  }
  if (!(await columnExists("sale_items", "refundedQuantity"))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "sale_items" ADD COLUMN "refundedQuantity" INTEGER NOT NULL DEFAULT 0`,
    );
  }

  if (!(await tableExists("refunds"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "refunds" (
        "id" SERIAL NOT NULL,
        "businessId" INTEGER NOT NULL,
        "saleId" INTEGER NOT NULL,
        "refundNumber" TEXT NOT NULL,
        "totalAmount" DECIMAL(14,2) NOT NULL,
        "reason" TEXT,
        "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "userId" INTEGER,
        "branchId" INTEGER,
        CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "refunds_businessId_refundNumber_key" ON "refunds"("businessId", "refundNumber")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "refunds_businessId_createdAt_idx" ON "refunds"("businessId", "createdAt" DESC)
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX "refunds_saleId_idx" ON "refunds"("saleId")`);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "refunds" ADD CONSTRAINT "refunds_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "refunds" ADD CONSTRAINT "refunds_saleId_fkey"
      FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "refunds" ADD CONSTRAINT "refunds_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "refunds" ADD CONSTRAINT "refunds_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE
    `);
  }

  if (!(await tableExists("refund_items"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "refund_items" (
        "id" SERIAL NOT NULL,
        "refundId" INTEGER NOT NULL,
        "saleItemId" INTEGER NOT NULL,
        "productId" INTEGER NOT NULL,
        "barcode" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL,
        "unitAmount" DECIMAL(14,2) NOT NULL,
        "total" DECIMAL(14,2) NOT NULL,
        CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "refund_items_refundId_idx" ON "refund_items"("refundId")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "refund_items_saleItemId_idx" ON "refund_items"("saleItemId")
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refundId_fkey"
      FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_saleItemId_fkey"
      FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    `);
  }

  console.log("Refunds schema is ready.");
}

ensureRefundsSchema()
  .catch((error) => {
    console.error("Failed:", error.message);
    process.exit(1);
  })
  .finally(async () => {
    await db.resetPrismaClient?.();
    process.exit(0);
  });
