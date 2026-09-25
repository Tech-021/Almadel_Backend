const { prisma } = require("../../db");
const { toPositiveInteger } = require("../../utils/numbers");
const { productAccessWhere } = require("../products/product-access");
const { emitBusinessEvent } = require("../realtime/socket");

async function receiveOne(req, res) {
  try {
    const code = String(req.body.barcode || req.body.qrCode || "").trim();
    const product = await prisma.product.findFirst({
      where: productAccessWhere(req, { OR: [{ barcode: code }, { qrCode: code }] }),
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    const updatedProduct = await prisma.product.update({
      data: { stock: { increment: 1 } },
      where: { id: product.id },
    });

    emitBusinessEvent(req.businessId, "stock.updated", updatedProduct);
    return res.json(updatedProduct);
  } catch (error) {
    return res.status(400).json({
      message: error.message ?? "Could not update stock.",
    });
  }
}

async function addStock(req, res) {
  try {
    const code = String(req.body.barcode || req.body.qrCode || "").trim();
    const quantity = toPositiveInteger(req.body.quantity, "Quantity");
    const note = String(req.body.note ?? "").trim();
    const product = await prisma.product.findFirst({
      where: productAccessWhere(req, { OR: [{ barcode: code }, { qrCode: code }] }),
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    const updatedProduct = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        data: { stock: { increment: quantity } },
        where: { id: product.id },
      });

      let branchId = req.body.branchId ? Number(req.body.branchId) : null;
      if (!branchId && req.businessId && tx.branch) {
        try {
          const mainBranch = await tx.branch.findFirst({
            where: { businessId: req.businessId, isMain: true },
            select: { id: true },
          });
          if (mainBranch) branchId = mainBranch.id;
        } catch (_) {}
      }

      await tx.stockLog.create({
        data: {
          barcode: product.barcode,
          businessId: req.businessId,
          branchId: branchId || undefined,
          newStock: updated.stock,
          note: note || "Stock added",
          previousStock: product.stock,
          productId: product.id,
          quantity,
          userId: req.user.id,
        },
      });

      return updated;
    });

    emitBusinessEvent(req.businessId, "stock.updated", updatedProduct);
    return res.json(updatedProduct);
  } catch (error) {
    return res.status(400).json({
      message: error.message ?? "Could not add stock.",
    });
  }
}

module.exports = { addStock, receiveOne };

