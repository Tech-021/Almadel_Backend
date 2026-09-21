const { prisma } = require("../../db");
const { invoiceResponse } = require("../../utils/serializers");
const { createSale } = require("./checkout.service");
const { emitBusinessEvent } = require("../realtime/socket");

async function checkout(req, res) {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (items.length === 0) {
      return res.status(400).json({ message: "Cart is empty." });
    }

    const sale = await prisma.$transaction((tx) =>
      createSale(tx, { ...req.user, businessId: req.businessId }, items, req.body),
    );

    emitBusinessEvent(req.businessId, "sale.created", invoiceResponse(sale));
    return res.status(201).json(invoiceResponse(sale));
  } catch (error) {
    return res.status(400).json({
      message: error.message ?? "Could not complete sale.",
    });
  }
}

async function getInvoice(req, res) {
  const saleId = Number(req.params.saleId);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    return res.status(400).json({ message: "Invalid invoice." });
  }

  const sale = await prisma.sale.findFirst({
    include: { items: true, user: true },
    where: {
      id: saleId,
      businessId: req.businessId,
      ...(req.user.role === "admin" ? {} : { userId: req.user.id }),
    },
  });

  if (!sale) return res.status(404).json({ message: "Invoice not found." });
  return res.json(invoiceResponse(sale));
}

async function listSales(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const where = { businessId: req.businessId };
  const [sales, total] = await Promise.all([
    prisma.sale.findMany({ where, include: { customer: { select: { name: true, mobile: true } }, user: { select: { fullName: true, email: true } }, items: { select: { quantity: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.sale.count({ where }),
  ]);
  return res.json({ sales: sales.map((sale) => ({ ...sale, itemCount: sale.items.reduce((sum, item) => sum + item.quantity, 0) })), total, page, limit });
}

module.exports = { checkout, getInvoice, listSales };


