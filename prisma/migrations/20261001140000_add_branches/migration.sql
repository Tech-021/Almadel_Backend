CREATE TABLE IF NOT EXISTS "branches" (
  "id" SERIAL NOT NULL,
  "businessId" INTEGER NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Main Branch',
  "code" TEXT,
  "address" TEXT,
  "city" TEXT,
  "phone" TEXT,
  "isMain" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "branches_businessId_name_key"
  ON "branches"("businessId", "name");
CREATE INDEX IF NOT EXISTS "branches_businessId_idx"
  ON "branches"("businessId");

ALTER TABLE "branches"
  ADD CONSTRAINT "branches_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_logs"
  ADD COLUMN IF NOT EXISTS "branchId" INTEGER;
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "branchId" INTEGER;

ALTER TABLE "stock_logs"
  ADD CONSTRAINT "stock_logs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "stock_logs_branchId_idx" ON "stock_logs"("branchId");
CREATE INDEX IF NOT EXISTS "sales_branchId_idx" ON "sales"("branchId");
