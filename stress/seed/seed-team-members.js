const { loadStressEnv, assertStressEnvironment } = require("../lib/safety");

loadStressEnv();
assertStressEnvironment();

const {
  createInBatches,
  ensureSeedOwner,
  ensureWorstCaseBusiness,
  passwordHash,
  prisma,
} = require("./common");

async function main() {
  const hash = await passwordHash();
  const owner = await ensureSeedOwner(hash);
  const business = await ensureWorstCaseBusiness(owner);
  const target = Number(process.env.STRESS_TEAM_MEMBERS || 10000);
  const existing = await prisma.user.count({
    where: {
      OR: [
        { email: { startsWith: "stress_staff_" } },
        { email: { startsWith: "stress_accountant_" } },
      ],
    },
  });
  const needed = Math.max(0, target - existing);
  console.log(`WORST-CASE SINGLE TENANT team seed. Target ${target}. Existing ${existing}. Inserting ${needed}.`);
  console.log("One bcrypt hash is reused. No email is sent.");

  const rows = Array.from({ length: needed }, (_, index) => {
    const sequence = existing + index + 1;
    const role = sequence % 2 === 0 ? "accountant" : "staff";
    const id = String(sequence).padStart(6, "0");
    return {
      email: `stress_${role}_${id}@example.test`,
      fullName: `Stress ${role} ${id}`,
      passwordHash: hash,
      role,
    };
  });

  await createInBatches("users", rows, (slice) => prisma.user.createMany({ data: slice, skipDuplicates: true }));

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: "stress_staff_" } },
        { email: { startsWith: "stress_accountant_" } },
      ],
    },
    select: { id: true, role: true },
  });
  const memberships = users.map((user) => ({
    businessId: business.id,
    userId: user.id,
    role: user.role,
  }));
  await createInBatches("team-members", memberships, (slice) =>
    prisma.businessMember.createMany({ data: slice, skipDuplicates: true }),
  );

  const staff = users.filter((user) => user.role === "staff").length;
  const accountants = users.filter((user) => user.role === "accountant").length;
  console.log(JSON.stringify({
    scenario: "WORST-CASE SINGLE TENANT",
    businessId: business.id,
    staff,
    accountants,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
