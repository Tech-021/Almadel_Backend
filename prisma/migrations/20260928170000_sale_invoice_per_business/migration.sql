-- Per-business offline invoice idempotency (AUD-005 / AUD-021)
DROP INDEX IF EXISTS "sales_invoiceNumber_key";

CREATE UNIQUE INDEX "sales_businessId_invoiceNumber_key" ON "sales"("businessId", "invoiceNumber");
