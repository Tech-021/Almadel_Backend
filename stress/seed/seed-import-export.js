const fs = require("fs");
const path = require("path");

const { loadStressEnv, assertStressEnvironment } = require("../lib/safety");

loadStressEnv();
assertStressEnvironment();

const {
  createInBatches,
  ensureSeedOwner,
  ensureWorstCaseBusiness,
  passwordHash,
  prisma,
} = require("./common");

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "import-export");

/** Batch sizes written as reusable import payloads (JSON + CSV). */
const DEFAULT_SIZES = [50, 100, 500, 1000, 5000];

function parseSizes() {
  const raw = process.env.STRESS_IMPORT_SIZES;
  if (!raw) return DEFAULT_SIZES;
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function productRow(sequence) {
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
}

function toCsv(products) {
  const headers = [
    "Barcode",
    "Name",
    "Category",
    "Cost Price",
    "Selling Price",
    "Stock",
    "Low Stock Threshold",
    "SKU",
    "QR Code",
  ];
  const rows = [headers.join(",")];
  for (const p of products) {
    rows.push(
      [
        escapeCsv(p.barcode),
        escapeCsv(p.name),
        escapeCsv(p.category),
        p.costPrice,
        p.sellingPrice,
        p.stock,
        p.lowStockThreshold,
        escapeCsv(p.sku),
        escapeCsv(p.qrCode),
      ].join(","),
    );
  }
  return "\uFEFF" + rows.join("\r\n");
}

async function ensureExportCatalog(owner, business) {
  const target = Number(process.env.STRESS_PRODUCTS || 10000);
  const existing = await prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
  });
  const needed = Math.max(0, target - existing);
  if (needed === 0) {
    console.log(`Export catalog already at ${existing} STRESS-P-* products (target ${target}).`);
    return existing;
  }

  console.log(`Ensuring export catalog. Target ${target}. Existing ${existing}. Inserting ${needed}.`);
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
      stock: 0,
      lowStockThreshold: 5,
    };
  });

  await createInBatches("export-catalog products", rows, (slice) =>
    prisma.product.createMany({ data: slice, skipDuplicates: true }),
  );

  return prisma.product.count({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
  });
}

async function main() {
  const hash = await passwordHash();
  const owner = await ensureSeedOwner(hash);
  const business = await ensureWorstCaseBusiness(owner);
  const sizes = parseSizes();

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  const files = [];
  for (const size of sizes) {
    const products = Array.from({ length: size }, (_, index) => productRow(index + 1));
    const jsonName = `import-${size}.json`;
    const csvName = `import-${size}.csv`;
    const jsonPath = path.join(FIXTURE_DIR, jsonName);
    const csvPath = path.join(FIXTURE_DIR, csvName);

    fs.writeFileSync(jsonPath, JSON.stringify({ products }, null, 2));
    fs.writeFileSync(csvPath, toCsv(products));

    const jsonBytes = fs.statSync(jsonPath).size;
    const csvBytes = fs.statSync(csvPath).size;
    files.push({
      size,
      json: jsonName,
      csv: csvName,
      jsonBytes,
      csvBytes,
      note: "POST /products/import expects JSON { products: [...] }. CSV mirrors export format for frontend/manual use.",
    });
    console.log(`Wrote ${jsonName} (${jsonBytes} bytes) and ${csvName} (${csvBytes} bytes)`);
  }

  const catalogProducts = await ensureExportCatalog(owner, business);
  const totalProducts = await prisma.product.count({ where: { businessId: business.id } });

  const manifest = {
    scenario: "IMPORT / EXPORT FIXTURES + WORST-CASE CATALOG",
    businessId: business.id,
    businessName: business.name,
    fixtureDir: FIXTURE_DIR,
    sizes,
    files,
    catalogProducts,
    totalProducts,
    api: {
      import: "POST /products/import",
      export: "GET /products/export",
    },
  };

  fs.writeFileSync(path.join(FIXTURE_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
