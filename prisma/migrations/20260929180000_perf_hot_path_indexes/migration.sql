-- Hot-path indexes for paginated lists and report/dashboard aggregates.
-- Idempotent: CREATE INDEX IF NOT EXISTS

CREATE INDEX IF NOT EXISTS "products_businessId_createdAt_idx"
  ON "products" ("businessId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "customers_businessId_name_idx"
  ON "customers" ("businessId", "name");

CREATE INDEX IF NOT EXISTS "sales_businessId_createdAt_idx"
  ON "sales" ("businessId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "stock_logs_businessId_createdAt_idx"
  ON "stock_logs" ("businessId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "activity_logs_businessId_timestamp_idx"
  ON "activity_logs" ("businessId", "timestamp" DESC);
