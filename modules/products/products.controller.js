const { prisma } = require("../../db");
const { toNonNegativeNumber } = require("../../utils/numbers");
const { productAccessWhere } = require("./product-access");
const { emitBusinessEvent } = require("../realtime/socket");

async function listProducts(req, res) {
  // The web app has no product-list pagination. Returning 10k rows (~3.5MB) makes the
  // Products page paint blank / freeze. Default to a UI-safe page; pass ?limit=10000 for full dump.
  // Newest first so scanner/manual adds are visible even when thousands of seed products exist.
  const DEFAULT_LIMIT = Number(process.env.PRODUCTS_LIST_DEFAULT_LIMIT || 250);
  const MAX_LIMIT = Number(process.env.PRODUCTS_LIST_MAX_LIMIT || 10000);
  const requested = req.query.limit;
  const limit =
    requested === undefined || requested === ""
      ? DEFAULT_LIMIT
      : Math.min(Math.max(Number(requested) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const products = await prisma.product.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    where: productAccessWhere(req),
    take: limit,
  });

  res.json(products);
}

async function searchProducts(req, res) {
  const startedAt = performance.now();
  const query = String(req.query.q ?? "").trim();

  if (!query) {
    return res.json({ durationMs: 0, products: [] });
  }

  const products = await prisma.product.findMany({
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
    products,
  });
}

async function findProductByBarcode(req, res) {
  const barcode = String(req.params.barcode ?? "").trim();
  const product = await prisma.product.findFirst({
    where: productAccessWhere(req, {
      OR: [{ barcode }, { qrCode: barcode }],
    }),
  });

  res.json(product);
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

    emitBusinessEvent(req.businessId, "product.created", product);
    return res.status(201).json(product);
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
        imageUrl: imageUrl || null,
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

    emitBusinessEvent(req.businessId, "product.updated", product);
    return res.json(product);
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

async function importProducts(req, res) {
  try {
    const products = Array.isArray(req.body.products) ? req.body.products : [];

    if (products.length === 0) {
      return res.status(400).json({ message: "No products provided." });
    }

    const cleanNum = (val, fallback = 0) => {
      if (val === undefined || val === null || val === "") return fallback;
      const cleaned = String(val).replace(/,/g, "").trim();
      const n = Number(cleaned);
      return isNaN(n) ? fallback : Math.max(0, n);
    };

    const result = {
      created: 0,
      failed: [],
      updated: 0,
    };

    for (const [index, item] of products.entries()) {
      try {
        let barcode = String(item.barcode ?? "").trim();
        const name = String(item.name ?? "").trim();
        const category = String(item.category ?? "").trim();
        const costPrice = cleanNum(item.costPrice, 0);
        const sellingPrice = cleanNum(item.sellingPrice ?? item.price, 0);
        const stock = Math.floor(cleanNum(item.stock, 0));
        const lowStockThreshold = Math.floor(cleanNum(item.lowStockThreshold, 5));
        const sku = String(item.sku ?? "").trim();
        const qrCode = String(item.qrCode ?? "").trim();
        const imageUrl = String(item.imageUrl ?? "").trim();

        if (!name || name.length < 1) {
          throw new Error("Product name is required.");
        }

        // Auto-generate barcode if omitted
        if (!barcode) {
          barcode = `BC-${Date.now().toString().slice(-6)}-${index + 1}`;
        }

        const discountType = ["fixed", "percentage"].includes(String(item.discountType || "").toLowerCase())
          ? String(item.discountType).toLowerCase()
          : "none";
        const discountValue = cleanNum(item.discountValue, 0);

        const existing = await prisma.product.findFirst({
          where: { businessId: req.businessId, barcode },
        });

        if (existing) {
          await prisma.product.update({
            data: {
              category: category || existing.category || null,
              costPrice: costPrice !== undefined ? costPrice : existing.costPrice,
              discountType: item.discountType !== undefined ? discountType : existing.discountType,
              discountValue: item.discountValue !== undefined ? discountValue : existing.discountValue,
              imageUrl: imageUrl || existing.imageUrl || null,
              lowStockThreshold,
              name,
              price: sellingPrice > 0 ? sellingPrice : existing.price,
              qrCode: qrCode || existing.qrCode || null,
              sellingPrice: sellingPrice > 0 ? sellingPrice : existing.sellingPrice,
              sku: sku || existing.sku || null,
              stock,
            },
            where: { id: existing.id },
          });
          result.updated += 1;
        } else {
          await prisma.product.create({
            data: {
              barcode,
              businessId: req.businessId,
              category: category || null,
              costPrice,
              createdByUserId: req.user.id,
              discountType,
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
          result.created += 1;
        }
      } catch (error) {
        result.failed.push({
          index: index + 1,
          name: item.name || `Row ${index + 1}`,
          message: error.message ?? "Invalid product row.",
        });
      }
    }

    if (result.created > 0 || result.updated > 0) {
      emitBusinessEvent(req.businessId, "product.updated", { bulk: true });
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
    const products = await prisma.product.findMany({
      orderBy: { name: "asc" },
      where: productAccessWhere(req),
    });

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

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
          escapeCsv(p.category || ""),
          p.costPrice ?? 0,
          p.sellingPrice || p.price || 0,
          p.stock ?? 0,
          p.lowStockThreshold ?? 5,
          escapeCsv(p.sku || ""),
          escapeCsv(p.qrCode || ""),
        ].join(",")
      );
    }

    const csvContent = "\uFEFF" + rows.join("\r\n"); // UTF-8 BOM for Excel support
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="products.csv"');
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error("Export products error:", error);
    return res.status(500).json({ message: "Could not export products." });
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

    const saleItemCount = await prisma.saleItem.count({
      where: { productId: id },
    });

    if (saleItemCount > 0) {
      return res.status(409).json({
        message:
          "This product has sale history. Keep it for reports instead of deleting.",
      });
    }

    await prisma.$transaction([
      prisma.stockLog.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);

    emitBusinessEvent(req.businessId, "product.deleted", { id });
    return res.json({ deleted: true });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Product not found." });
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

