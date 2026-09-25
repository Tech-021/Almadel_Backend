const { summarizeSamples, gradeStage } = require("../lib/metrics");
const { SEED_OWNER_EMAIL, WORST_CASE_BUSINESS } = require("../lib/constants");
const { postgresSnapshot } = require("../lib/monitor");

function prisma() {
  return require("../../db").prisma;
}

function timing(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    averageMs: sorted.length ? Math.round(sum / sorted.length) : 0,
    medianMs: sorted[Math.floor(sorted.length / 2)] || 0,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] || 0,
    maxMs: sorted[sorted.length - 1] || 0,
  };
}

async function timedQuery(label, fn, repeats = 5) {
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

async function resolveWorstCaseBusiness() {
  const business = await prisma().business.findFirst({
    where: { name: WORST_CASE_BUSINESS },
    select: { id: true, name: true, ownerId: true },
  });
  if (!business) {
    throw new Error(
      `Missing worst-case business '${WORST_CASE_BUSINESS}'. Run npm run stress:seed:team and stress:seed:products first.`,
    );
  }
  return business;
}

async function volumeCounts(businessId) {
  const [staffMembers, accountants, products, stockLogs, businesses, users, customers, suppliers, expenses, ledger, payments, accounts] = await Promise.all([
    prisma().businessMember.count({ where: { businessId, role: "staff" } }),
    prisma().businessMember.count({ where: { businessId, role: "accountant" } }),
    prisma().product.count({ where: { businessId, barcode: { startsWith: "STRESS-P-" } } }),
    prisma().stockLog.count({ where: { businessId } }),
    prisma().business.count({ where: { name: { startsWith: "stress_" } } }),
    prisma().user.count({
      where: {
        OR: [
          { email: { startsWith: "stress_staff_" } },
          { email: { startsWith: "stress_accountant_" } },
        ],
      },
    }),
    prisma().customer.count({ where: { businessId } }),
    prisma().supplier.count({ where: { businessId } }),
    prisma().expense.count({ where: { businessId } }),
    prisma().ledgerTransaction.count({ where: { businessId } }),
    prisma().payment.count({ where: { businessId } }),
    prisma().account.count({ where: { businessId } }),
  ]);
  return {
    worstCaseBusinessId: businessId,
    staffMembers,
    accountants,
    products,
    stockLogs,
    stressBusinesses: businesses,
    stressTeamUsers: users,
    customers,
    suppliers,
    expenses,
    ledgerTransactions: ledger,
    payments,
    accounts,
  };
}

async function runQueryBenchmarks(business) {
  const ownerId = business.ownerId;
  const businessId = business.id;
  return [
    await timedQuery("count products in worst-case business", () =>
      prisma().product.count({ where: { businessId } }),
    ),
    await timedQuery("list 10k products ordered by name", () =>
      prisma().product.findMany({
        where: { businessId },
        orderBy: { name: "asc" },
        select: { id: true, barcode: true, name: true, stock: true, sku: true },
      }),
    ),
    await timedQuery("search products by name contains Stress", () =>
      prisma().product.findMany({
        where: { businessId, name: { contains: "Stress", mode: "insensitive" } },
        take: 50,
        orderBy: { name: "asc" },
      }),
    ),
    await timedQuery("barcode lookup", async () => {
      const row = await prisma().product.findFirst({
        where: { businessId, barcode: "STRESS-P-000001" },
      });
      return row ? [row] : [];
    }),
    await timedQuery("list team members with user join", () =>
      prisma().businessMember.findMany({
        where: { businessId, role: { in: ["staff", "accountant"] } },
        include: { user: { select: { id: true, email: true, fullName: true, role: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ),
    await timedQuery("owner business memberships (10k businesses)", () =>
      prisma().businessMember.findMany({
        where: { userId: ownerId },
        include: { business: true },
        orderBy: { createdAt: "desc" },
      }),
    ),
    await timedQuery("low stock products", () =>
      prisma().product.findMany({
        where: { businessId, stock: { lte: 5 } },
        orderBy: { stock: "asc" },
        take: 100,
      }),
    ),
    await timedQuery("stock log history sample", () =>
      prisma().stockLog.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
    ),
    await timedQuery("aggregate stock sum", async () => {
      const result = await prisma().product.aggregate({
        where: { businessId },
        _sum: { stock: true },
        _avg: { stock: true },
        _count: { id: true },
      });
      return result._count.id;
    }),
    await timedQuery("list customers (khata)", () =>
      prisma().customer.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, mobile: true, currentBalance: true, openingBalance: true },
      }),
    ),
    await timedQuery("list expenses ordered by date", () =>
      prisma().expense.findMany({
        where: { businessId },
        orderBy: { occurredAt: "desc" },
        take: 1000,
      }),
    ),
    await timedQuery("list ledger transactions page", () =>
      prisma().ledgerTransaction.findMany({
        where: { businessId },
        orderBy: { occurredAt: "desc" },
        take: 100,
      }),
    ),
    await timedQuery("accounts with transaction aggregates", () =>
      prisma().account.findMany({
        where: { businessId },
        include: { transactions: { select: { amount: true, direction: true } } },
      }),
    ),
    await timedQuery("finance summary aggregates", async () => {
      const [sales, expenses, receivable, payable] = await Promise.all([
        prisma().sale.aggregate({ where: { businessId }, _sum: { totalAmount: true }, _count: { id: true } }),
        prisma().expense.aggregate({ where: { businessId }, _sum: { amount: true }, _count: { id: true } }),
        prisma().customer.aggregate({ where: { businessId }, _sum: { currentBalance: true } }),
        prisma().supplier.aggregate({ where: { businessId }, _sum: { currentBalance: true } }),
      ]);
      return (sales._count.id || 0) + (expenses._count.id || 0);
    }),
  ];
}

async function runIndexAndTableStats() {
  const tables = await prisma().$queryRaw`
    SELECT
      c.relname AS table_name,
      pg_total_relation_size(c.oid)::bigint AS total_bytes,
      pg_relation_size(c.oid)::bigint AS table_bytes,
      pg_indexes_size(c.oid)::bigint AS index_bytes,
      COALESCE(s.n_live_tup, 0)::bigint AS live_rows,
      COALESCE(s.seq_scan, 0)::bigint AS seq_scans,
      COALESCE(s.idx_scan, 0)::bigint AS index_scans
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
  `;

  const indexes = await prisma().$queryRaw`
    SELECT
      schemaname,
      relname AS table_name,
      indexrelname AS index_name,
      idx_scan::bigint AS scans,
      idx_tup_read::bigint AS tuples_read,
      idx_tup_fetch::bigint AS tuples_fetched
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY idx_scan DESC
    LIMIT 30
  `;

  const serialize = (rows) =>
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]),
      ),
    );

  return {
    tables: serialize(tables),
    indexes: serialize(indexes),
  };
}

async function testAtomicity(business) {
  const product = await prisma().product.findFirst({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
    orderBy: { id: "asc" },
  });
  if (!product) throw new Error("No product available for atomicity test.");

  const before = await prisma().product.findUnique({ where: { id: product.id } });
  const beforeLogs = await prisma().stockLog.count({ where: { productId: product.id } });

  let aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: { stock: { increment: 7 } },
      });
      await tx.stockLog.create({
        data: {
          businessId: business.id,
          productId: product.id,
          barcode: product.barcode,
          quantity: 7,
          previousStock: before.stock,
          newStock: before.stock + 7,
          note: "acid atomicity should rollback",
          userId: business.ownerId,
        },
      });
      throw new Error("forced rollback");
    });
  } catch (error) {
    aborted = /forced rollback/.test(error.message);
  }

  const after = await prisma().product.findUnique({ where: { id: product.id } });
  const afterLogs = await prisma().stockLog.count({ where: { productId: product.id } });
  const pass = aborted && after.stock === before.stock && afterLogs === beforeLogs;
  return {
    principle: "Atomicity",
    test: "Increment stock + create stock log, then force rollback",
    expected: "Neither stock nor stock_log row survives",
    actual: `stock ${before.stock}->${after.stock}, logs ${beforeLogs}->${afterLogs}`,
    result: pass ? "PASS" : "FAIL",
  };
}

async function testConsistency(business) {
  const results = [];

  // Unique email constraint
  const existing = await prisma().user.findFirst({
    where: { email: { startsWith: "stress_staff_" } },
  });
  let uniqueEmailBlocked = false;
  try {
    await prisma().user.create({
      data: {
        email: existing.email,
        fullName: "duplicate",
        passwordHash: "x",
        role: "staff",
      },
    });
  } catch (error) {
    uniqueEmailBlocked = error.code === "P2002" || /unique/i.test(error.message);
  }
  results.push({
    principle: "Consistency",
    test: "Duplicate user email insert",
    expected: "Rejected by unique constraint",
    actual: uniqueEmailBlocked ? "rejected" : "accepted",
    result: uniqueEmailBlocked ? "PASS" : "FAIL",
  });

  // Unique barcode per business
  const product = await prisma().product.findFirst({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
  });
  let uniqueBarcodeBlocked = false;
  try {
    await prisma().product.create({
      data: {
        businessId: business.id,
        barcode: product.barcode,
        name: "duplicate barcode",
        price: 1,
        sellingPrice: 1,
        stock: 0,
      },
    });
  } catch (error) {
    uniqueBarcodeBlocked = error.code === "P2002" || /unique/i.test(error.message);
  }
  results.push({
    principle: "Consistency",
    test: "Duplicate product barcode in same business",
    expected: "Rejected by unique(businessId, barcode)",
    actual: uniqueBarcodeBlocked ? "rejected" : "accepted",
    result: uniqueBarcodeBlocked ? "PASS" : "FAIL",
  });

  // Conditional stock decrement must not go negative
  const target = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `STRESS-ACID-CONS-${Date.now()}`,
      name: "Consistency stock guard",
      price: 10,
      sellingPrice: 10,
      stock: 3,
      createdByUserId: business.ownerId,
    },
  });
  const first = await prisma().product.updateMany({
    where: { id: target.id, stock: { gte: 3 } },
    data: { stock: { decrement: 3 } },
  });
  const second = await prisma().product.updateMany({
    where: { id: target.id, stock: { gte: 3 } },
    data: { stock: { decrement: 3 } },
  });
  const final = await prisma().product.findUnique({ where: { id: target.id } });
  const stockGuard =
    first.count === 1 && second.count === 0 && final.stock === 0;
  results.push({
    principle: "Consistency",
    test: "Conditional stock decrement refuses oversell",
    expected: "First decrement succeeds, second affects 0 rows, stock stays 0",
    actual: `first=${first.count}, second=${second.count}, stock=${final.stock}`,
    result: stockGuard ? "PASS" : "FAIL",
  });

  await prisma().product.delete({ where: { id: target.id } });
  return results;
}

async function testIsolation(business, concurrency) {
  const product = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `STRESS-ACID-ISO-${Date.now()}`,
      name: "Isolation contention product",
      price: 10,
      sellingPrice: 10,
      stock: 1000,
      createdByUserId: business.ownerId,
    },
  });

  const started = performance.now();
  const outcomes = await Promise.all(
    Array.from({ length: concurrency }, () =>
      prisma().product.updateMany({
        where: { id: product.id, stock: { gte: 1 } },
        data: { stock: { decrement: 1 } },
      }),
    ),
  );
  const elapsedMs = performance.now() - started;
  const successful = outcomes.filter((row) => row.count === 1).length;
  const after = await prisma().product.findUnique({ where: { id: product.id } });
  const expected = 1000 - successful;
  const pass = after.stock === expected;

  await prisma().product.delete({ where: { id: product.id } });

  return {
    principle: "Isolation",
    test: `${concurrency} concurrent conditional decrements on one row`,
    expected: `stock = 1000 - successful updates (${expected})`,
    actual: `successful=${successful}, stock=${after.stock}`,
    elapsedMs: Math.round(elapsedMs),
    result: pass ? "PASS" : "DATA INTEGRITY FAILURE",
    integrity: {
      test: `${concurrency} concurrent DB decrements`,
      initial: 1000,
      successful,
      failed: concurrency - successful,
      expected,
      actual: after.stock,
      result: pass ? "PASS" : "DATA INTEGRITY FAILURE",
    },
  };
}

async function testDurability(business) {
  const marker = `STRESS-ACID-DUR-${Date.now()}`;
  const created = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: marker,
      name: "Durability marker",
      price: 10,
      sellingPrice: 10,
      stock: 42,
      createdByUserId: business.ownerId,
    },
  });

  // New client connection path: disconnect is not possible mid-suite; re-query via raw SQL.
  const rows = await prisma().$queryRaw`
    SELECT id, barcode, stock
    FROM products
    WHERE id = ${created.id}
  `;
  const found = rows[0];
  const pass = Boolean(found) && Number(found.stock) === 42 && found.barcode === marker;
  await prisma().product.delete({ where: { id: created.id } });
  return {
    principle: "Durability",
    test: "Insert product then re-read via SQL",
    expected: "Committed row is readable after write",
    actual: found
      ? `id=${found.id} stock=${found.stock} barcode=${found.barcode}`
      : "missing",
    result: pass ? "PASS" : "FAIL",
  };
}

async function runConcurrentReadLoad(business, concurrency, iterations) {
  const samples = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let i = 0; i < iterations; i += 1) {
        const t0 = performance.now();
        await prisma().product.findMany({
          where: { businessId: business.id },
          take: 100,
          orderBy: { id: "asc" },
        });
        samples.push({
          ok: true,
          status: 200,
          latencyMs: performance.now() - t0,
          bytes: 0,
        });
      }
    }),
  );
  const summary = summarizeSamples(samples, {
    test: "db-concurrent-product-page",
    concurrency,
    elapsedMs: performance.now() - started,
  });
  summary.grade = gradeStage(summary, { maxErrorRate: 0.05, maxP95Ms: 3000 });
  return summary;
}

async function runDatabaseSuite(config) {
  const business = await resolveWorstCaseBusiness();
  const volume = await volumeCounts(business.id);
  const before = await postgresSnapshot(prisma());

  console.log(
    `DB suite on business ${business.id}: staff=${volume.staffMembers} accountants=${volume.accountants} products=${volume.products}`,
  );

  const acid = [];
  acid.push(await testAtomicity(business));
  acid.push(...(await testConsistency(business)));
  const isolationLevels = config.profileName === "smoke" ? [10, 50] : [10, 50, 100, 250];
  const integrity = [];
  for (const level of isolationLevels) {
    const result = await testIsolation(business, level);
    acid.push(result);
    if (result.integrity) integrity.push(result.integrity);
  }
  acid.push(await testDurability(business));

  const queryBenchmarks = await runQueryBenchmarks(business);
  const stats = await runIndexAndTableStats();
  const concurrentReads = [];
  for (const concurrency of config.profile.readConcurrency) {
    concurrentReads.push(await runConcurrentReadLoad(business, concurrency, 5));
  }

  const after = await postgresSnapshot(prisma());
  const acidFailed = acid.filter((row) => row.result !== "PASS").length;

  return {
    scenario: "DATABASE VOLUME + ACID",
    kind: "database",
    businessId: business.id,
    volume,
    acid,
    integrity,
    queryBenchmarks,
    stats,
    concurrentReads,
    databaseBefore: before,
    databaseAfter: after,
    stages: concurrentReads,
    aborted: null,
    summary: {
      acidTotal: acid.length,
      acidPass: acid.length - acidFailed,
      acidFail: acidFailed,
      queryWarnings: queryBenchmarks.filter((row) => row.grade !== "PASS").length,
    },
  };
}

module.exports = { runDatabaseSuite };
