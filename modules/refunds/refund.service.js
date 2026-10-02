const { randomBytes } = require("node:crypto");

const { toPositiveInteger } = require("../../utils/numbers");
const {
  money,
  mulMoney,
  divMoney,
  roundMoney,
  toMoneyDecimal,
} = require("../../utils/money");
const { applyStockChange } = require("../stock/stock.service");
const { assertRegisterOpenForCheckout } = require("../finance/register.service");
const { ensureSaleAccount } = require("../sales/checkout.service");

function createRefundNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `REF-${date}-${suffix}`;
}

function refundableQuantity(saleItem) {
  const sold = Number(saleItem.quantity) || 0;
  const refunded = Number(saleItem.refundedQuantity) || 0;
  return Math.max(0, sold - refunded);
}

function refundAmountForLine(saleItem, quantity) {
  const qty = Number(saleItem.quantity) || 1;
  const lineTotal = money(saleItem.total);
  const unit = divMoney(lineTotal, qty);
  return roundMoney(mulMoney(unit, quantity));
}

function normalizeRefundItems(rawItems, saleItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("Select at least one item to refund.");
  }

  const byId = new Map(saleItems.map((row) => [row.id, row]));
  const lines = [];

  for (const raw of rawItems) {
    const saleItemId = Number(raw.saleItemId);
    const quantity = toPositiveInteger(raw.quantity, "Refund quantity");
    const saleItem = byId.get(saleItemId);
    if (!saleItem) {
      throw new Error("Invoice line not found for this sale.");
    }

    const remaining = refundableQuantity(saleItem);
    if (quantity > remaining) {
      throw new Error(
        `Cannot refund ${quantity} of ${saleItem.name}. Only ${remaining} left on this invoice.`,
      );
    }

    const total = refundAmountForLine(saleItem, quantity);
    lines.push({
      saleItem,
      saleItemId,
      productId: saleItem.productId,
      barcode: saleItem.barcode,
      name: saleItem.name,
      quantity,
      unitAmount: divMoney(money(saleItem.total), saleItem.quantity),
      total,
    });
  }

  return lines;
}

async function createRefund(tx, ctx, payload) {
  const { businessId, userId } = ctx;
  const saleId = Number(payload.saleId);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new Error("Select a valid invoice to refund.");
  }

  const reason = String(payload.reason ?? "").trim().slice(0, 500) || null;

  const sale = await tx.sale.findFirst({
    where: { id: saleId, businessId },
    include: { items: true },
  });
  if (!sale) {
    throw new Error("Invoice not found.");
  }

  const lines = normalizeRefundItems(payload.items, sale.items);
  const totalAmount = roundMoney(lines.reduce((sum, line) => money(sum).add(line.total), money(0)));
  if (totalAmount.lte(0)) {
    throw new Error("Refund total must be greater than zero.");
  }

  const alreadyRefunded = money(sale.refundedAmount ?? 0);
  const saleTotal = money(sale.totalAmount);
  if (alreadyRefunded.add(totalAmount).gt(saleTotal)) {
    throw new Error("Refund would exceed the invoice total.");
  }

  await assertRegisterOpenForCheckout(tx, businessId, new Date());

  const paymentMethod = sale.paymentMethod === "online" ? "online" : "cash";
  const branchId = sale.branchId;

  for (const line of lines) {
    await applyStockChange(tx, {
      businessId,
      productId: line.productId,
      quantityDelta: line.quantity,
      note: `REFUND ${sale.invoiceNumber}`,
      userId: userId || null,
      branchId,
      barcode: line.barcode,
    });
  }

  const refund = await tx.refund.create({
    data: {
      businessId,
      saleId: sale.id,
      refundNumber: createRefundNumber(),
      totalAmount: toMoneyDecimal(totalAmount),
      reason,
      paymentMethod,
      userId: userId || null,
      branchId,
      items: {
        create: lines.map((line) => ({
          saleItemId: line.saleItemId,
          productId: line.productId,
          barcode: line.barcode,
          name: line.name,
          quantity: line.quantity,
          unitAmount: toMoneyDecimal(line.unitAmount),
          total: toMoneyDecimal(line.total),
        })),
      },
    },
    include: {
      items: true,
      sale: { select: { invoiceNumber: true, customerName: true, customerMobile: true } },
      user: { select: { fullName: true, email: true } },
    },
  });

  for (const line of lines) {
    await tx.saleItem.update({
      where: { id: line.saleItemId },
      data: { refundedQuantity: { increment: line.quantity } },
    });
  }

  await tx.sale.update({
    where: { id: sale.id },
    data: { refundedAmount: { increment: toMoneyDecimal(totalAmount) } },
  });

  if (sale.customerId) {
    await tx.customer.update({
      where: { id: sale.customerId },
      data: {
        totalSpent: { decrement: toMoneyDecimal(totalAmount) },
      },
    });
  }

  const account = await ensureSaleAccount(tx, businessId, paymentMethod);
  const payment = await tx.payment.create({
    data: {
      businessId,
      accountId: account.id,
      saleId: sale.id,
      customerId: sale.customerId,
      amount: toMoneyDecimal(totalAmount),
      type: "refund",
      method: paymentMethod,
      reference: refund.refundNumber,
      createdById: userId || null,
    },
  });

  await tx.ledgerTransaction.create({
    data: {
      businessId,
      accountId: account.id,
      paymentId: payment.id,
      type: "refund",
      direction: "debit",
      amount: toMoneyDecimal(totalAmount),
      reference: `${sale.invoiceNumber} / ${refund.refundNumber}`,
      createdById: userId || null,
    },
  });

  return refund;
}

module.exports = {
  createRefund,
  refundableQuantity,
  refundAmountForLine,
};
