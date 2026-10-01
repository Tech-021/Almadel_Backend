const { DomainError, INSUFFICIENT_STOCK } = require("../../utils/domain-errors");
const { resolveBusinessBranchId } = require("../branches/branch-access");

/**
 * Atomically change product stock and write a stock_log inside an existing transaction.
 * quantityDelta > 0 receive/add, < 0 sale/adjust-out.
 */
async function applyStockChange(tx, {
  businessId,
  productId,
  quantityDelta,
  note,
  userId = null,
  branchId = null,
  barcode = null,
  requireNonNegative = true,
}) {
  const delta = Number(quantityDelta);
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error("Stock quantity change must be a non-zero integer.");
  }

  const product = await tx.product.findFirst({
    where: { id: productId, businessId },
    select: { id: true, barcode: true, name: true, stock: true },
  });
  if (!product) {
    throw new DomainError("INVALID_TENANT_RESOURCE", "Product not found for this business.", 404);
  }

  let updated;
  if (delta < 0 && requireNonNegative) {
    const need = Math.abs(delta);
    const result = await tx.product.updateMany({
      where: { id: product.id, businessId, stock: { gte: need } },
      data: { stock: { decrement: need } },
    });
    if (result.count !== 1) {
      throw new DomainError(
        INSUFFICIENT_STOCK,
        `Not enough stock for ${product.name}.`,
        409,
      );
    }
    updated = await tx.product.findUnique({ where: { id: product.id } });
  } else if (delta < 0) {
    updated = await tx.product.update({
      where: { id: product.id },
      data: { stock: { decrement: Math.abs(delta) } },
    });
  } else {
    updated = await tx.product.update({
      where: { id: product.id },
      data: { stock: { increment: delta } },
    });
  }

  const previousStock = updated.stock - delta;
  const resolvedBranchId =
    branchId != null ? await resolveBusinessBranchId(tx, businessId, branchId) : null;

  const log = await tx.stockLog.create({
    data: {
      businessId,
      productId: product.id,
      barcode: barcode || product.barcode || "",
      quantity: Math.abs(delta),
      previousStock,
      newStock: updated.stock,
      note: note || (delta > 0 ? "Stock added" : "Stock reduced"),
      userId: userId || null,
      branchId: resolvedBranchId,
    },
  });

  return { product: updated, stockLog: log, previousStock, newStock: updated.stock };
}

async function receiveStock(tx, args) {
  const quantity = Number(args.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a valid whole number greater than zero.");
  }
  return applyStockChange(tx, {
    ...args,
    quantityDelta: quantity,
    note: args.note || (quantity === 1 ? "Stock received (+1)" : "Stock added"),
  });
}

module.exports = { applyStockChange, receiveStock };
