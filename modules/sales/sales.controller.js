const { prisma } = require("../../db");
const { invoiceResponse } = require("../../utils/serializers");
const { createSale } = require("./checkout.service");

async function checkout(req, res) {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (items.length === 0) {
      return res.status(400).json({ message: "Cart is empty." });
    }

    const sale = await prisma.$transaction((tx) =>
      createSale(tx, req.user, items, req.body),
    );

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
      ...(req.user.role === "admin" ? {} : { userId: req.user.id }),
    },
  });

  if (!sale) return res.status(404).json({ message: "Invoice not found." });
  return res.json(invoiceResponse(sale));
}

module.exports = { checkout, getInvoice };