const { requestJson } = require("../lib/http");
const { summarizeSamples } = require("../lib/metrics");
const { runCountedStages } = require("../lib/stages");

function productBody(runSalt, sequence, stock = 0) {
  const id = String(sequence).padStart(6, "0");
  return {
    barcode: `LOADTEST-${runSalt}-${id}`,
    sku: `LOADTEST-SKU-${runSalt}-${id}`,
    name: `Loadtest product ${id}`,
    category: `Loadtest category ${sequence % 20}`,
    costPrice: 10,
    sellingPrice: 15,
    price: 15,
    stock,
    lowStockThreshold: 5,
  };
}

async function runProductSuite(config, anchor, runSalt) {
  return runCountedStages({
    config,
    test: "product-create",
    scenario: "API load against one stress business via POST /products.",
    counts: config.profile.productCounts,
    makeItem: (sequence) => sequence,
    worker: (sequence) =>
      requestJson(config, {
        method: "POST",
        path: "/products",
        token: anchor.token,
        businessId: anchor.businessId,
        body: productBody(runSalt, sequence, 0),
      }),
  });
}

async function probeProductReads(config, anchor, concurrencyLevels) {
  const search = await requestJson(config, {
    method: "GET",
    path: "/products/search?q=Loadtest",
    token: anchor.token,
    businessId: anchor.businessId,
  });
  const barcode = search.json?.products?.[0]?.barcode;

  const endpoints = [
    { test: "product-list", path: "/products" },
    { test: "product-search", path: "/products/search?q=Loadtest" },
  ];
  if (barcode) {
    endpoints.push({ test: "product-barcode", path: `/products/barcode/${encodeURIComponent(barcode)}` });
  }

  const stages = [];
  for (const endpoint of endpoints) {
    for (const concurrency of concurrencyLevels) {
      const started = performance.now();
      const samples = await Promise.all(
        Array.from({ length: concurrency }, () =>
          requestJson(config, {
            method: "GET",
            path: endpoint.path,
            token: anchor.token,
            businessId: anchor.businessId,
          }),
        ),
      );
      const body = samples[0]?.json;
      const rows = Array.isArray(body) ? body.length : Array.isArray(body?.products) ? body.products.length : body ? 1 : 0;
      stages.push(
        summarizeSamples(samples, {
          test: endpoint.test,
          endpoint: `GET ${endpoint.path}`,
          concurrency,
          elapsedMs: performance.now() - started,
          rowsReturned: rows,
          paginated: endpoint.test === "product-search",
        }),
      );
    }
  }
  return stages;
}

module.exports = { probeProductReads, productBody, runProductSuite };
