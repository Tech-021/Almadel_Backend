const { prisma } = require("../../db");
const { saleResponse } = require("../../utils/serializers");

function getTodayRange() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return { startOfDay, endOfDay };
}

async function getAdminDashboard(req, res) {
  const { startOfDay, endOfDay } = getTodayRange();
  const businessId = req.businessId;

  // Do NOT return the full product table here. At 10k rows the JSON is ~3.5MB and the
  // Vercel UI freezes on "Refreshing…" with zeros / an empty products grid.
  // Keep a tiny products stand-in so the existing client still derives inventory + low stock.
  const [
    sales,
    staffCount,
    myProductCount,
    staffProductCount,
    unassignedProductCount,
    todaySalesData,
    inventoryRows,
    topSellingRaw,
  ] = await Promise.all([
    prisma.sale.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.businessMember.count({ where: { businessId, role: "staff" } }),
    prisma.product.count({ where: { businessId, createdByUserId: req.user.id } }),
    prisma.product.count({ where: { businessId, createdByUser: { role: "staff" } } }),
    prisma.product.count({ where: { businessId, createdByUserId: null } }),
    prisma.sale.findMany({
      where: {
        businessId,
        createdAt: { gte: startOfDay, lt: endOfDay },
      },
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
      where: {
        sale: { businessId },
      },
      _sum: {
        quantity: true,
        total: true,
      },
      orderBy: {
        _sum: {
          quantity: "desc",
        },
      },
      take: 6,
    }),
  ]);

  const todaySales = todaySalesData.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
  const todayBills = todaySalesData.length;
  const inventoryValue = Number(inventoryRows[0]?.inventory_value || 0);
  const lowStockCount = Number(inventoryRows[0]?.low_stock || 0);

  const topProductIds = topSellingRaw.map((item) => item.productId).filter(Boolean);
  const [topProducts, lowStockProductsRaw] = await Promise.all([
    topProductIds.length
      ? prisma.product.findMany({
          where: { businessId, id: { in: topProductIds } },
          select: { id: true, stock: true, sellingPrice: true, price: true, category: true, imageUrl: true },
        })
      : Promise.resolve([]),
    prisma.$queryRaw`
      SELECT id, name, barcode, stock, "lowStockThreshold", "sellingPrice", price, category
      FROM products
      WHERE "businessId" = ${businessId}
        AND stock <= COALESCE("lowStockThreshold", 5)
      ORDER BY stock ASC
      LIMIT 50
    `,
  ]);
  const topProductsById = new Map(topProducts.map((product) => [product.id, product]));

  const productsForUi = [
    {
      sellingPrice: inventoryValue,
      price: inventoryValue,
      stock: 1,
      // Must stay above threshold so this inventory stand-in is not counted as low stock.
      lowStockThreshold: 0,
    },
    ...Array.from({ length: Math.min(lowStockCount, 500) }, () => ({
      sellingPrice: 0,
      price: 0,
      stock: 0,
      lowStockThreshold: 5,
    })),
  ];

  const topSellingProducts = topSellingRaw.map((item) => {
    const prod = topProductsById.get(item.productId);
    return {
      productId: item.productId,
      name: item.name,
      quantitySold: item._sum.quantity || 0,
      totalRevenue: item._sum.total || 0,
      currentStock: prod ? prod.stock : 0,
      price: prod ? (prod.sellingPrice || prod.price) : 0,
      category: prod?.category || "General",
      imageUrl: prod?.imageUrl || null,
    };
  });

  const lowStockProducts = lowStockProductsRaw
    .map((p) => ({
      id: p.id,
      name: p.name,
      barcode: p.barcode,
      stock: p.stock,
      lowStockThreshold: p.lowStockThreshold,
      price: p.sellingPrice || p.price,
      category: p.category || "General",
    }));

  res.json({
    productBreakdown: {
      myProducts: myProductCount,
      staffProducts: staffProductCount,
      unassignedProducts: unassignedProductCount,
    },
    products: productsForUi,
    sales: sales.map(saleResponse),
    staffCount,
    todaySales,
    todayBills,
    topSellingProducts,
    lowStockProducts,
  });
}

async function getMyDashboard(req, res) {
  const { startOfDay, endOfDay } = getTodayRange();
  const businessId = req.businessId;
  
  const [sales, todaySalesData, products, topSellingRaw] = await Promise.all([
    prisma.sale.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      where: { businessId, userId: req.user.id },
    }),
    prisma.sale.findMany({
      where: {
        businessId,
        userId: req.user.id,
        createdAt: { gte: startOfDay, lt: endOfDay },
      },
    }),
    prisma.product.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
    prisma.saleItem.groupBy({
      by: ["productId", "name"],
      where: {
        sale: { businessId, userId: req.user.id },
      },
      _sum: {
        quantity: true,
        total: true,
      },
      orderBy: {
        _sum: {
          quantity: "desc",
        },
      },
      take: 6,
    }),
  ]);

  const todaySales = todaySalesData.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
  const todayBills = todaySalesData.length;

  const topSellingProducts = topSellingRaw.map((item) => {
    const prod = products.find((p) => p.id === item.productId);
    return {
      productId: item.productId,
      name: item.name,
      quantitySold: item._sum.quantity || 0,
      totalRevenue: item._sum.total || 0,
      currentStock: prod ? prod.stock : 0,
      price: prod ? (prod.sellingPrice || prod.price) : 0,
      category: prod?.category || "General",
      imageUrl: prod?.imageUrl || null,
    };
  });

  const lowStockProducts = products
    .filter((p) => Number(p.stock ?? 0) <= Number(p.lowStockThreshold ?? 5))
    .map((p) => ({
      id: p.id,
      name: p.name,
      barcode: p.barcode,
      stock: p.stock,
      lowStockThreshold: p.lowStockThreshold,
      price: p.sellingPrice || p.price,
      category: p.category || "General",
    }));

  res.json({ 
    sales: sales.map(saleResponse),
    todaySales,
    todayBills,
    topSellingProducts,
    lowStockProducts,
  });
}

module.exports = { getAdminDashboard, getMyDashboard };
