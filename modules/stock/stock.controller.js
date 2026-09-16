const { prisma } = require("../../db");
const { toPositiveInteger } = require("../../utils/numbers");
const { productAccessWhere } = require("../products/product-access");

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

      await tx.stockLog.create({
        data: {
          barcode: product.barcode,
          businessId: req.businessId,
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

    return res.json(updatedProduct);
  } catch (error) {
    return res.status(400).json({
      message: error.message ?? "Could not add stock.",
    });
  }
}

module.exports = { addStock, receiveOne };