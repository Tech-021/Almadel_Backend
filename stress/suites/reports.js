const { requestJson } = require("../lib/http");
const { summarizeSamples } = require("../lib/metrics");

async function runReportsSuite(config, anchor) {
  const from = "2020-01-01";
  const to = "2030-12-31";
  const endpoints = [
    { test: "reports-sales-daily", path: "/reports/sales?period=daily" },
    { test: "reports-sales-weekly", path: "/reports/sales?period=weekly" },
    { test: "reports-sales-monthly", path: "/reports/sales?period=monthly" },
    { test: "reports-products", path: "/reports/products" },
    { test: "reports-stock", path: "/reports/stock" },
    { test: "reports-balance-summary", path: `/finance/reports/summary?from=${from}&to=${to}` },
  ];

  const stages = [];
  for (const endpoint of endpoints) {
    for (const concurrency of config.profile.readConcurrency) {
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
      stages.push(
        summarizeSamples(samples, {
          test: endpoint.test,
          endpoint: `GET ${endpoint.path.split("?")[0]}`,
          concurrency,
          elapsedMs: performance.now() - started,
          rowsReturned: samples[0]?.json ? 1 : 0,
          paginated: false,
        }),
      );
    }
  }

  return {
    stages,
    aborted: null,
    scenario:
      "Read-only scalability for Reports & Balance Sheet paths: /reports/sales|products|stock and /finance/reports/summary.",
  };
}

module.exports = { runReportsSuite };
