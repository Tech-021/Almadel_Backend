const { prisma } = require("../../db");
const { parseReportRange } = require("../../utils/report-range");
const { parsePagination, paginationMeta } = require("../../utils/pagination");
const { cacheGet, cacheSet } = require("../../utils/ttl-cache");

function getDayBounds(dateObj = new Date()) {
  const start = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);
  const end = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 23, 59, 59, 999);
  return { start, end };
}

// 1. SALES REPORT (Daily, Weekly, Monthly) — aggregates + paginated detail
async function getSalesReport(req, res) {
  const startedAt = performance.now();
  const businessId = req.businessId;
  const period = String(req.query.period || "daily").toLowerCase();
  const now = new Date();

  let startDate;
  let endDate;
  let breakdown = [];

  if (period === "daily") {
    const targetDate = req.query.date ? new Date(req.query.date) : now;
    const bounds = getDayBounds(targetDate);
    startDate = bounds.start;
    endDate = bounds.end;
  } else if (period === "weekly") {
    const endBounds = getDayBounds(now);
    endDate = endBounds.end;
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
  } else {
    const endBounds = getDayBounds(now);
    endDate = endBounds.end;
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
  }

  const saleWhere = {
    businessId,
    createdAt: { gte: startDate, lte: endDate },
  };

  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });

  const [agg, paymentGroups, dayRows, sales, totalOrders] = await Promise.all([
    prisma.sale.aggregate({
      where: saleWhere,
      _sum: { totalAmount: true, totalItems: true, discountAmount: true },
      _count: { id: true },
    }),
    prisma.sale.groupBy({
      by: ["paymentMethod"],
      where: saleWhere,
      _sum: { totalAmount: true },
    }),
    period === "weekly" || period === "monthly"
      ? prisma.$queryRaw`
          SELECT
            to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS orders,
            COALESCE(SUM("totalAmount"), 0)::float AS "totalAmount",
            COALESCE(SUM("totalItems"), 0)::int AS "totalItems",
            COALESCE(SUM("discountAmount"), 0)::float AS discounts
          FROM sales
          WHERE "businessId" = ${businessId}
            AND "createdAt" >= ${startDate}
            AND "createdAt" <= ${endDate}
          GROUP BY 1
          ORDER BY 1
        `
      : Promise.resolve([]),
    prisma.sale.findMany({
      where: saleWhere,
      select: {
        id: true,
        invoiceNumber: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        totalItems: true,
        paymentMethod: true,
        customerName: true,
        customerMobile: true,
        createdAt: true,
        customer: { select: { id: true, name: true, mobile: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.sale.count({ where: saleWhere }),
  ]);

  const totalRevenue = Number(agg._sum?.totalAmount || 0);
  const totalItems = Number(agg._sum?.totalItems || 0);
  const totalDiscounts = Number(agg._sum?.discountAmount || 0);
  const orderCount = Number(agg._count?.id || 0);
  const averageOrder = orderCount > 0 ? totalRevenue / orderCount : 0;

  let cashTotal = 0;
  let onlineTotal = 0;
  for (const row of paymentGroups) {
    const amt = Number(row._sum?.totalAmount || 0);
    if (String(row.paymentMethod || "cash").toLowerCase() === "cash") cashTotal += amt;
    else onlineTotal += amt;
  }

  if (period === "weekly" || period === "monthly") {
    const daysCount = period === "weekly" ? 7 : 30;
    const dayMap = new Map();
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, {
        date: key,
        dayName: d.toLocaleDateString("en-PK", { weekday: "short" }),
        displayDate: d.toLocaleDateString("en-PK", { day: "numeric", month: "short" }),
        orders: 0,
        totalAmount: 0,
        totalItems: 0,
        discounts: 0,
      });
    }
    for (const row of dayRows) {
      const key = String(row.day);
      if (dayMap.has(key)) {
        const item = dayMap.get(key);
        item.orders = Number(row.orders || 0);
        item.totalAmount = Number(row.totalAmount || 0);
        item.totalItems = Number(row.totalItems || 0);
        item.discounts = Number(row.discounts || 0);
      }
    }
    breakdown = Array.from(dayMap.values());
  }

  res.json({
    period,
    startDate,
    endDate,
    summary: {
      totalRevenue,
      totalOrders: orderCount,
      totalItems,
      totalDiscounts,
      averageOrder,
      cashTotal,
      onlineTotal,
    },
    breakdown,
    sales: sales.map((s) => ({
      id: s.id,
      invoiceNumber: s.invoiceNumber,
      subtotal: s.subtotal,
      discountAmount: s.discountAmount,
      totalAmount: s.totalAmount,
      totalItems: s.totalItems,
      paymentMethod: s.paymentMethod,
      customerName: s.customer?.name || s.customerName || "Walk-in Customer",
      customerMobile: s.customer?.mobile || s.customerMobile || null,
      cashier: s.user?.fullName || "Staff",
      createdAt: s.createdAt,
    })),
    pagination: paginationMeta(page, limit, totalOrders),
    meta: { durationMs: Math.round(performance.now() - startedAt) },
  });
}

// 2. PRODUCT REPORT — DB aggregates + top-N rows (no full catalog dump)
async function getProductReport(req, res) {
  const startedAt = performance.now();
  const businessId = req.businessId;
  const { from, to } = parseReportRange(req.query, { defaultDays: 30, maxDays: 366 });
  const TOP_N = Math.min(100, Math.max(10, Number(req.query.top) || 50));
  const cacheKey = `report:products:${businessId}:${from.toISOString()}:${to.toISOString()}:${TOP_N}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.json(cached);
  }

  const [catalogCount, salesTotals, bestRaw, leastRaw, zeroSalesCount] = await Promise.all([
    prisma.product.count({ where: { businessId } }),
    prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT si."productId")::int AS products_with_sales,
        COALESCE(SUM(si.quantity), 0)::int AS total_units,
        COALESCE(SUM(si.total), 0)::float AS total_revenue
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s."businessId" = ${businessId}
        AND s."createdAt" >= ${from}
        AND s."createdAt" <= ${to}
    `,
    prisma.$queryRaw`
      SELECT si."productId", MAX(si.name) AS name,
             SUM(si.quantity)::int AS quantity,
             SUM(si.total)::float AS revenue
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s."businessId" = ${businessId}
        AND s."createdAt" >= ${from}
        AND s."createdAt" <= ${to}
      GROUP BY si."productId"
      ORDER BY SUM(si.quantity) DESC, SUM(si.total) DESC
      LIMIT ${TOP_N}
    `,
    prisma.$queryRaw`
      SELECT si."productId", MAX(si.name) AS name,
             SUM(si.quantity)::int AS quantity,
             SUM(si.total)::float AS revenue
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s."businessId" = ${businessId}
        AND s."createdAt" >= ${from}
        AND s."createdAt" <= ${to}
      GROUP BY si."productId"
      ORDER BY SUM(si.quantity) ASC, SUM(si.total) ASC
      LIMIT ${TOP_N}
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM products p
      WHERE p."businessId" = ${businessId}
        AND NOT EXISTS (
          SELECT 1
          FROM sale_items si
          JOIN sales s ON s.id = si."saleId"
          WHERE si."productId" = p.id
            AND s."businessId" = ${businessId}
            AND s."createdAt" >= ${from}
            AND s."createdAt" <= ${to}
        )
    `,
  ]);

  const productsWithSales = Number(salesTotals[0]?.products_with_sales || 0);
  const totalUnitsSold = Number(salesTotals[0]?.total_units || 0);
  const totalSalesRevenue = Number(salesTotals[0]?.total_revenue || 0);

  const toSaleRow = (r) => ({
    productId: r.productId,
    name: r.name,
    _sum: { quantity: Number(r.quantity || 0), total: Number(r.revenue || 0) },
  });
  const itemSales = bestRaw.map(toSaleRow);
  const leastSlice = leastRaw.map(toSaleRow);
  const productIds = [...new Set([...itemSales, ...leastSlice].map((r) => r.productId).filter(Boolean))];

  const productRows = productIds.length
    ? await prisma.product.findMany({
        where: { businessId, id: { in: productIds } },
        select: {
          id: true,
          name: true,
          barcode: true,
          sku: true,
          category: true,
          sellingPrice: true,
          price: true,
          costPrice: true,
          stock: true,
          lowStockThreshold: true,
        },
      })
    : [];
  const byId = new Map(productRows.map((p) => [p.id, p]));

  function enrich(row) {
    const p = byId.get(row.productId) || {};
    const quantitySold = row._sum.quantity || 0;
    const totalRevenue = row._sum.total || 0;
    const price = Number(p.sellingPrice || p.price || 0);
    const cost = Number(p.costPrice || 0);
    const stock = Number(p.stock || 0);
    return {
      id: row.productId,
      name: p.name || row.name,
      barcode: p.barcode || null,
      sku: p.sku || null,
      category: p.category || "General",
      sellingPrice: price,
      costPrice: cost,
      stock,
      lowStockThreshold: p.lowStockThreshold || 5,
      quantitySold,
      totalRevenue,
      tiedUpCapital: stock * (cost > 0 ? cost : price),
      hasSales: quantitySold > 0,
      status:
        quantitySold === 0
          ? "Dead Stock (0 Sales)"
          : quantitySold <= 2
            ? "Slow Moving"
            : "Active Seller",
    };
  }

  const bestSelling = itemSales.map(enrich);
  const leastSelling = leastSlice.map(enrich);

  // Append a sample of zero-sales products into leastSelling when room remains
  if (leastSelling.length < TOP_N) {
    const remaining = TOP_N - leastSelling.length;
    const deadStock = await prisma.$queryRaw`
      SELECT p.id, p.name, p.barcode, p.sku, p.category, p."sellingPrice", p.price, p."costPrice",
             p.stock, p."lowStockThreshold"
      FROM products p
      WHERE p."businessId" = ${businessId}
        AND NOT EXISTS (
          SELECT 1
          FROM sale_items si
          JOIN sales s ON s.id = si."saleId"
          WHERE si."productId" = p.id
            AND s."businessId" = ${businessId}
            AND s."createdAt" >= ${from}
            AND s."createdAt" <= ${to}
        )
      ORDER BY p.stock DESC, p.id ASC
      LIMIT ${remaining}
    `;
    for (const p of deadStock) {
      const price = Number(p.sellingPrice || p.price || 0);
      const cost = Number(p.costPrice || 0);
      const stock = Number(p.stock || 0);
      leastSelling.push({
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        sku: p.sku,
        category: p.category || "General",
        sellingPrice: price,
        costPrice: cost,
        stock,
        lowStockThreshold: p.lowStockThreshold || 5,
        quantitySold: 0,
        totalRevenue: 0,
        tiedUpCapital: stock * (cost > 0 ? cost : price),
        hasSales: false,
        status: "Dead Stock (0 Sales)",
      });
    }
  }

  const payload = {
    from,
    to,
    summary: {
      totalCatalogProducts: catalogCount,
      productsWithSales,
      zeroSalesProducts: Number(zeroSalesCount[0]?.count || 0),
      totalUnitsSold,
      totalSalesRevenue,
    },
    bestSelling,
    leastSelling,
    meta: { durationMs: Math.round(performance.now() - startedAt), top: TOP_N },
  };

  const reportTtl = Number(process.env.REDIS_CACHE_TTL_REPORTS_MS) || 45000;
  await cacheSet(cacheKey, payload, reportTtl);
  res.setHeader("X-Cache", "MISS");
  res.json(payload);
}

// 3. STOCK REPORT — aggregate summary + bounded low/out lists (no full dump)
async function getStockReport(req, res) {
  const startedAt = performance.now();
  const businessId = req.businessId;
  const cacheKey = `report:stock:${businessId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.json(cached);
  }

  const LIST_CAP = 50;

  const [summaryRows, lowStock, outOfStock] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total_products,
        COALESCE(SUM(GREATEST(stock, 0)), 0)::int AS total_units,
        COALESCE(SUM(GREATEST(stock, 0) * COALESCE("sellingPrice", price, 0)), 0)::float AS total_retail_value,
        COALESCE(SUM(GREATEST(stock, 0) * COALESCE("costPrice", 0)), 0)::float AS total_cost_value,
        COUNT(*) FILTER (WHERE stock > 0 AND stock <= COALESCE("lowStockThreshold", 5))::int AS low_stock_count,
        COUNT(*) FILTER (WHERE stock <= 0)::int AS out_of_stock_count,
        COUNT(*) FILTER (WHERE stock > COALESCE("lowStockThreshold", 5))::int AS healthy_count
      FROM products
      WHERE "businessId" = ${businessId}
    `,
    prisma.$queryRaw`
      SELECT id, name, barcode, sku, category, stock, "lowStockThreshold",
             COALESCE("sellingPrice", price, 0)::float AS "sellingPrice",
             COALESCE("costPrice", 0)::float AS "costPrice"
      FROM products
      WHERE "businessId" = ${businessId}
        AND stock > 0
        AND stock <= COALESCE("lowStockThreshold", 5)
      ORDER BY stock ASC, id ASC
      LIMIT ${LIST_CAP}
    `,
    prisma.$queryRaw`
      SELECT id, name, barcode, sku, category, stock, "lowStockThreshold",
             COALESCE("sellingPrice", price, 0)::float AS "sellingPrice",
             COALESCE("costPrice", 0)::float AS "costPrice"
      FROM products
      WHERE "businessId" = ${businessId}
        AND stock <= 0
      ORDER BY id ASC
      LIMIT ${LIST_CAP}
    `,
  ]);

  const s = summaryRows[0] || {};
  const formatRow = (p) => {
    const stock = Number(p.stock || 0);
    const threshold = Number(p.lowStockThreshold ?? 5);
    const sellingPrice = Number(p.sellingPrice || 0);
    const costPrice = Number(p.costPrice || 0);
    let stockStatus = "In Stock";
    if (stock <= 0) stockStatus = "Out of Stock";
    else if (stock <= threshold) stockStatus = "Low Stock";
    return {
      id: p.id,
      name: p.name,
      barcode: p.barcode,
      sku: p.sku,
      category: p.category || "General",
      stock,
      lowStockThreshold: threshold,
      sellingPrice,
      costPrice,
      totalRetailValue: stock * sellingPrice,
      totalCostValue: stock * costPrice,
      stockStatus,
      deficit: stock < threshold ? threshold - stock : 0,
    };
  };

  const lowStockFormatted = lowStock.map(formatRow);
  const outOfStockFormatted = outOfStock.map(formatRow);

  const payload = {
    summary: {
      totalProducts: Number(s.total_products || 0),
      totalUnits: Number(s.total_units || 0),
      totalRetailValue: Number(s.total_retail_value || 0),
      totalCostValue: Number(s.total_cost_value || 0),
      lowStockCount: Number(s.low_stock_count || 0),
      outOfStockCount: Number(s.out_of_stock_count || 0),
      healthyCount: Number(s.healthy_count || 0),
    },
    // Bounded samples — full catalog belongs on paginated GET /products or export
    inventory: [...lowStockFormatted, ...outOfStockFormatted].slice(0, LIST_CAP),
    lowStock: lowStockFormatted,
    outOfStock: outOfStockFormatted,
    meta: { durationMs: Math.round(performance.now() - startedAt), listCap: LIST_CAP },
  };

  const reportTtl = Number(process.env.REDIS_CACHE_TTL_REPORTS_MS) || 45000;
  await cacheSet(cacheKey, payload, reportTtl);
  res.setHeader("X-Cache", "MISS");
  res.json(payload);
}

module.exports = {
  getSalesReport,
  getProductReport,
  getStockReport,
};
