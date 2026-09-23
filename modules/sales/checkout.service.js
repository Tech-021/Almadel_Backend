const { randomBytes } = require("node:crypto");

const { toPositiveInteger } = require("../../utils/numbers");
const { productAccessWhere } = require("../products/product-access");

const DISCOUNT_TYPES = new Set(["none", "fixed", "percentage"]);
const PAYMENT_METHODS = new Set(["cash", "online"]);

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeCheckoutDetails(body) {
  const customerName = String(body.customerName ?? "").trim();
  const customerMobile = String(body.customerMobile ?? "").trim();
  const discountType = String(body.discountType ?? "none").toLowerCase();
  const discountValue = Number(body.discountValue ?? 0);
  const paymentMethod = String(body.paymentMethod ?? "cash").toLowerCase();

  if (!DISCOUNT_TYPES.has(discountType)) {
    throw new Error("Select a valid discount type.");
  }
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new Error("Select a valid payment method.");
  }
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new Error("Discount must be zero or greater.");
  }
  if (discountType === "percentage" && discountValue > 100) {
    throw new Error("Percentage discount cannot exceed 100%.");
  }
  if (customerName.length > 100) {
    throw new Error("Customer name is too long.");
  }
  if (customerMobile.length > 30) {
    throw new Error("Customer mobile number is too long.");
  }

  return {
    customerMobile: customerMobile || null,
    customerName: customerName || null,
    discountType,
    discountValue: discountType === "none" ? 0 : roundMoney(discountValue),
    paymentMethod,
  };
}

function calculateTotals(subtotal, discountType, discountValue) {
  let discountAmount = 0;

  if (discountType === "fixed") {
    if (discountValue > subtotal) {
      throw new Error("Fixed discount cannot exceed the subtotal.");
    }
    discountAmount = discountValue;
  } else if (discountType === "percentage") {
    discountAmount = subtotal * (discountValue / 100);
  }

  return {
    discountAmount: roundMoney(discountAmount),
    totalAmount: roundMoney(Math.max(0, subtotal - discountAmount)),
  };
}

function createInvoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `ALM-${date}-${suffix}`;
}

async function createSale(tx, userOrReq, rawItems, rawDetails) {
  const businessId = userOrReq?.businessId;
  const userId = userOrReq?.id || userOrReq?.user?.id;
  const details = normalizeCheckoutDetails(rawDetails);
  const saleItems = [];

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("Cart is empty.");
  }

  for (const item of rawItems) {
    const productId = Number(item.productId || item.id) || null;
    const barcode = String(item.barcode ?? "").trim();
    const quantity = toPositiveInteger(item.quantity, "Quantity");

    let product = null;
    if (productId) {
      product = await tx.product.findFirst({
        where: productAccessWhere({ businessId }, { id: productId }),
      });
    }

    if (!product && barcode) {
      product = await tx.product.findFirst({
        where: productAccessWhere({ businessId }, { OR: [{ barcode }, { qrCode: barcode }] }),
      });
    }

    if (!product) {
      throw new Error(`Product not found: ${barcode || productId || "Unknown item"}`);
    }
    if (product.stock < quantity) {
      throw new Error(`Not enough stock for ${product.name} (Available: ${product.stock}, Requested: ${quantity}).`);
    }

    const price = roundMoney(product.sellingPrice || product.price);
    saleItems.push({
      barcode: product.barcode || "",
      name: product.name,
      price,
      productId: product.id,
      quantity,
      total: roundMoney(price * quantity),
    });

    const stockUpdate = await tx.product.updateMany({
      data: { stock: { decrement: quantity } },
      where: { id: product.id, stock: { gte: quantity } },
    });
    if (stockUpdate.count !== 1) {
      throw new Error(`Not enough stock for ${product.name}.`);
    }
  }

  const subtotal = roundMoney(
    saleItems.reduce((sum, item) => sum + item.total, 0),
  );

  let customerId = null;
  if (details.customerMobile) {
    let customer = await tx.customer.findFirst({
      where: { businessId, mobile: details.customerMobile },
    });
    if (!customer) {
      customer = await tx.customer.create({
        data: {
          businessId,
          name: details.customerName || "Walk-in Customer",
          mobile: details.customerMobile,
        },
      });
    }
    customerId = customer.id;
  }
  const totalItems = saleItems.reduce((sum, item) => sum + item.quantity, 0);
  const totals = calculateTotals(
    subtotal,
    details.discountType,
    details.discountValue,
  );

  const sale = await tx.sale.create({
    data: {
      ...details,
      ...totals,
      businessId,
      customerId,
      invoiceNumber: createInvoiceNumber(),
      items: { create: saleItems },
      subtotal,
      totalItems,
      userId: userId || null,
    },
    include: { items: true, user: true },
  });

  if (customerId) {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        totalSpent: { increment: totals.totalAmount },
        visitCount: { increment: 1 },
        lastVisit: new Date(),
        ...(details.paymentMethod === "credit" ? { currentBalance: { increment: totals.totalAmount } } : {}),
      },
    });
  }

  if (details.paymentMethod !== "credit") {
    const accountName = details.paymentMethod === "cash" ? "Cash in hand" : "Online / Wallet";
    const account = await tx.account.upsert({
      where: { businessId_name: { businessId, name: accountName } },
      update: {}, create: { businessId, name: accountName, type: details.paymentMethod === "cash" ? "cash" : "online" },
    });
    const payment = await tx.payment.create({
      data: { businessId, accountId: account.id, saleId: sale.id, customerId, amount: totals.totalAmount, type: "sale", method: details.paymentMethod, createdById: userId || null },
    });
    await tx.ledgerTransaction.create({
      data: { businessId, accountId: account.id, paymentId: payment.id, type: "sale", direction: "credit", amount: totals.totalAmount, reference: sale.invoiceNumber, createdById: userId || null },
    });
  }

  return sale;
}

module.exports = { calculateTotals, createSale, normalizeCheckoutDetails };
