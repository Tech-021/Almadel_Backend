-- ACID integrity hardening:
-- Float -> Decimal(14,2), paymentId unique, SaleItem Restrict, businessId NOT NULL,
-- stock >= 0 CHECK, and hot-path indexes.

-- 1) Ensure no negative stock before CHECK
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE stock < 0) THEN
    RAISE EXCEPTION 'Cannot add products_stock_non_negative: negative stock rows exist';
  END IF;
END $$;

-- 2) Ensure no null tenant ownership before NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE "businessId" IS NULL)
     OR EXISTS (SELECT 1 FROM sales WHERE "businessId" IS NULL)
     OR EXISTS (SELECT 1 FROM customers WHERE "businessId" IS NULL)
     OR EXISTS (SELECT 1 FROM suppliers WHERE "businessId" IS NULL)
     OR EXISTS (SELECT 1 FROM stock_logs WHERE "businessId" IS NULL)
     OR EXISTS (SELECT 1 FROM activity_logs WHERE "businessId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot set businessId NOT NULL: null tenant rows exist';
  END IF;
END $$;

-- 3) Ensure no duplicate paymentId ledger rows before unique
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ledger_transactions
    WHERE "paymentId" IS NOT NULL
    GROUP BY "paymentId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot unique ledger_transactions.paymentId: duplicates exist';
  END IF;
END $$;

-- Business money fields
ALTER TABLE "businesses"
  ALTER COLUMN "openingCashBalance" TYPE DECIMAL(14,2) USING ROUND("openingCashBalance"::numeric, 2),
  ALTER COLUMN "openingBankBalance" TYPE DECIMAL(14,2) USING ROUND("openingBankBalance"::numeric, 2),
  ALTER COLUMN "customerReceivable" TYPE DECIMAL(14,2) USING ROUND("customerReceivable"::numeric, 2),
  ALTER COLUMN "supplierPayable" TYPE DECIMAL(14,2) USING ROUND("supplierPayable"::numeric, 2),
  ALTER COLUMN "currentStockValue" TYPE DECIMAL(14,2) USING ROUND("currentStockValue"::numeric, 2);

-- Products
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "products"
  ALTER COLUMN "businessId" SET NOT NULL,
  ALTER COLUMN "costPrice" TYPE DECIMAL(14,2) USING ROUND("costPrice"::numeric, 2),
  ALTER COLUMN "price" TYPE DECIMAL(14,2) USING ROUND("price"::numeric, 2),
  ALTER COLUMN "sellingPrice" TYPE DECIMAL(14,2) USING ROUND("sellingPrice"::numeric, 2),
  ALTER COLUMN "discountValue" TYPE DECIMAL(14,2) USING ROUND("discountValue"::numeric, 2);

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_stock_non_negative";
ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0);

-- Sale items: money + Restrict product FK + indexes
ALTER TABLE "sale_items"
  ADD COLUMN IF NOT EXISTS "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "sale_items"
  ALTER COLUMN "price" TYPE DECIMAL(14,2) USING ROUND("price"::numeric, 2),
  ALTER COLUMN "discountValue" TYPE DECIMAL(14,2) USING ROUND(COALESCE("discountValue", 0)::numeric, 2),
  ALTER COLUMN "discountAmount" TYPE DECIMAL(14,2) USING ROUND(COALESCE("discountAmount", 0)::numeric, 2),
  ALTER COLUMN "total" TYPE DECIMAL(14,2) USING ROUND("total"::numeric, 2);

ALTER TABLE "sale_items" DROP CONSTRAINT IF EXISTS "sale_items_productId_fkey";
ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "sale_items_saleId_idx" ON "sale_items"("saleId");
CREATE INDEX IF NOT EXISTS "sale_items_productId_idx" ON "sale_items"("productId");

-- Stock logs
ALTER TABLE "stock_logs"
  ALTER COLUMN "businessId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "stock_logs_productId_idx" ON "stock_logs"("productId");

-- Customers / suppliers
ALTER TABLE "customers"
  ALTER COLUMN "businessId" SET NOT NULL,
  ALTER COLUMN "totalSpent" TYPE DECIMAL(14,2) USING ROUND(COALESCE("totalSpent", 0)::numeric, 2),
  ALTER COLUMN "openingBalance" TYPE DECIMAL(14,2) USING ROUND(COALESCE("openingBalance", 0)::numeric, 2),
  ALTER COLUMN "currentBalance" TYPE DECIMAL(14,2) USING ROUND(COALESCE("currentBalance", 0)::numeric, 2);

ALTER TABLE "suppliers"
  ALTER COLUMN "businessId" SET NOT NULL,
  ALTER COLUMN "openingBalance" TYPE DECIMAL(14,2) USING ROUND(COALESCE("openingBalance", 0)::numeric, 2),
  ALTER COLUMN "currentBalance" TYPE DECIMAL(14,2) USING ROUND(COALESCE("currentBalance", 0)::numeric, 2);

-- Sales
ALTER TABLE "sales"
  ALTER COLUMN "businessId" SET NOT NULL,
  ALTER COLUMN "subtotal" TYPE DECIMAL(14,2) USING ROUND("subtotal"::numeric, 2),
  ALTER COLUMN "discountValue" TYPE DECIMAL(14,2) USING ROUND(COALESCE("discountValue", 0)::numeric, 2),
  ALTER COLUMN "discountAmount" TYPE DECIMAL(14,2) USING ROUND(COALESCE("discountAmount", 0)::numeric, 2),
  ALTER COLUMN "totalAmount" TYPE DECIMAL(14,2) USING ROUND("totalAmount"::numeric, 2);

-- Activity logs
ALTER TABLE "activity_logs"
  ALTER COLUMN "businessId" SET NOT NULL;

-- Accounts / ledger / expenses / payments / daily closings
ALTER TABLE "accounts"
  ALTER COLUMN "openingBalance" TYPE DECIMAL(14,2) USING ROUND(COALESCE("openingBalance", 0)::numeric, 2);

ALTER TABLE "ledger_transactions"
  ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING ROUND("amount"::numeric, 2);

CREATE UNIQUE INDEX IF NOT EXISTS "ledger_transactions_paymentId_key"
  ON "ledger_transactions"("paymentId");

ALTER TABLE "expenses"
  ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "payments"
  ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING ROUND("amount"::numeric, 2);

CREATE INDEX IF NOT EXISTS "payments_customerId_idx" ON "payments"("customerId");
CREATE INDEX IF NOT EXISTS "payments_supplierId_idx" ON "payments"("supplierId");
CREATE INDEX IF NOT EXISTS "payments_saleId_idx" ON "payments"("saleId");

ALTER TABLE "daily_closings"
  ALTER COLUMN "openingCash" TYPE DECIMAL(14,2) USING ROUND(COALESCE("openingCash", 0)::numeric, 2),
  ALTER COLUMN "expectedCash" TYPE DECIMAL(14,2) USING ROUND(COALESCE("expectedCash", 0)::numeric, 2),
  ALTER COLUMN "countedCash" TYPE DECIMAL(14,2) USING ROUND("countedCash"::numeric, 2),
  ALTER COLUMN "difference" TYPE DECIMAL(14,2) USING ROUND("difference"::numeric, 2);
