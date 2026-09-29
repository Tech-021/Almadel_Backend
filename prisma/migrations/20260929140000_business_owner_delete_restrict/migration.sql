-- Prevent deleting a User who still owns a Business (avoids accidental tenant wipe).
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_ownerId_fkey";
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
