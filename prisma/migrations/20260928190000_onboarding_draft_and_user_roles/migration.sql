-- Add onboarding user roles
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'owner';

-- Draft storage until Stripe checkout completes
CREATE TABLE "business_onboarding_drafts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "workspaceMode" TEXT NOT NULL DEFAULT 'pos',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_onboarding_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_onboarding_drafts_userId_key" ON "business_onboarding_drafts"("userId");

ALTER TABLE "business_onboarding_drafts" ADD CONSTRAINT "business_onboarding_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
