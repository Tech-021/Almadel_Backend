const { prisma } = require("../../db");
const { saleResponse } = require("../../utils/serializers");

function getTodayRange() {
  const now = new Date();
  // Use UTC to match database storage
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
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
  ]);

  const todaySales = todaySalesData.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
  const todayBills = todaySalesData.length;
  const inventoryValue = Number(inventoryRows[0]?.inventory_value || 0);
  const lowStockCount = Number(inventoryRows[0]?.low_stock || 0);

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
  });
}

async function getMyDashboard(req, res) {
  const { startOfDay, endOfDay } = getTodayRange();
  const businessId = req.businessId;
  
  const [sales, todaySalesData] = await Promise.all([
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
  ]);

  const todaySales = todaySalesData.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
  const todayBills = todaySalesData.length;

  res.json({ 
    sales: sales.map(saleResponse),
    todaySales,
    todayBills,
  });
}

module.exports = { getAdminDashboard, getMyDashboard };