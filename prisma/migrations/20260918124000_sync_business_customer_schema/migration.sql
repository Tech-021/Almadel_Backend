-- Add fields present in the Prisma schema but absent from the deployed tables.
ALTER TABLE "businesses"
ADD COLUMN "bankAccounts" JSONB DEFAULT '[]',
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN "currentStockValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "customerReceivable" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "hasCustomerUdhaar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hasSupplierUdhaar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "logoUrl" TEXT,
ADD COLUMN "manageStock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "ntn" TEXT,
ADD COLUMN "openingBankBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripePriceId" TEXT,
ADD COLUMN "stripeSubscriptionId" TEXT,
ADD COLUMN "strn" TEXT,
ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'trialing',
ADD COLUMN "supplierPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "taxBusinessName" TEXT,
ADD COLUMN "taxRegistered" TEXT DEFAULT 'no',
ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ADD COLUMN "workspaceMode" TEXT NOT NULL DEFAULT 'pos';

ALTER TABLE "customers"
ADD COLUMN "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
