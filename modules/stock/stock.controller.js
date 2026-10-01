const { prisma } = require("../../db");
const { toPositiveInteger } = require("../../utils/numbers");
const { productAccessWhere } = require("../products/product-access");
const { emitBusinessEvent } = require("../realtime/socket");
const { receiveStock } = require("./stock.service");
const { toHttpError } = require("../../utils/domain-errors");
const { invalidateBusinessCaches } = require("../../utils/cache-invalidate");

async function mutateStock(req, res, quantity, note) {
  try {
    const code = String(req.body.barcode || req.body.qrCode || "").trim();
    const product = await prisma.product.findFirst({
      where: productAccessWhere(req, { OR: [{ barcode: code }, { qrCode: code }] }),
      select: { id: true, barcode: true },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    const updatedProduct = await prisma.$transaction(async (tx) => {
      const { product: updated } = await receiveStock(tx, {
        businessId: req.businessId,
        productId: product.id,
        quantity,
        note,
        userId: req.user.id,
        branchId: req.body.branchId,
        barcode: product.barcode,
      });
      return updated;
    });

    invalidateBusinessCaches(req.businessId);
    emitBusinessEvent(req.businessId, "stock.updated", updatedProduct);
    return res.json(updatedProduct);
  } catch (error) {
    const mapped = toHttpError(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    return res.status(400).json({
      message: error.message ?? "Could not update stock.",
    });
  }
}

async function receiveOne(req, res) {
  return mutateStock(req, res, 1, "Stock received (+1)");
}

async function addStock(req, res) {
  try {
    const quantity = toPositiveInteger(req.body.quantity, "Quantity");
    const note = String(req.body.note ?? "").trim() || "Stock added";
    return mutateStock(req, res, quantity, note);
  } catch (error) {
    return res.status(400).json({
      message: error.message ?? "Could not add stock.",
    });
  }
}

module.exports = { addStock, receiveOne };
