CREATE TABLE "accounts" (
  "id" SERIAL NOT NULL, "businessId" INTEGER NOT NULL, "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'cash', "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ledger_transactions" (
  "id" SERIAL NOT NULL, "businessId" INTEGER NOT NULL, "accountId" INTEGER NOT NULL,
  "type" TEXT NOT NULL, "direction" TEXT NOT NULL, "amount" DOUBLE PRECISION NOT NULL,
  "reference" TEXT, "note" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdById" INTEGER,
  "paymentId" INTEGER, CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "expenses" (
  "id" SERIAL NOT NULL, "businessId" INTEGER NOT NULL, "accountId" INTEGER NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL, "category" TEXT NOT NULL, "description" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "payments" (
  "id" SERIAL NOT NULL, "businessId" INTEGER NOT NULL, "accountId" INTEGER NOT NULL,
  "customerId" INTEGER, "supplierId" INTEGER, "saleId" INTEGER, "amount" DOUBLE PRECISION NOT NULL,
  "type" TEXT NOT NULL, "method" TEXT NOT NULL, "reference" TEXT, "status" TEXT NOT NULL DEFAULT 'completed',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "daily_closings" (
  "id" SERIAL NOT NULL, "businessId" INTEGER NOT NULL, "businessDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open', "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectedCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "countedCash" DOUBLE PRECISION,
  "difference" DOUBLE PRECISION, "note" TEXT, "closedById" INTEGER, "closedAt" TIMESTAMP(3),
  "reopenedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounts_businessId_name_key" ON "accounts"("businessId", "name");
CREATE INDEX "accounts_businessId_type_idx" ON "accounts"("businessId", "type");
CREATE INDEX "ledger_transactions_businessId_occurredAt_idx" ON "ledger_transactions"("businessId", "occurredAt");
CREATE INDEX "ledger_transactions_accountId_occurredAt_idx" ON "ledger_transactions"("accountId", "occurredAt");
CREATE INDEX "expenses_businessId_occurredAt_idx" ON "expenses"("businessId", "occurredAt");
CREATE INDEX "payments_businessId_occurredAt_idx" ON "payments"("businessId", "occurredAt");
CREATE UNIQUE INDEX "daily_closings_businessId_businessDate_key" ON "daily_closings"("businessId", "businessDate");
CREATE INDEX "daily_closings_businessId_status_idx" ON "daily_closings"("businessId", "status");
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
