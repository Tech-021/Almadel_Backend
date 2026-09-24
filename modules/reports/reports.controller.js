const { prisma } = require("../../db");

function getDayBounds(dateObj = new Date()) {
  const start = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);
  const end = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 23, 59, 59, 999);
  return { start, end };
}

// 1. SALES REPORT (Daily, Weekly, Monthly)
async function getSalesReport(req, res) {
  const businessId = req.businessId;
  const period = String(req.query.period || "daily").toLowerCase(); // "daily" | "weekly" | "monthly"
  const now = new Date();

  let startDate, endDate;
  let breakdown = [];

  if (period === "daily") {
    // Single day (today or requested date)
    const targetDate = req.query.date ? new Date(req.query.date) : now;
    const bounds = getDayBounds(targetDate);
    startDate = bounds.start;
    endDate = bounds.end;
  } else if (period === "weekly") {
    // Last 7 days
    const endBounds = getDayBounds(now);
    endDate = endBounds.end;
    const startBounds = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    startDate = startBounds;
  } else {
    // Monthly (Last 30 days)
    const endBounds = getDayBounds(now);
    endDate = endBounds.end;
    const startBounds = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    startDate = startBounds;
  }

  const sales = await prisma.sale.findMany({
    where: {
      businessId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          mobile: true,
        },
      },
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const totalRevenue = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
  const totalOrders = sales.length;
  const totalItems = sales.reduce((sum, s) => sum + (s.totalItems || 0), 0);
  const totalDiscounts = sales.reduce((sum, s) => sum + (s.discountAmount || 0), 0);
  const averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const cashTotal = sales
    .filter((s) => (s.paymentMethod || "cash").toLowerCase() === "cash")
    .reduce((sum, s) => sum + (s.totalAmount || 0), 0);

  const onlineTotal = sales
    .filter((s) => (s.paymentMethod || "").toLowerCase() !== "cash")
    .reduce((sum, s) => sum + (s.totalAmount || 0), 0);

  // Group by day for weekly/monthly breakdown
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

    for (const s of sales) {
      const key = new Date(s.createdAt).toISOString().slice(0, 10);
      if (dayMap.has(key)) {
        const item = dayMap.get(key);
        item.orders += 1;
        item.totalAmount += s.totalAmount || 0;
        item.totalItems += s.totalItems || 0;
        item.discounts += s.discountAmount || 0;
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
      totalOrders,
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
  });
}

// 2. PRODUCT REPORT (Best Selling & Least Selling Products)
async function getProductReport(req, res) {
  const businessId = req.businessId;

  const [products, itemSales] = await Promise.all([
    prisma.product.findMany({
      where: { businessId },
      orderBy: { name: "asc" },
    }),
    prisma.saleItem.groupBy({
      by: ["productId"],
      where: {
        sale: { businessId },
      },
      _sum: {
        quantity: true,
        total: true,
      },
    }),
  ]);

  const salesMap = new Map();
  for (const item of itemSales) {
    salesMap.set(item.productId, {
      quantitySold: item._sum.quantity || 0,
      totalRevenue: item._sum.total || 0,
    });
  }

  const enrichedProducts = products.map((p) => {
    const saleData = salesMap.get(p.id) || { quantitySold: 0, totalRevenue: 0 };
    const price = Number(p.sellingPrice || p.price || 0);
    const cost = Number(p.costPrice || 0);
    const stock = Number(p.stock || 0);
    const tiedUpCapital = stock * (cost > 0 ? cost : price);

    return {
      id: p.id,
      name: p.name,
      barcode: p.barcode,
      sku: p.sku,
      category: p.category || "General",
      sellingPrice: price,
      costPrice: cost,
      stock,
      lowStockThreshold: p.lowStockThreshold || 5,
      quantitySold: saleData.quantitySold,
      totalRevenue: saleData.totalRevenue,
      tiedUpCapital,
      hasSales: saleData.quantitySold > 0,
      status:
        saleData.quantitySold === 0
          ? "Dead Stock (0 Sales)"
          : saleData.quantitySold <= 2
          ? "Slow Moving"
          : "Active Seller",
    };
  });

  // Best Selling Products (Descending by units sold, then revenue)
  const bestSelling = [...enrichedProducts]
    .filter((p) => p.quantitySold > 0)
    .sort((a, b) => b.quantitySold - a.quantitySold || b.totalRevenue - a.totalRevenue);

  // Least Selling Products (Ascending by units sold, including 0 sales)
  const leastSelling = [...enrichedProducts].sort(
    (a, b) => a.quantitySold - b.quantitySold || b.stock - a.stock
  );

  const totalCatalogProducts = products.length;
  const productsWithSales = bestSelling.length;
  const zeroSalesProducts = totalCatalogProducts - productsWithSales;
  const totalUnitsSold = enrichedProducts.reduce((sum, p) => sum + p.quantitySold, 0);
  const totalSalesRevenue = enrichedProducts.reduce((sum, p) => sum + p.totalRevenue, 0);

  res.json({
    summary: {
      totalCatalogProducts,
      productsWithSales,
      zeroSalesProducts,
      totalUnitsSold,
      totalSalesRevenue,
    },
    bestSelling,
    leastSelling,
  });
}

// 3. STOCK REPORT (Current Inventory, Low Stock, Out of Stock)
async function getStockReport(req, res) {
  const businessId = req.businessId;

  const products = await prisma.product.findMany({
    where: { businessId },
    orderBy: { name: "asc" },
  });

  const formattedInventory = products.map((p) => {
    const stock = Number(p.stock || 0);
    const threshold = Number(p.lowStockThreshold ?? 5);
    const sellingPrice = Number(p.sellingPrice || p.price || 0);
    const costPrice = Number(p.costPrice || 0);
    const totalRetailValue = stock * sellingPrice;
    const totalCostValue = stock * costPrice;

    let stockStatus = "In Stock";
    if (stock <= 0) {
      stockStatus = "Out of Stock";
    } else if (stock <= threshold) {
      stockStatus = "Low Stock";
    }

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
      totalRetailValue,
      totalCostValue,
      stockStatus,
      deficit: stock < threshold ? threshold - stock : 0,
    };
  });

  const lowStock = formattedInventory.filter((p) => p.stock > 0 && p.stock <= p.lowStockThreshold);
  const outOfStock = formattedInventory.filter((p) => p.stock <= 0);
  const healthyInventory = formattedInventory.filter((p) => p.stock > p.lowStockThreshold);

  const totalUnits = formattedInventory.reduce((sum, p) => sum + Math.max(0, p.stock), 0);
  const totalRetailValue = formattedInventory.reduce((sum, p) => sum + Math.max(0, p.totalRetailValue), 0);
  const totalCostValue = formattedInventory.reduce((sum, p) => sum + Math.max(0, p.totalCostValue), 0);

  res.json({
    summary: {
      totalProducts: formattedInventory.length,
      totalUnits,
      totalRetailValue,
      totalCostValue,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      healthyCount: healthyInventory.length,
    },
    inventory: formattedInventory,
    lowStock,
    outOfStock,
  });
}

module.exports = {
  getSalesReport,
  getProductReport,
  getStockReport,
};
