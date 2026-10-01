const { requestJson } = require("../lib/http");
const { summarizeSamples } = require("../lib/metrics");

const READS = [
  { test: "business-list", path: "/business/my-businesses", paginated: false },
  { test: "dashboard", path: "/dashboard", paginated: false },
  { test: "team-list", path: "/admin/staff?page=1&limit=50", paginated: true, limited: 50 },
  { test: "product-list", path: "/products?page=1&limit=50", paginated: true, limited: 50 },
  { test: "product-search", path: "/products/search?q=Loadtest", paginated: false, limited: 50 },
  { test: "sales-list", path: "/sales", paginated: false },
];

async function runReadSuite(config, anchor, businessId = anchor.businessId) {
  const stages = [];
  let barcode = null;
  const sampleProduct = await requestJson(config, {
    method: "GET",
    path: "/products/search?q=STRESS",
    token: anchor.token,
    businessId,
  });
  barcode = sampleProduct.json?.products?.[0]?.barcode || null;
  if (!barcode) {
    const fallback = await requestJson(config, {
      method: "GET",
      path: "/products/search?q=Loadtest",
      token: anchor.token,
      businessId,
    });
    barcode = fallback.json?.products?.[0]?.barcode || null;
  }

  const endpoints = [...READS];
  if (barcode) {
    endpoints.push({
      test: "product-barcode",
      path: `/products/barcode/${encodeURIComponent(barcode)}`,
      paginated: false,
    });
  }
  endpoints.push({
    test: "business-detail",
    path: `/business/${businessId}`,
    paginated: false,
  });

  for (const endpoint of endpoints) {
    for (const concurrency of config.profile.readConcurrency) {
      const started = performance.now();
      const samples = await Promise.all(
        Array.from({ length: concurrency }, () =>
          requestJson(config, {
            method: "GET",
            path: endpoint.path,
            token: anchor.token,
            businessId,
          }),
        ),
      );
      const body = samples[0]?.json;
      const rows = Array.isArray(body)
        ? body.length
        : Array.isArray(body?.staff)
          ? body.staff.length
          : Array.isArray(body?.products)
            ? body.products.length
            : Array.isArray(body?.businesses)
              ? body.businesses.length
              : null;
      stages.push(
        summarizeSamples(samples, {
          test: endpoint.test,
          endpoint: `GET ${endpoint.path}`,
          concurrency,
          elapsedMs: performance.now() - started,
          rowsReturned: rows,
          paginated: endpoint.paginated,
          responseLimit: endpoint.limited || null,
          businessId,
        }),
      );
    }
  }

  return { stages, aborted: null, notes: notesForReads() };
}

function notesForReads() {
  return [
    "GET /products is paginated (default limit 50, max 250) and returns `{ products, pagination }`. Use GET /products/export for full dumps.",
    "GET /admin/staff is paginated (default 50, max 100) and aggregates stats only for the current page of members.",
    "GET /products/search stops at 50 rows.",
    "There is no separate stock-list route. Stock is a column on products. Stock changes go through POST /stock/add, POST /stock/receive-one, and sale checkout.",
    "GET /dashboard returns summary metrics + top-N low-stock / top sellers (no full catalog).",
  ];
}

module.exports = { runReadSuite };
