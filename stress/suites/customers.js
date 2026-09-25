const { requestJson } = require("../lib/http");
const { summarizeSamples } = require("../lib/metrics");
const { runCountedStages } = require("../lib/stages");

function customerBody(runSalt, sequence) {
  const id = String(sequence).padStart(7, "0");
  // Pakistan mobile: 03 + 9 digits (11 total). Keep unique per runSalt+sequence.
  const suffix = String((runSalt % 1000) * 10000000 + sequence).padStart(9, "0").slice(-9);
  return {
    name: `Loadtest customer ${id}`,
    mobile: `03${suffix}`,
    email: `loadtest_customer_${runSalt}_${id}@example.test`,
  };
}

async function runCustomerSuite(config, anchor, runSalt) {
  return runCountedStages({
    config,
    test: "customer-create",
    scenario: "API load against one stress business via POST /customers (Customers / Khata).",
    counts: config.profile.customerCounts,
    makeItem: (sequence) => sequence,
    worker: (sequence) =>
      requestJson(config, {
        method: "POST",
        path: "/customers",
        token: anchor.token,
        businessId: anchor.businessId,
        body: customerBody(runSalt, sequence),
      }),
  });
}

async function probeCustomerReads(config, anchor, concurrencyLevels) {
  const list = await requestJson(config, {
    method: "GET",
    path: "/customers",
    token: anchor.token,
    businessId: anchor.businessId,
  });
  const customers = Array.isArray(list.json?.customers) ? list.json.customers : [];
  const sampleId = customers[0]?.id;

  const endpoints = [{ test: "customer-list", path: "/customers", paginated: false }];
  if (sampleId) {
    endpoints.push({
      test: "customer-history",
      path: `/customers/${sampleId}/history`,
      paginated: false,
    });
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
      const rows = Array.isArray(body?.customers)
        ? body.customers.length
        : Array.isArray(body?.sales)
          ? body.sales.length
          : body
            ? 1
            : 0;
      stages.push(
        summarizeSamples(samples, {
          test: endpoint.test,
          endpoint: `GET ${endpoint.path}`,
          concurrency,
          elapsedMs: performance.now() - started,
          rowsReturned: rows,
          paginated: endpoint.paginated,
        }),
      );
    }
  }
  return stages;
}

module.exports = { probeCustomerReads, runCustomerSuite };
