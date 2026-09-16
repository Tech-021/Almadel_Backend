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
  
  const [
    products,
    sales,
    staffCount,
    myProductCount,
    staffProductCount,
    unassignedProductCount,
    todaySalesData,
  ] = await Promise.all([
    prisma.product.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
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
  ]);

  const todaySales = todaySalesData.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
  const todayBills = todaySalesData.length;

  res.json({
    productBreakdown: {
      myProducts: myProductCount,
      staffProducts: staffProductCount,
      unassignedProducts: unassignedProductCount,
    },
    products,
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