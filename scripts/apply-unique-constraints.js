const { prisma } = require("../db");

async function applyConstraints() {
  console.log("Applying unique constraints to database...");
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS businesses_owner_id_key ON businesses ("ownerId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS business_members_user_id_key ON business_members ("userId");
  `);
  console.log("Successfully created unique indexes for 1-admin-1-business enforcement!");
}

applyConstraints()
  .catch((err) => {
    console.error("Failed to apply constraints:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
