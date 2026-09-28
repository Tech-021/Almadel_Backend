const fs = require("fs");
const path = require("path");

const { requestJson } = require("../lib/http");
const { gradeStage, summarizeSamples } = require("../lib/metrics");

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "import-export");

function buildProducts(size) {
  return Array.from({ length: size }, (_, index) => {
    const sequence = index + 1;
    const id = String(sequence).padStart(6, "0");
    return {
      barcode: `STRESS-CSV-${id}`,
      name: `Stress CSV product ${id}`,
      category: `CSV category ${sequence % 20}`,
      costPrice: 10 + (sequence % 5),
      sellingPrice: 15 + (sequence % 5),
      stock: sequence % 50,
      lowStockThreshold: 5,
      sku: `STRESS-CSV-SKU-${id}`,
      qrCode: `STRESS-CSV-QR-${id}`,
    };
  });
}

function loadImportPayload(size, runSalt) {
  const file = path.join(FIXTURE_DIR, `import-${size}.json`);
  let products;
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    products = Array.isArray(raw.products) ? raw.products : [];
  } else {
    products = buildProducts(size);
  }
  // Remint barcodes so each stress run creates (or uniquely updates) rows instead of always hitting the same seed barcodes.
  return {
    products: products.map((item, index) => {
      const id = String(index + 1).padStart(6, "0");
      return {
        ...item,
        barcode: `LOADTEST-CSV-${runSalt}-${id}`,
        sku: `LOADTEST-CSV-SKU-${runSalt}-${id}`,
        qrCode: `LOADTEST-CSV-QR-${runSalt}-${id}`,
        name: `Loadtest CSV product ${runSalt}-${id}`,
      };
    }),
  };
}

function importTimeoutMs(config, batchSize) {
  // Import loops row-by-row; allow ~80ms/row with a floor and ceiling.
  const estimated = Math.max(config.timeoutMs, batchSize * 80 + 15000);
  return Math.min(estimated, Number(process.env.STRESS_IMPORT_TIMEOUT_MS || 300000));
}

async function runImportStages(config, anchor, runSalt) {
  const sizes = config.profile.importBatchSizes || [50];
  const stages = [];
  let aborted = null;

  for (const size of sizes) {
    const body = loadImportPayload(size, runSalt);
    const timeoutMs = importTimeoutMs(config, size);
    const started = performance.now();
    const sample = await requestJson(
      { ...config, timeoutMs },
      {
        method: "POST",
        path: "/products/import",
        token: anchor.token,
        businessId: anchor.businessId,
        body,
      },
    );
    const elapsedMs = performance.now() - started;
    const result = sample.json || {};
    const summary = summarizeSamples([sample], {
      test: "product-import",
      scenario: "Bulk POST /products/import against one stress business.",
      stage: String(size),
      target: size,
      concurrency: 1,
      elapsedMs,
      rowsSubmitted: size,
      created: result.created ?? null,
      updated: result.updated ?? null,
      failedRows: Array.isArray(result.failed) ? result.failed.length : null,
    });
    // Bulk import is intentionally multi-second; grade on success/errors only.
    if (!sample.ok || summary.errorRate > 0.05) summary.grade = "FAIL";
    else if (summary.errorRate >= 0.01) summary.grade = "WARNING";
    else summary.grade = "PASS";
    summary.note = `Bulk import of ${size} rows (sequential server loop). Timeout budget ${timeoutMs}ms.`;
    stages.push(summary);

    if (!sample.ok || summary.errorRate > config.maxErrorRate) {
      aborted = {
        test: "product-import",
        stage: String(size),
        concurrency: 1,
        requestsPerSecond: summary.requestsPerSecond,
        errorRate: summary.errorRate,
        p95Ms: summary.latency.p95Ms,
        reason: sample.ok
          ? `import stage ${size} exceeded error rate ${config.maxErrorRate}`
          : sample.errorMessage || `import failed with status ${sample.status}`,
        dominantErrors: summary.errorGroups,
        at: new Date().toISOString(),
      };
      break;
    }
  }

  return { stages, aborted };
}

async function runExportProbes(config, anchor, concurrencyLevels) {
  const stages = [];
  // Export can return a large CSV; allow more time than default API calls.
  const timeoutMs = Math.max(config.timeoutMs, Number(process.env.STRESS_EXPORT_TIMEOUT_MS || 60000));

  for (const concurrency of concurrencyLevels) {
    const started = performance.now();
    const samples = await Promise.all(
      Array.from({ length: concurrency }, () =>
        requestJson(
          { ...config, timeoutMs },
          {
            method: "GET",
            path: "/products/export",
            token: anchor.token,
            businessId: anchor.businessId,
          },
        ),
      ),
    );
    const elapsedMs = performance.now() - started;
    const summary = summarizeSamples(samples, {
      test: "product-export",
      scenario: "Concurrent GET /products/export (full catalog CSV).",
      endpoint: "GET /products/export",
      concurrency,
      elapsedMs,
      responseBytesAvg: samples.length
        ? Math.round(samples.reduce((sum, s) => sum + (s.bytes || 0), 0) / samples.length)
        : 0,
    });
    summary.grade = gradeStage(summary, config);
    stages.push(summary);
  }

  return stages;
}

async function runImportExportSuite(config, anchor, runSalt) {
  const importRun = await runImportStages(config, anchor, runSalt);
  const exportStages = await runExportProbes(config, anchor, config.profile.readConcurrency);
  return {
    stages: [...importRun.stages, ...exportStages],
    aborted: importRun.aborted,
    created: importRun.stages.reduce((sum, stage) => sum + (stage.created || 0), 0),
  };
}

module.exports = {
  FIXTURE_DIR,
  loadImportPayload,
  runImportExportSuite,
};
