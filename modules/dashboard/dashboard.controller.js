const { prisma } = require("../../db");
const { saleResponse } = require("../../utils/serializers");
const { cacheGet, cacheSet } = require("../../utils/ttl-cache");

function getTodayRange() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return { startOfDay, endOfDay };
}

async function getAdminDashboard(req, res) {
  const startedAt = performance.now();
  const { startOfDay, endOfDay } = getTodayRange();
  const businessId = req.businessId;
  const cacheKey = `dashboard:admin:${businessId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.json(cached);
  }

  // Summary metrics + top-N only. Never embed the full catalog or huge sale history.
  const [
    recentSales,
    staffCount,
    myProductCount,
    staffProductCount,
    unassignedProductCount,
    todayAgg,
    inventoryRows,
    topSellingRaw,
    lowStockProductsRaw,
  ] = await Promise.all([
    prisma.sale.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        invoiceNumber: true,
        subtotal: true,
        discountType: true,
        discountValue: true,
        discountAmount: true,
        totalAmount: true,
        totalItems: true,
        paymentMethod: true,
        customerName: true,
        customerMobile: true,
        createdAt: true,
        userId: true,
        customerId: true,
        branchId: true,
      },
    }),
    prisma.businessMember.count({ where: { businessId, role: "staff" } }),
    prisma.product.count({ where: { businessId, createdByUserId: req.user.id } }),
    prisma.product.count({ where: { businessId, createdByUser: { role: "staff" } } }),
    prisma.product.count({ where: { businessId, createdByUserId: null } }),
    prisma.sale.aggregate({
      where: { businessId, createdAt: { gte: startOfDay, lt: endOfDay } },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(stock * COALESCE("sellingPrice", price, 0)), 0)::float AS inventory_value,
        COUNT(*) FILTER (
          WHERE stock <= COALESCE("lowStockThreshold", 5)
        )::int AS low_stock
      FROM products
      WHERE "businessId" = ${businessId}
    `,
    prisma.saleItem.groupBy({
      by: ["productId", "name"],
      where: { sale: { businessId } },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    prisma.$queryRaw`
      SELECT id, name, barcode, stock, "lowStockThreshold", "sellingPrice", price, category
      FROM products
      WHERE "businessId" = ${businessId}
        AND stock <= COALESCE("lowStockThreshold", 5)
      ORDER BY stock ASC
      LIMIT 10
    `,
  ]);

  const todaySales = Number(todayAgg._sum?.totalAmount || 0);
  const todayBills = Number(todayAgg._count?.id || 0);
  const inventoryValue = Number(inventoryRows[0]?.inventory_value || 0);
  const lowStockCount = Number(inventoryRows[0]?.low_stock || 0);

  const topProductIds = topSellingRaw.map((item) => item.productId).filter(Boolean);
  const topProducts = topProductIds.length
    ? await prisma.product.findMany({
        where: { businessId, id: { in: topProductIds } },
        select: { id: true, stock: true, sellingPrice: true, price: true, category: true, imageUrl: true },
      })
    : [];
  const topProductsById = new Map(topProducts.map((product) => [product.id, product]));

  // Tiny stand-in so older clients can still derive inventory value + low-stock count
  // without receiving thousands of product rows.
  const productsForUi = [
    {
      sellingPrice: inventoryValue,
      price: inventoryValue,
      stock: 1,
      lowStockThreshold: 0,
    },
    ...(lowStockCount > 0
      ? [
          {
            sellingPrice: 0,
            price: 0,
            stock: 0,
            lowStockThreshold: 5,
            _lowStockCount: lowStockCount,
          },
        ]
      : []),
  ];

  const topSellingProducts = topSellingRaw.map((item) => {
    const prod = topProductsById.get(item.productId);
    return {
      productId: item.productId,
      name: item.name,
      quantitySold: item._sum.quantity || 0,
      totalRevenue: item._sum.total || 0,
      currentStock: prod ? prod.stock : 0,
      price: prod ? prod.sellingPrice || prod.price : 0,
      category: prod?.category || "General",
      imageUrl: prod?.imageUrl || null,
    };
  });

  const lowStockProducts = lowStockProductsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    stock: p.stock,
    lowStockThreshold: p.lowStockThreshold,
    price: p.sellingPrice || p.price,
    category: p.category || "General",
  }));

  const payload = {
    productBreakdown: {
      myProducts: myProductCount,
      staffProducts: staffProductCount,
      unassignedProducts: unassignedProductCount,
    },
    products: productsForUi,
    sales: recentSales.map(saleResponse),
    staffCount,
    todaySales,
    todayBills,
    topSellingProducts,
    lowStockProducts,
    lowStockCount,
    inventoryValue,
    meta: {
      durationMs: Math.round(performance.now() - startedAt),
      cachedForMs: 20000,
    },
  };

  cacheSet(cacheKey, payload, 20000);
  res.setHeader("X-Cache", "MISS");
  res.json(payload);
}

async function getMyDashboard(req, res) {
  const startedAt = performance.now();
  const { startOfDay, endOfDay } = getTodayRange();
  const businessId = req.businessId;
  const cacheKey = `dashboard:my:${businessId}:${req.user.id}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.json(cached);
  }

  const [sales, todayAgg, topSellingRaw, lowStockProductsRaw] = await Promise.all([
    prisma.sale.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      where: { businessId, userId: req.user.id },
      select: {
        id: true,
        invoiceNumber: true,
        subtotal: true,
        discountType: true,
        discountValue: true,
        discountAmount: true,
        totalAmount: true,
        totalItems: true,
        paymentMethod: true,
        customerName: true,
        customerMobile: true,
        createdAt: true,
        userId: true,
        customerId: true,
        branchId: true,
      },
    }),
    prisma.sale.aggregate({
      where: {
        businessId,
        userId: req.user.id,
        createdAt: { gte: startOfDay, lt: endOfDay },
      },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
    prisma.saleItem.groupBy({
      by: ["productId", "name"],
      where: { sale: { businessId, userId: req.user.id } },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    prisma.$queryRaw`
      SELECT id, name, barcode, stock, "lowStockThreshold", "sellingPrice", price, category
      FROM products
      WHERE "businessId" = ${businessId}
        AND stock <= COALESCE("lowStockThreshold", 5)
      ORDER BY stock ASC
      LIMIT 10
    `,
  ]);

  const todaySales = Number(todayAgg._sum?.totalAmount || 0);
  const todayBills = Number(todayAgg._count?.id || 0);

  const topProductIds = topSellingRaw.map((item) => item.productId).filter(Boolean);
  const topProducts = topProductIds.length
    ? await prisma.product.findMany({
        where: { businessId, id: { in: topProductIds } },
        select: { id: true, stock: true, sellingPrice: true, price: true, category: true, imageUrl: true },
      })
    : [];
  const topProductsById = new Map(topProducts.map((p) => [p.id, p]));

  const topSellingProducts = topSellingRaw.map((item) => {
    const prod = topProductsById.get(item.productId);
    return {
      productId: item.productId,
      name: item.name,
      quantitySold: item._sum.quantity || 0,
      totalRevenue: item._sum.total || 0,
      currentStock: prod ? prod.stock : 0,
      price: prod ? prod.sellingPrice || prod.price : 0,
      category: prod?.category || "General",
      imageUrl: prod?.imageUrl || null,
    };
  });

  const lowStockProducts = lowStockProductsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    stock: p.stock,
    lowStockThreshold: p.lowStockThreshold,
    price: p.sellingPrice || p.price,
    category: p.category || "General",
  }));

  const payload = {
    sales: sales.map(saleResponse),
    todaySales,
    todayBills,
    topSellingProducts,
    lowStockProducts,
    meta: {
      durationMs: Math.round(performance.now() - startedAt),
      cachedForMs: 20000,
    },
  };

  cacheSet(cacheKey, payload, 20000);
  res.setHeader("X-Cache", "MISS");
  res.json(payload);
}

module.exports = { getAdminDashboard, getMyDashboard };
