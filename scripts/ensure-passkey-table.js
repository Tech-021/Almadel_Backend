/**
 * Creates passkey_credentials when migrate deploy was not run (local dev).
 * Uses the same DATABASE_URL as the API (.env).
 */
const db = require("../db");
const prisma = db.prisma;

async function ensurePasskeyTable() {
  const rows = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'passkey_credentials'
    LIMIT 1
  `;
  if (rows.length > 0) {
    console.log("passkey_credentials already exists.");
    return;
  }

  console.log("Creating passkey_credentials…");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "passkey_credentials" (
      "id" SERIAL NOT NULL,
      "userId" INTEGER NOT NULL,
      "credentialId" TEXT NOT NULL,
      "publicKey" BYTEA NOT NULL,
      "counter" BIGINT NOT NULL DEFAULT 0,
      "deviceType" TEXT,
      "backedUp" BOOLEAN NOT NULL DEFAULT false,
      "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
      "aaguid" TEXT,
      "friendlyName" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastUsedAt" TIMESTAMP(3),
      CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "passkey_credentials_credentialId_key"
    ON "passkey_credentials"("credentialId");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "passkey_credentials_userId_idx"
    ON "passkey_credentials"("userId");
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "passkey_credentials"
    ADD CONSTRAINT "passkey_credentials_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  `);

  console.log("passkey_credentials created. Restart the API if it is running, then add a passkey in Settings.");
}

ensurePasskeyTable()
  .catch((error) => {
    console.error("Failed:", error.message);
    process.exit(1);
  })
  .finally(async () => {
    await db.resetPrismaClient?.();
    process.exit(0);
  });
