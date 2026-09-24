const { prisma } = require("../../db");
const { PASSWORD, SEED_OWNER_EMAIL, WORST_CASE_BUSINESS } = require("../lib/constants");

const BATCH = 500;

async function passwordHash() {
  const bcrypt = require("bcryptjs");
  return bcrypt.hash(PASSWORD, Number(process.env.PASSWORD_HASH_ROUNDS ?? 10));
}

async function ensureSeedOwner(hash) {
  const owner = await prisma.user.upsert({
    where: { email: SEED_OWNER_EMAIL },
    update: {},
    create: {
      email: SEED_OWNER_EMAIL,
      fullName: "Stress Seed Owner",
      passwordHash: hash,
      role: "admin",
    },
  });
  return owner;
}

async function ensureWorstCaseBusiness(owner) {
  let business = await prisma.business.findFirst({
    where: { name: WORST_CASE_BUSINESS, ownerId: owner.id },
  });
  if (!business) {
    business = await prisma.business.create({
      data: {
        name: WORST_CASE_BUSINESS,
        mobileNumber: "03009990001",
        ownerId: owner.id,
      },
    });
  }
  await prisma.businessMember.upsert({
    where: { businessId_userId: { businessId: business.id, userId: owner.id } },
    update: { role: "owner" },
    create: { businessId: business.id, userId: owner.id, role: "owner" },
  });
  return business;
}

async function createInBatches(label, rows, insert) {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const slice = rows.slice(offset, offset + BATCH);
    const result = await insert(slice);
    inserted += result.count ?? slice.length;
    console.log(`${label}: ${Math.min(offset + slice.length, rows.length)}/${rows.length}`);
  }
  return inserted;
}

module.exports = {
  BATCH,
  createInBatches,
  ensureSeedOwner,
  ensureWorstCaseBusiness,
  passwordHash,
  prisma,
};
