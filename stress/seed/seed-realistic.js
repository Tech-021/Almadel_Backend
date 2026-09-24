const { loadStressEnv, assertStressEnvironment } = require("../lib/safety");

loadStressEnv();
assertStressEnvironment();

const { createInBatches, passwordHash, prisma } = require("./common");

async function main() {
  const businessesTarget = Number(process.env.STRESS_REALISTIC_BUSINESSES || 10);
  const staffPer = Number(process.env.STRESS_REALISTIC_STAFF || 3);
  const accountantsPer = Number(process.env.STRESS_REALISTIC_ACCOUNTANTS || 1);
  const productsPer = Number(process.env.STRESS_REALISTIC_PRODUCTS || 10);
  if (businessesTarget > 100 && process.env.STRESS_ALLOW_HEAVY !== "true") {
    throw new Error(
      "Refusing a realistic seed above 100 businesses without STRESS_ALLOW_HEAVY=true. The default is a small sample.",
    );
  }

  const hash = await passwordHash();
  const businesses = businessesTarget;
  console.log("REALISTIC MULTITENANT SEED");
  console.log(
    `${businesses} businesses, ${staffPer} staff each, ${accountantsPer} accountant each, ${productsPer} products each.`,
  );

  const owners = [];
  for (let index = 1; index <= businesses; index += 1) {
    const id = String(index).padStart(6, "0");
    owners.push({
      email: `stress_realistic_owner_${id}@example.test`,
      fullName: `Stress realistic owner ${id}`,
      passwordHash: hash,
      role: "admin",
    });
  }
  await createInBatches("owners", owners, (slice) => prisma.user.createMany({ data: slice, skipDuplicates: true }));
  const ownerRows = await prisma.user.findMany({
    where: { email: { startsWith: "stress_realistic_owner_" } },
    select: { id: true, email: true },
  });
  const existingNames = new Set(
    (
      await prisma.business.findMany({
        where: { name: { startsWith: "stress_realistic_biz_" } },
        select: { name: true },
      })
    ).map((row) => row.name),
  );

  const businessRows = ownerRows.map((owner) => {
    const id = owner.email.match(/_(\d+)@/)[1];
    return {
      name: `stress_realistic_biz_${id}`,
      mobileNumber: `03${String(700000000 + Number(id)).padStart(9, "0").slice(-9)}`,
      ownerId: owner.id,
    };
  }).filter((row) => !existingNames.has(row.name));
  await createInBatches("businesses", businessRows, (slice) =>
    prisma.business.createMany({ data: slice, skipDuplicates: true }),
  );
  const createdBusinesses = await prisma.business.findMany({
    where: { name: { startsWith: "stress_realistic_biz_" } },
    select: { id: true, name: true, ownerId: true },
  });

  const ownerMembers = createdBusinesses.map((business) => ({
    businessId: business.id,
    userId: business.ownerId,
    role: "owner",
  }));
  await createInBatches("owner-members", ownerMembers, (slice) =>
    prisma.businessMember.createMany({ data: slice, skipDuplicates: true }),
  );

  const people = [];
  for (const business of createdBusinesses) {
    const id = business.name.slice("stress_realistic_biz_".length);
    for (let index = 1; index <= staffPer; index += 1) {
      people.push({
        email: `stress_realistic_staff_${id}_${index}@example.test`,
        fullName: `Realistic staff ${id}-${index}`,
        passwordHash: hash,
        role: "staff",
        businessId: business.id,
      });
    }
    for (let index = 1; index <= accountantsPer; index += 1) {
      people.push({
        email: `stress_realistic_accountant_${id}_${index}@example.test`,
        fullName: `Realistic accountant ${id}-${index}`,
        passwordHash: hash,
        role: "accountant",
        businessId: business.id,
      });
    }
  }
  await createInBatches("people", people, (slice) =>
    prisma.user.createMany({
      data: slice.map(({ businessId, ...user }) => user),
      skipDuplicates: true,
    }),
  );
  const peopleRows = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: "stress_realistic_staff_" } },
        { email: { startsWith: "stress_realistic_accountant_" } },
      ],
    },
    select: { id: true, email: true, role: true },
  });
  const byEmail = new Map(people.map((person) => [person.email, person.businessId]));
  const memberships = peopleRows.map((person) => ({
    businessId: byEmail.get(person.email),
    userId: person.id,
    role: person.role,
  })).filter((row) => row.businessId);
  await createInBatches("people-members", memberships, (slice) =>
    prisma.businessMember.createMany({ data: slice, skipDuplicates: true }),
  );

  const products = [];
  for (const business of createdBusinesses) {
    const id = business.name.slice("stress_realistic_biz_".length);
    for (let index = 1; index <= productsPer; index += 1) {
      const sku = String(index).padStart(3, "0");
      products.push({
        businessId: business.id,
        createdByUserId: business.ownerId,
        barcode: `STRESS-R-${id}-${sku}`,
        sku: `STRESS-R-SKU-${id}-${sku}`,
        name: `Realistic product ${id}-${sku}`,
        category: "Realistic",
        costPrice: 10,
        price: 15,
        sellingPrice: 15,
        stock: 25,
        lowStockThreshold: 5,
      });
    }
  }
  await createInBatches("products", products, (slice) =>
    prisma.product.createMany({ data: slice, skipDuplicates: true }),
  );

  console.log(JSON.stringify({
    scenario: "REALISTIC MULTITENANT",
    businesses: createdBusinesses.length,
    staffPer,
    accountantsPer,
    productsPer,
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
