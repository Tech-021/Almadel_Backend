const { prisma } = require("../../db");
const { refundResponse } = require("../../utils/serializers");
const { createRefund } = require("./refund.service");
const { emitBusinessEvent } = require("../realtime/socket");
const { invalidateBusinessCaches } = require("../../utils/cache-invalidate");
const { toHttpError } = require("../../utils/domain-errors");

async function postRefund(req, res) {
  try {
    const refund = await prisma.$transaction((tx) =>
      createRefund(tx, { businessId: req.businessId, userId: req.user.id }, req.body),
    );
    invalidateBusinessCaches(req.businessId);
    emitBusinessEvent(req.businessId, "refund.created", refundResponse(refund));
    return res.status(201).json({ refund: refundResponse(refund) });
  } catch (error) {
    const mapped = toHttpError(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    return res.status(400).json({ message: error.message ?? "Could not process refund." });
  }
}

async function listRefunds(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const saleId = Number(req.query.saleId);
  const where = {
    businessId: req.businessId,
    ...(Number.isInteger(saleId) && saleId > 0 ? { saleId } : {}),
  };

  const [refunds, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      include: {
        sale: { select: { invoiceNumber: true, customerName: true, customerMobile: true } },
        user: { select: { fullName: true, email: true } },
        items: { select: { quantity: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.refund.count({ where }),
  ]);

  return res.json({
    refunds: refunds.map((row) => ({
      ...refundResponse(row),
      itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    })),
    total,
    page,
    limit,
  });
}

async function getRefund(req, res) {
  const id = Number(req.params.refundId);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid refund." });
  }

  const refund = await prisma.refund.findFirst({
    where: { id, businessId: req.businessId },
    include: {
      items: true,
      sale: { select: { invoiceNumber: true, customerName: true, customerMobile: true, totalAmount: true } },
      user: { select: { fullName: true, email: true } },
    },
  });

  if (!refund) {
    return res.status(404).json({ message: "Refund not found." });
  }

  return res.json({ refund: refundResponse(refund) });
}

module.exports = { postRefund, listRefunds, getRefund };
