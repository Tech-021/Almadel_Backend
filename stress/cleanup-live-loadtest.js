/**
 * Cleanup lead-approved live load rows created by run-live-business-load.js
 *
 *   node stress/cleanup-live-loadtest.js --confirm-live-almadel --salt 123456
 *   node stress/cleanup-live-loadtest.js --confirm-live-almadel --all
 */

const fs = require("fs");
const path = require("path");

function loadLiveEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (key === "SMTP_FROM") continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  delete process.env.STRESS_TEST;
}

async function main() {
  const argv = process.argv.slice(2);
  const confirm = argv.includes("--confirm-live-almadel");
  const all = argv.includes("--all");
  let salt = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--salt") salt = argv[++i];
  }
  if (!confirm) throw new Error("Need --confirm-live-almadel");
  if (!all && !salt) throw new Error("Need --salt <runSalt> or --all");

  loadLiveEnv();
  if (String(process.env.DATABASE_URL || "").includes("almadel_stress")) {
    throw new Error("DATABASE_URL is almadel_stress; aborting.");
  }

  const { resetPrismaClient, prisma } = require("../db");
  await resetPrismaClient();
  const dbName = await prisma.$queryRaw`SELECT current_database() AS name`.then((r) => r[0]?.name);
  if (dbName !== "almadel") throw new Error(`Connected to ${dbName}, expected almadel`);

  const emailFilter = all
    ? { startsWith: "loadtest_live_" }
    : { startsWith: `loadtest_live_${salt}_` };
  const nameFilter = emailFilter;

  const users = await prisma.user.findMany({
    where: { email: emailFilter },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { name: nameFilter },
        ...(userIds.length ? [{ ownerId: { in: userIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const businessIds = businesses.map((b) => b.id);

  console.log(`Cleanup on ${dbName}: users=${userIds.length}, businesses=${businessIds.length}`);

  if (businessIds.length) {
    const saleIds = (
      await prisma.sale.findMany({ where: { businessId: { in: businessIds } }, select: { id: true } })
    ).map((s) => s.id);
    if (saleIds.length) await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.sale.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.stockLog.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.ledgerTransaction.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.payment.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.expense.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.dailyClosing.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.account.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.activityLog.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.customer.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.supplier.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.category.deleteMany({ where: { businessId: { in: businessIds } } }).catch(() => {});
    await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } }).catch(() => {});
    await prisma.businessMember.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  }

  if (userIds.length) {
    await prisma.businessOnboardingDraft.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.businessMember.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  console.log(JSON.stringify({ deletedUsers: userIds.length, deletedBusinesses: businessIds.length }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
