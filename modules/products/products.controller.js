const { prisma, prismaRead } = require("../../db");
const { toNonNegativeNumber } = require("../../utils/numbers");
const {
  canViewCostPrice,
  productAccessWhere,
  serializeProduct,
  serializeProducts,
} = require("./product-access");
const { emitBusinessEvent } = require("../realtime/socket");
const { searchProductsElasticsearch } = require("../search/elasticsearch");

async function listProducts(req, res) {
  // Interactive list is always paginated. Full dumps belong on GET /products/export.
  // Newest first so scanner/manual adds stay visible under large catalogs.
  const { parsePagination, paginationMeta } = require("../../utils/pagination");
  const { page, limit, skip } = parsePagination(req.query, {
    defaultLimit: Number(process.env.PRODUCTS_LIST_DEFAULT_LIMIT || 50),
    maxLimit: Number(process.env.PRODUCTS_LIST_MAX_LIMIT || 250),
  });
  const where = productAccessWhere(req);

  const [products, total] = await Promise.all([
    prismaRead.product.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      where,
      skip,
      take: limit,
    }),
    prismaRead.product.count({ where }),
  ]);

  if (String(req.query.legacy || "") === "1") {
    return res.json(serializeProducts(products, req));
  }

  const pagination = paginationMeta(page, limit, total);
  res.json({ products: serializeProducts(products, req), pagination });
}

async function searchProducts(req, res) {
  const startedAt = performance.now();
  const query = String(req.query.q ?? "").trim();

  if (!query) {
    return res.json({ durationMs: 0, products: [] });
  }

  const businessId = Number(req.businessId);
  const esResult = await searchProductsElasticsearch({
    businessId,
    query,
    limit: 50,
  });

  if (esResult?.ids?.length) {
    const products = await prismaRead.product.findMany({
      where: productAccessWhere(req, { id: { in: esResult.ids } }),
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const ordered = esResult.ids.map((id) => byId.get(id)).filter(Boolean);
    return res.json({
      durationMs: Math.round(performance.now() - startedAt),
      products: serializeProducts(ordered, req),
      source: "elasticsearch",
    });
  }

  const products = await prismaRead.product.findMany({
    orderBy: { name: "asc" },
    take: 50,
    where: productAccessWhere(req, {
      OR: [
        { barcode: { startsWith: query } },
        { category: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { qrCode: { startsWith: query } },
        { sku: { startsWith: query } },
      ],
    }),
  });

  return res.json({
    durationMs: Math.round(performance.now() - startedAt),
    products: serializeProducts(products, req),
    source: "postgres",
  });
}

async function findProductByBarcode(req, res) {
  const barcode = String(req.params.barcode ?? "").trim();
  const product = await prismaRead.product.findFirst({
    where: productAccessWhere(req, {
      OR: [{ barcode }, { qrCode: barcode }],
    }),
  });

  res.json(serializeProduct(product, req));
}

async function createProduct(req, res) {
  try {
    const barcode = String(req.body.barcode ?? "").trim();
    const category = String(req.body.category ?? "").trim();
    const costPrice = toNonNegativeNumber(req.body.costPrice ?? 0, "Cost price");
    const imageUrl = String(req.body.imageUrl ?? "").trim();
    const lowStockThreshold = Math.floor(
      toNonNegativeNumber(req.body.lowStockThreshold ?? 5, "Low stock threshold"),
    );
    const name = String(req.body.name ?? "").trim();
    const qrCode = String(req.body.qrCode ?? "").trim();
    const sellingPrice = toNonNegativeNumber(
      req.body.sellingPrice ?? req.body.price,
      "Selling price",
    );
    const sku = String(req.body.sku ?? "").trim();
    const stock = Math.floor(
      toNonNegativeNumber(req.body.stock ?? 0, "Opening stock"),
    );

    const VALID_DISCOUNT_TYPES = new Set(["none", "fixed", "percentage"]);
    const discountType = String(req.body.discountType ?? "none").toLowerCase();
    const parsedDiscountType = VALID_DISCOUNT_TYPES.has(discountType) ? discountType : "none";
    let discountValue = toNonNegativeNumber(req.body.discountValue ?? 0, "Discount value");

    if (!barcode || !name || name.length < 2) {
      return res.status(400).json({
        message: "Barcode and a valid product name (min 2 characters) are required.",
      });
    }

    if (sellingPrice <= 0) {
      return res.status(400).json({
        message: "Selling price must be greater than 0.",
      });
    }

    if (parsedDiscountType === "percentage" && discountValue > 100) {
      return res.status(400).json({
        message: "Percentage discount cannot exceed 100%.",
      });
    }

    if (parsedDiscountType === "fixed" && discountValue > sellingPrice) {
      return res.status(400).json({
        message: "Fixed discount cannot exceed selling price.",
      });
    }

    if (parsedDiscountType === "none") {
      discountValue = 0;
    }

    const product = await prisma.product.create({
      data: {
        barcode,
        businessId: req.businessId,
        category: category || null,
        costPrice,
        createdByUserId: req.user.id,
        discountType: parsedDiscountType,
        discountValue,
        imageUrl: imageUrl || null,
        lowStockThreshold,
        name,
        price: sellingPrice,
        qrCode: qrCode || null,
        sellingPrice,
        sku: sku || null,
        stock,
      },
    });

    emitBusinessEvent(req.businessId, "product.created", serializeProduct(product, req));
    return res.status(201).json(serializeProduct(product, req));
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        message: "Product barcode already exists.",
      });
    }

    return res.status(400).json({
      message: error.message ?? "Could not add product.",
    });
  }
}

async function updateProduct(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const barcode = String(req.body.barcode ?? "").trim();
    const category = String(req.body.category ?? "").trim();
    const costPrice = toNonNegativeNumber(req.body.costPrice ?? 0, "Cost price");
    const imageUrl = String(req.body.imageUrl ?? "").trim();
    const lowStockThreshold = Math.floor(
      toNonNegativeNumber(req.body.lowStockThreshold ?? 5, "Low stock threshold"),
    );
    const name = String(req.body.name ?? "").trim();
    const qrCode = String(req.body.qrCode ?? "").trim();
    const sellingPrice = toNonNegativeNumber(
      req.body.sellingPrice ?? req.body.price,
      "Selling price",
    );
    const sku = String(req.body.sku ?? "").trim();
    const stock = Math.floor(
      toNonNegativeNumber(req.body.stock ?? 0, "Current stock"),
    );

    const VALID_DISCOUNT_TYPES = new Set(["none", "fixed", "percentage"]);
    const discountType = String(req.body.discountType ?? "none").toLowerCase();
    const parsedDiscountType = VALID_DISCOUNT_TYPES.has(discountType) ? discountType : "none";
    let discountValue = toNonNegativeNumber(req.body.discountValue ?? 0, "Discount value");

    if (!barcode || !name || name.length < 2) {
      return res.status(400).json({
        message: "Barcode and a valid product name (min 2 characters) are required.",
      });
    }

    if (sellingPrice <= 0) {
      return res.status(400).json({
        message: "Selling price must be greater than 0.",
      });
    }

    if (parsedDiscountType === "percentage" && discountValue > 100) {
      return res.status(400).json({
        message: "Percentage discount cannot exceed 100%.",
      });
    }

    if (parsedDiscountType === "fixed" && discountValue > sellingPrice) {
      return res.status(400).json({
        message: "Fixed discount cannot exceed selling price.",
      });
    }

    if (parsedDiscountType === "none") {
      discountValue = 0;
    }

    const existing = await prisma.product.findFirst({
      where: { id, businessId: req.businessId },
    });

    if (!existing) {
      return res.status(404).json({ message: "Product not found." });
    }

    const product = await prisma.product.update({
      data: {
        barcode,
        category: category || null,
        costPrice,
        discountType: parsedDiscountType,
        discountValue,
        imageUrl: imageUrl || existing.imageUrl || null,
        lowStockThreshold,
        name,
        price: sellingPrice,
        qrCode: qrCode || null,
        sellingPrice,
        sku: sku || null,
        stock,
      },
      where: { id },
    });

    emitBusinessEvent(req.businessId, "product.updated", serializeProduct(product, req));
    return res.json(serializeProduct(product, req));
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        message: "Product barcode already exists in this business.",
      });
    }

    if (error.code === "P2025") {
      return res.status(404).json({ message: "Product not found." });
    }

    return res.status(400).json({
      message: error.message ?? "Could not update product.",
    });
  }
}

const IMPORT_MAX_ROWS = Number(process.env.PRODUCTS_IMPORT_MAX_ROWS || 2000);
const IMPORT_CHUNK_SIZE = Number(process.env.PRODUCTS_IMPORT_CHUNK_SIZE || 75);

async function importProducts(req, res) {
  try {
    const products = Array.isArray(req.body.products) ? req.body.products : [];

    if (products.length === 0) {
      return res.status(400).json({ message: "No products provided." });
    }

    if (products.length > IMPORT_MAX_ROWS) {
      return res.status(413).json({
        message: `Import limited to ${IMPORT_MAX_ROWS} rows per request. Split the file and try again.`,
        maxRows: IMPORT_MAX_ROWS,
        received: products.length,
      });
    }

    const cleanNum = (val, fallback = 0) => {
      if (val === undefined || val === null || val === "") return fallback;
      const cleaned = String(val).replace(/,/g, "").trim();
      const n = Number(cleaned);
      return Number.isNaN(n) ? fallback : Math.max(0, n);
    };

    const result = { created: 0, failed: [], updated: 0 };
    const businessId = req.businessId;
    const userId = req.user.id;
    const stamp = Date.now().toString().slice(-6);

    // Normalize + validate rows first (no DB yet)
    const rows = [];
    for (const [index, item] of products.entries()) {
      try {
        let barcode = String(item.barcode ?? "").trim();
        const name = String(item.name ?? "").trim();
        if (!name || name.length < 1) {
          throw new Error("Product name is required.");
        }
        if (!barcode) {
          barcode = `BC-${stamp}-${index + 1}`;
        }
        const discountType = ["fixed", "percentage"].includes(String(item.discountType || "").toLowerCase())
          ? String(item.discountType).toLowerCase()
          : "none";
        rows.push({
          index: index + 1,
          barcode,
          name,
          category: String(item.category ?? "").trim() || null,
          costPrice: cleanNum(item.costPrice, 0),
          sellingPrice: cleanNum(item.sellingPrice ?? item.price, 0),
          stock: Math.floor(cleanNum(item.stock, 0)),
          lowStockThreshold: Math.floor(cleanNum(item.lowStockThreshold, 5)),
          sku: String(item.sku ?? "").trim() || null,
          qrCode: String(item.qrCode ?? "").trim() || null,
          imageUrl: String(item.imageUrl ?? "").trim() || null,
          discountType,
          discountValue: cleanNum(item.discountValue, 0),
          hasDiscountType: item.discountType !== undefined,
          hasDiscountValue: item.discountValue !== undefined,
        });
      } catch (error) {
        result.failed.push({
          index: index + 1,
          name: item?.name || `Row ${index + 1}`,
          message: error.message ?? "Invalid product row.",
        });
      }
    }

    // Prefetch existing barcodes for this business in one query
    const barcodes = [...new Set(rows.map((r) => r.barcode))];
    const existingList =
      barcodes.length > 0
        ? await prismaRead.product.findMany({
            where: { businessId, barcode: { in: barcodes } },
            select: {
              id: true,
              barcode: true,
              category: true,
              costPrice: true,
              discountType: true,
              discountValue: true,
              imageUrl: true,
              price: true,
              qrCode: true,
              sellingPrice: true,
              sku: true,
            },
          })
        : [];
    const existingByBarcode = new Map(existingList.map((p) => [p.barcode, p]));

    const toCreate = [];
    const toUpdate = [];
    const seenInBatch = new Set();

    for (const row of rows) {
      if (seenInBatch.has(row.barcode)) {
        result.failed.push({
          index: row.index,
          name: row.name,
          message: "Duplicate barcode in this import batch.",
        });
        continue;
      }
      seenInBatch.add(row.barcode);
      const existing = existingByBarcode.get(row.barcode);
      if (existing) toUpdate.push({ row, existing });
      else toCreate.push(row);
    }

    // Chunked creates
    for (let i = 0; i < toCreate.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = toCreate.slice(i, i + IMPORT_CHUNK_SIZE);
      try {
        const created = await prisma.product.createMany({
          data: chunk.map((row) => ({
            barcode: row.barcode,
            businessId,
            category: row.category,
            costPrice: row.costPrice,
            createdByUserId: userId,
            discountType: row.discountType,
            discountValue: row.discountValue,
            imageUrl: row.imageUrl,
            lowStockThreshold: row.lowStockThreshold,
            name: row.name,
            price: row.sellingPrice,
            qrCode: row.qrCode,
            sellingPrice: row.sellingPrice,
            sku: row.sku,
            stock: row.stock,
          })),
          skipDuplicates: true,
        });
        result.created += created.count;
      } catch (error) {
        // Fall back to per-row create for this chunk so failures are attributable
        for (const row of chunk) {
          try {
            await prisma.product.create({
              data: {
                barcode: row.barcode,
                businessId,
                category: row.category,
                costPrice: row.costPrice,
                createdByUserId: userId,
                discountType: row.discountType,
                discountValue: row.discountValue,
                imageUrl: row.imageUrl,
                lowStockThreshold: row.lowStockThreshold,
                name: row.name,
                price: row.sellingPrice,
                qrCode: row.qrCode,
                sellingPrice: row.sellingPrice,
                sku: row.sku,
                stock: row.stock,
              },
            });
            result.created += 1;
          } catch (rowErr) {
            result.failed.push({
              index: row.index,
              name: row.name,
              message: rowErr.message ?? "Could not create product.",
            });
          }
        }
      }
    }

    // Chunked updates in a transaction
    for (let i = 0; i < toUpdate.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = toUpdate.slice(i, i + IMPORT_CHUNK_SIZE);
      try {
        await prisma.$transaction(
          chunk.map(({ row, existing }) =>
            prisma.product.update({
              where: { id: existing.id },
              data: {
                category: row.category || existing.category || null,
                costPrice: row.costPrice,
                discountType: row.hasDiscountType ? row.discountType : existing.discountType,
                discountValue: row.hasDiscountValue ? row.discountValue : existing.discountValue,
                imageUrl: row.imageUrl || existing.imageUrl || null,
                lowStockThreshold: row.lowStockThreshold,
                name: row.name,
                price: row.sellingPrice > 0 ? row.sellingPrice : existing.price,
                qrCode: row.qrCode || existing.qrCode || null,
                sellingPrice: row.sellingPrice > 0 ? row.sellingPrice : existing.sellingPrice,
                sku: row.sku || existing.sku || null,
                stock: row.stock,
              },
            }),
          ),
        );
        result.updated += chunk.length;
      } catch (error) {
        for (const { row, existing } of chunk) {
          try {
            await prisma.product.update({
              where: { id: existing.id },
              data: {
                category: row.category || existing.category || null,
                costPrice: row.costPrice,
                discountType: row.hasDiscountType ? row.discountType : existing.discountType,
                discountValue: row.hasDiscountValue ? row.discountValue : existing.discountValue,
                imageUrl: row.imageUrl || existing.imageUrl || null,
                lowStockThreshold: row.lowStockThreshold,
                name: row.name,
                price: row.sellingPrice > 0 ? row.sellingPrice : existing.price,
                qrCode: row.qrCode || existing.qrCode || null,
                sellingPrice: row.sellingPrice > 0 ? row.sellingPrice : existing.sellingPrice,
                sku: row.sku || existing.sku || null,
                stock: row.stock,
              },
            });
            result.updated += 1;
          } catch (rowErr) {
            result.failed.push({
              index: row.index,
              name: row.name,
              message: rowErr.message ?? "Could not update product.",
            });
          }
        }
      }
    }

    if (result.created > 0 || result.updated > 0) {
      emitBusinessEvent(businessId, "product.updated", { bulk: true });
    }

    return res.json(result);
  } catch (error) {
    return res.status(400).json({
      message: error.message ?? "Could not import products.",
    });
  }
}

async function exportProductsCsv(req, res) {
  try {
    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const includeCost = canViewCostPrice(req);
    const headers = [
      "Barcode",
      "Name",
      "Category",
      ...(includeCost ? ["Cost Price"] : []),
      "Selling Price",
      "Stock",
      "Low Stock Threshold",
      "SKU",
      "QR Code",
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="products.csv"');
    res.write("\uFEFF"); // UTF-8 BOM for Excel
    res.write(`${headers.join(",")}\r\n`);

    const where = productAccessWhere(req);
    const CHUNK = 500;
    let cursorId = null;
    // Stable cursor walk by id (name order would need keyset on name+id)
    for (;;) {
      const batch = await prismaRead.product.findMany({
        where,
        orderBy: { id: "asc" },
        take: CHUNK,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
        select: {
          id: true,
          barcode: true,
          name: true,
          category: true,
          costPrice: true,
          sellingPrice: true,
          price: true,
          stock: true,
          lowStockThreshold: true,
          sku: true,
          qrCode: true,
        },
      });
      if (batch.length === 0) break;
      for (const p of batch) {
        res.write(
          [
            escapeCsv(p.barcode),
            escapeCsv(p.name),
            escapeCsv(p.category || ""),
            ...(includeCost ? [p.costPrice ?? 0] : []),
            p.sellingPrice || p.price || 0,
            p.stock ?? 0,
            p.lowStockThreshold ?? 5,
            escapeCsv(p.sku || ""),
            escapeCsv(p.qrCode || ""),
          ].join(",") + "\r\n",
        );
      }
      cursorId = batch[batch.length - 1].id;
      if (batch.length < CHUNK) break;
    }

    return res.end();
  } catch (error) {
    console.error("Export products error:", error);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Could not export products." });
    }
    return res.end();
  }
}

async function deleteProduct(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const existing = await prisma.product.findFirst({
      where: { id, businessId: req.businessId },
    });

    if (!existing) {
      return res.status(404).json({ message: "Product not found." });
    }

    try {
      await prisma.$transaction(async (tx) => {
        const saleItemCount = await tx.saleItem.count({
          where: { productId: id },
        });

        if (saleItemCount > 0) {
          const err = new Error(
            "This product has sale history. Keep it for reports instead of deleting.",
          );
          err.code = "PRODUCT_HAS_SALE_HISTORY";
          err.status = 409;
          throw err;
        }

        await tx.stockLog.deleteMany({ where: { productId: id, businessId: req.businessId } });
        await tx.product.delete({ where: { id } });
      });
    } catch (inner) {
      if (inner.code === "PRODUCT_HAS_SALE_HISTORY" || inner.code === "P2003") {
        return res.status(409).json({
          message:
            "This product has sale history. Keep it for reports instead of deleting.",
          code: "PRODUCT_HAS_SALE_HISTORY",
        });
      }
      throw inner;
    }

    emitBusinessEvent(req.businessId, "product.deleted", { id });
    return res.json({ deleted: true });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Product not found." });
    }
    if (error.code === "PRODUCT_HAS_SALE_HISTORY" || error.code === "P2003") {
      return res.status(409).json({
        message:
          "This product has sale history. Keep it for reports instead of deleting.",
        code: "PRODUCT_HAS_SALE_HISTORY",
      });
    }

    console.error("Delete product error:", error);
    return res.status(400).json({ message: "Could not delete product." });
  }
}

module.exports = {
  createProduct,
  deleteProduct,
  exportProductsCsv,
  findProductByBarcode,
  importProducts,
  listProducts,
  searchProducts,
  updateProduct,
};

