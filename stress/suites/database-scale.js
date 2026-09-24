const {
  createInBatches,
  ensureSeedOwner,
  ensureWorstCaseBusiness,
  passwordHash,
  prisma,
} = require("../seed/common");

function timing(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    averageMs: sorted.length ? Math.round(sum / sorted.length) : 0,
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] || 0),
    p95Ms: Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] || 0),
    maxMs: Math.round(sorted[sorted.length - 1] || 0),
  };
}

async function timed(label, fn, repeats = 5) {
  const samples = [];
  let rows = null;
  for (let i = 0; i < repeats; i += 1) {
    const started = performance.now();
    rows = await fn();
    samples.push(performance.now() - started);
  }
  const stats = timing(samples);
  const rowCount = Array.isArray(rows)
    ? rows.length
    : typeof rows === "number"
      ? rows
      : rows?.count ?? null;
  return {
    test: label,
    ...stats,
    rows: rowCount,
    grade: stats.p95Ms > 3000 ? "FAIL" : stats.p95Ms > 1000 ? "WARNING" : "PASS",
  };
}

async function growBusinesses(owner, target) {
  const existing = await prisma.business.count({
    where: { ownerId: owner.id, name: { startsWith: "stress_biz_" } },
  });
  const needed = Math.max(0, target - existing);
  if (needed === 0) return existing;
  const rows = Array.from({ length: needed }, (_, index) => {
    const sequence = existing + index + 1;
    const id = String(sequence).padStart(6, "0");
    return {
      name: `stress_biz_${id}`,
      mobileNumber: `03${String(800000000 + sequence).slice(0, 9)}`,
      ownerId: owner.id,
    };
  });
  await createInBatches(`businesses->${target}`, rows, (slice) =>
    prisma.business.createMany({ data: slice, skipDuplicates: true }),
  );
  const businesses = await prisma.business.findMany({
    where: { ownerId: owner.id, name: { startsWith: "stress_biz_" } },
    select: { id: true },
  });
  await createInBatches(`biz-members->${target}`, businesses.map((business) => ({
    businessId: business.id,
    userId: owner.id,
    role: "owner",
  })), (slice) => prisma.businessMember.createMany({ data: slice, skipDuplicates: true }));
  return businesses.length;
}

async function growTeam(business, hash, target) {
  const existing = await prisma.user.count({
    where: {
      OR: [
        { email: { startsWith: "stress_staff_" } },
        { email: { startsWith: "stress_accountant_" } },
      ],
    },
  });
  const needed = Math.max(0, target - existing);
  if (needed > 0) {
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
    await createInBatches(`users->${target}`, rows, (slice) =>
      prisma.user.createMany({ data: slice, skipDuplicates: true }),
    );
  }
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: "stress_staff_" } },
        { email: { startsWith: "stress_accountant_" } },
      ],
    },
    select: { id: true, role: true },
    take: target,
    orderBy: { id: "asc" },
  });
  await createInBatches(`team-members->${target}`, users.map((user) => ({
    businessId: business.id,
    userId: user.id,
    role: user.role,
  })), (slice) => prisma.businessMember.createMany({ data: slice, skipDuplicates: true }));
  return users.length;
}

async function growProducts(business, owner, target) {
  const existing = await prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
  });
  const needed = Math.max(0, target - existing);
  if (needed > 0) {
    const rows = Array.from({ length: needed }, (_, index) => {
      const sequence = existing + index + 1;
      const id = String(sequence).padStart(6, "0");
      return {
        businessId: business.id,
        createdByUserId: owner.id,
        barcode: `STRESS-P-${id}`,
        sku: `STRESS-SKU-${id}`,
        name: `Stress product ${id}`,
        category: `Stress category ${sequence % 20}`,
        costPrice: 10,
        price: 15,
        sellingPrice: 15,
        stock: 1000,
        lowStockThreshold: 5,
      };
    });
    await createInBatches(`products->${target}`, rows, (slice) =>
      prisma.product.createMany({ data: slice, skipDuplicates: true }),
    );
  }
  return prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
  });
}

async function ensureStockLogs(business, owner, target) {
  const products = await prisma.product.findMany({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
    select: { id: true, barcode: true },
    take: target,
    orderBy: { id: "asc" },
  });
  const existing = new Set(
    (
      await prisma.stockLog.findMany({
        where: { businessId: business.id, note: "stress scale opening" },
        select: { productId: true },
      })
    ).map((row) => row.productId),
  );
  const logs = products
    .filter((product) => !existing.has(product.id))
    .map((product) => ({
      businessId: business.id,
      productId: product.id,
      barcode: product.barcode,
      quantity: 1000,
      previousStock: 0,
      newStock: 1000,
      note: "stress scale opening",
      userId: owner.id,
    }));
  if (logs.length) {
    await createInBatches(`stock-logs->${target}`, logs, (slice) =>
      prisma.stockLog.createMany({ data: slice }),
    );
  }
  return products.length;
}

async function measureCheckpoint(business, owner, size) {
  const queries = [
    await timed("count products", () => prisma.product.count({ where: { businessId: business.id } })),
    await timed("list all products", () =>
      prisma.product.findMany({
        where: { businessId: business.id },
        orderBy: { name: "asc" },
        select: { id: true, barcode: true, name: true, stock: true },
      }),
    ),
    await timed("search products", () =>
      prisma.product.findMany({
        where: { businessId: business.id, name: { contains: "Stress", mode: "insensitive" } },
        take: 50,
        orderBy: { name: "asc" },
      }),
    ),
    await timed("barcode lookup", async () => {
      const row = await prisma.product.findFirst({
        where: { businessId: business.id, barcode: "STRESS-P-000001" },
      });
      return row ? [row] : [];
    }),
    await timed("list team members", () =>
      prisma.businessMember.findMany({
        where: { businessId: business.id, role: { in: ["staff", "accountant"] } },
        include: { user: { select: { id: true, email: true, fullName: true, role: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ),
    await timed("owner business list", () =>
      prisma.businessMember.findMany({
        where: { userId: owner.id },
        include: { business: true },
        orderBy: { createdAt: "desc" },
      }),
    ),
    await timed("stock aggregate", async () => {
      const result = await prisma.product.aggregate({
        where: { businessId: business.id },
        _sum: { stock: true },
        _count: { id: true },
      });
      return result._count.id;
    }),
  ];

  const contention = Math.min(50, Math.max(5, Math.floor(size / 20)));
  const product = await prisma.product.create({
    data: {
      businessId: business.id,
      barcode: `STRESS-SCALE-ISO-${size}-${Date.now()}`,
      name: `Scale isolation ${size}`,
      price: 10,
      sellingPrice: 10,
      stock: 1000,
      createdByUserId: owner.id,
    },
  });
  const started = performance.now();
  const outcomes = await Promise.all(
    Array.from({ length: contention }, () =>
      prisma.product.updateMany({
        where: { id: product.id, stock: { gte: 1 } },
        data: { stock: { decrement: 1 } },
      }),
    ),
  );
  const elapsedMs = Math.round(performance.now() - started);
  const successful = outcomes.filter((row) => row.count === 1).length;
  const after = await prisma.product.findUnique({ where: { id: product.id } });
  const expected = 1000 - successful;
  const isolationPass = after.stock === expected;
  await prisma.product.delete({ where: { id: product.id } });

  return {
    size,
    counts: {
      businesses: await prisma.business.count({ where: { name: { startsWith: "stress_biz_" } } }),
      teamMembers: await prisma.businessMember.count({
        where: { businessId: business.id, role: { in: ["staff", "accountant"] } },
      }),
      products: await prisma.product.count({
        where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
      }),
      stockLogs: await prisma.stockLog.count({ where: { businessId: business.id } }),
    },
    queries,
    isolation: {
      concurrency: contention,
      successful,
      expected,
      actual: after.stock,
      elapsedMs,
      result: isolationPass ? "PASS" : "DATA INTEGRITY FAILURE",
    },
    grade: queries.some((q) => q.grade === "FAIL") || !isolationPass
      ? "FAIL"
      : queries.some((q) => q.grade === "WARNING")
        ? "WARNING"
        : "PASS",
  };
}

async function runDatabaseScaleSuite(config, { fresh = false } = {}) {
  if (fresh) {
    console.log("Fresh mode: cleaning stress-tagged data before scaling...");
    const { spawnSync } = require("child_process");
    const result = spawnSync("node", ["stress/seed/cleanup-stress.js"], {
      cwd: require("../lib/config").ROOT,
      env: process.env,
      encoding: "utf8",
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status) {
      throw new Error("Cleanup failed before DB scale run.");
    }
  }

  const hash = await passwordHash();
  const owner = await ensureSeedOwner(hash);
  const business = await ensureWorstCaseBusiness(owner);
  const checkpoints = config.profile.dbScaleCheckpoints || [100, 1000, 5000, 10000];
  const results = [];

  for (const size of checkpoints) {
    console.log(`\n=== DB scale checkpoint ${size} ===`);
    await growBusinesses(owner, size);
    await growTeam(business, hash, size);
    await growProducts(business, owner, size);
    await ensureStockLogs(business, owner, size);
    const checkpoint = await measureCheckpoint(business, owner, size);
    results.push(checkpoint);
    console.log(
      `checkpoint ${size}: products=${checkpoint.counts.products} team=${checkpoint.counts.teamMembers} grade=${checkpoint.grade}`,
    );
  }

  return {
    scenario: "DATABASE SCALABILITY CHECKPOINTS",
    kind: "database-scale",
    businessId: business.id,
    checkpoints: results,
    summary: {
      checkpoints: results.length,
      pass: results.filter((row) => row.grade === "PASS").length,
      warning: results.filter((row) => row.grade === "WARNING").length,
      fail: results.filter((row) => row.grade === "FAIL").length,
    },
  };
}

module.exports = { runDatabaseScaleSuite };
