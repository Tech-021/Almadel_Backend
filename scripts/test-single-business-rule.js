const { prisma } = require("../db");

async function testSingleBusinessRule() {
  console.log("=== Testing 1 Admin = 1 Business Rule ===");

  // Find an existing owner
  const owner = await prisma.user.findFirst({
    where: { role: "admin", ownedBusinesses: { some: {} } },
    include: { ownedBusinesses: true, businessMemberships: true },
  });

  if (!owner) {
    console.log("No owner found to test.");
    return;
  }

  console.log(`Testing with owner: ${owner.email} (ID: ${owner.id})`);
  console.log(`Already owns ${owner.ownedBusinesses.length} business: "${owner.ownedBusinesses[0]?.name}"`);

  // Attempt to create a second business in database directly with same ownerId
  let dbErrorCaught = false;
  try {
    await prisma.business.create({
      data: {
        name: "Illegal Duplicate Store",
        mobileNumber: "03001234567",
        ownerId: owner.id,
      },
    });
  } catch (err) {
    dbErrorCaught = true;
    console.log("✅ Database constraint successfully blocked duplicate business creation!");
    console.log("Error details:", err.message.slice(0, 150) + "...");
  }

  if (!dbErrorCaught) {
    throw new Error("FAIL: Database did NOT block duplicate business creation!");
  }

  console.log("\n=== ALL TESTS PASSED: 1 Admin = 1 Business strictly enforced at DB level! ===");
}

testSingleBusinessRule()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
