const { requestJson } = require("../lib/http");
const { summarizeSamples } = require("../lib/metrics");
const { runPool } = require("../lib/http");
const { productBody } = require("./products");

function prisma() {
  return require("../../db").prisma;
}

async function ensureStockProducts(config, anchor, runSalt, count) {
  const existing = await prisma().product.findMany({
    where: { businessId: anchor.businessId, barcode: { startsWith: `LOADTEST-STOCK-${runSalt}-` } },
    select: { id: true, barcode: true, stock: true },
    orderBy: { id: "asc" },
  });
  const created = [];
  for (let sequence = existing.length + 1; sequence <= count; sequence += 1) {
    const body = productBody(runSalt, sequence, 100);
    body.barcode = `LOADTEST-STOCK-${runSalt}-${String(sequence).padStart(6, "0")}`;
    body.sku = `LOADTEST-STOCK-SKU-${runSalt}-${String(sequence).padStart(6, "0")}`;
    const response = await requestJson(config, {
      method: "POST",
      path: "/products",
      token: anchor.token,
      businessId: anchor.businessId,
      body,
    });
    if (!response.ok) {
      throw new Error(`Could not create stock fixture product: ${response.status} ${response.errorMessage}`);
    }
    created.push(response.json);
  }
  return prisma().product.findMany({
    where: { businessId: anchor.businessId, barcode: { startsWith: `LOADTEST-STOCK-${runSalt}-` } },
    select: { id: true, barcode: true, stock: true },
    orderBy: { id: "asc" },
    take: count,
  });
}

async function runIncrementIntegrity(config, anchor, products, updatesPerProduct) {
  const before = new Map(products.map((product) => [product.id, product.stock]));
  const items = products.flatMap((product) =>
    Array.from({ length: updatesPerProduct }, () => ({ barcode: product.barcode, id: product.id })),
  );
  const started = performance.now();
  const samples = await runPool(items, Math.min(config.profile.maxConcurrency, items.length), (item) =>
    requestJson(config, {
      method: "POST",
      path: "/stock/add",
      token: anchor.token,
      businessId: anchor.businessId,
      body: { barcode: item.barcode, quantity: 1, note: "stress increment" },
    }),
  );
  const summary = summarizeSamples(samples, {
    test: "stock-increment",
    endpoint: "POST /stock/add",
    concurrency: Math.min(config.profile.maxConcurrency, items.length),
    elapsedMs: performance.now() - started,
  });

  const after = await prisma().product.findMany({
    where: { id: { in: products.map((product) => product.id) } },
    select: { id: true, stock: true },
  });
  const mismatches = [];
  let successByProduct = new Map();
  samples.forEach((sample, index) => {
    const id = items[index].id;
    if (sample.ok) successByProduct.set(id, (successByProduct.get(id) || 0) + 1);
  });
  for (const row of after) {
    const expected = before.get(row.id) + (successByProduct.get(row.id) || 0);
    if (row.stock !== expected) {
      mismatches.push({ productId: row.id, expected, actual: row.stock, initial: before.get(row.id) });
    }
  }

  return {
    summary,
    integrity: {
      test: `${products.length} products x ${updatesPerProduct} concurrent increments`,
      operation: "POST /stock/add quantity 1",
      initial: "per-product opening stock",
      expected: "opening stock + successful increments for that product",
      actual: mismatches.length === 0 ? "matched" : "mismatch",
      checked: products.length,
      mismatches: mismatches.length,
      example: mismatches[0] || null,
      result: mismatches.length === 0 ? "PASS" : "DATA INTEGRITY FAILURE",
    },
  };
}

async function runContention(config, anchor, runSalt) {
  const rows = [];
  const stages = [];
  let sequence = 1;

  for (const concurrency of config.profile.contentionLevels) {
    const initial = 1000;
    const body = productBody(runSalt, 900000 + sequence, initial);
    body.barcode = `LOADTEST-CONTENTION-${runSalt}-${String(sequence).padStart(4, "0")}`;
    body.sku = `LOADTEST-CONTENTION-SKU-${runSalt}-${String(sequence).padStart(4, "0")}`;
    sequence += 1;
    const created = await requestJson(config, {
      method: "POST",
      path: "/products",
      token: anchor.token,
      businessId: anchor.businessId,
      body,
    });
    if (!created.ok) {
      throw new Error(`Contention fixture failed: ${created.status} ${created.errorMessage}`);
    }
    const product = created.json;
    const calls = Array.from({ length: concurrency }, () =>
      requestJson(config, {
        method: "POST",
        path: "/sales/checkout",
        token: anchor.token,
        businessId: anchor.businessId,
        body: {
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: "cash",
          discountType: "none",
        },
      }),
    );
    const started = performance.now();
    const samples = await Promise.all(calls);
    const summary = summarizeSamples(samples, {
      test: "stock-contention-decrement",
      endpoint: "POST /sales/checkout",
      concurrency,
      elapsedMs: performance.now() - started,
    });
    stages.push(summary);
    const fresh = await prisma().product.findUnique({ where: { id: product.id }, select: { stock: true } });
    const expected = initial - summary.successful;
    const pass = fresh.stock === expected;
    rows.push({
      test: `${concurrency} concurrent sale decrements`,
      operation: "POST /sales/checkout quantity 1",
      initial,
      successful: summary.successful,
      failed: summary.failed,
      expected,
      actual: fresh.stock,
      result: pass ? "PASS" : "DATA INTEGRITY FAILURE",
    });
  }

  return { stages, rows };
}

async function runStockSuite(config, anchor, runSalt) {
  const products = await ensureStockProducts(config, anchor, runSalt, config.profile.stockProducts);
  const increments = await runIncrementIntegrity(
    config,
    anchor,
    products,
    config.profile.updatesPerProduct,
  );
  const contention = await runContention(config, anchor, runSalt);
  return {
    stages: [increments.summary, ...contention.stages],
    integrity: [increments.integrity, ...contention.rows],
    aborted: null,
  };
}

module.exports = { runStockSuite };
