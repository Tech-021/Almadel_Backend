const { loadStressEnv, assertStressEnvironment } = require("../lib/safety");

loadStressEnv();
assertStressEnvironment();

const {
  createInBatches,
  ensureSeedOwner,
  passwordHash,
  prisma,
} = require("./common");

async function main() {
  const hash = await passwordHash();
  const owner = await ensureSeedOwner(hash);
  const target = Number(process.env.STRESS_BUSINESSES || 10000);
  const existing = await prisma.business.count({
    where: { ownerId: owner.id, name: { startsWith: "stress_biz_" } },
  });
  const needed = Math.max(0, target - existing);
  console.log(`Business seed target ${target}. Existing ${existing}. Inserting ${needed}.`);

  const rows = Array.from({ length: needed }, (_, index) => {
    const sequence = existing + index + 1;
    const id = String(sequence).padStart(6, "0");
    return {
      name: `stress_biz_${id}`,
      mobileNumber: `03${String(800000000 + sequence).slice(0, 9)}`,
      ownerId: owner.id,
    };
  });

  await createInBatches("businesses", rows, (slice) =>
    prisma.business.createMany({ data: slice, skipDuplicates: true }),
  );

  const businesses = await prisma.business.findMany({
    where: { ownerId: owner.id, name: { startsWith: "stress_biz_" } },
    select: { id: true },
  });
  const memberships = businesses.map((business) => ({
    businessId: business.id,
    userId: owner.id,
    role: "owner",
  }));
  await createInBatches("memberships", memberships, (slice) =>
    prisma.businessMember.createMany({ data: slice, skipDuplicates: true }),
  );

  console.log(JSON.stringify({ scenario: "business-volume", businesses: businesses.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
