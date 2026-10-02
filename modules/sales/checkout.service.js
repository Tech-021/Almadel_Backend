const { randomBytes } = require("node:crypto");

const { toPositiveInteger } = require("../../utils/numbers");
const {
  roundMoney,
  mulMoney,
  pctOf,
  minMoney,
  maxMoney,
  toMoneyDecimal,
  toMoneyNumber,
  money,
} = require("../../utils/money");
const {
  DomainError,
  INSUFFICIENT_STOCK,
} = require("../../utils/domain-errors");
const { productAccessWhere } = require("../products/product-access");
const { resolveBusinessBranchId } = require("../branches/branch-access");
const { assertRegisterOpenForCheckout } = require("../finance/register.service");
const { applyStockChange } = require("../stock/stock.service");

const DISCOUNT_TYPES = new Set(["none", "fixed", "percentage"]);
const PAYMENT_METHODS = new Set(["cash", "online"]);

class DuplicateOfflineSaleError extends Error {
  constructor(invoiceNumber, businessId) {
    super("Offline sale invoice already exists.");
    this.name = "DuplicateOfflineSaleError";
    this.code = "DUPLICATE_OFFLINE_SALE";
    this.invoiceNumber = invoiceNumber;
    this.businessId = businessId;
  }
}

function normalizeCheckoutDetails(body) {
  const customerName = String(body.customerName ?? "").trim();
  const customerMobile = String(body.customerMobile ?? "").trim();
  const discountType = String(body.discountType ?? "none").toLowerCase();
  const discountValue = money(body.discountValue ?? 0);
  const paymentMethod = String(body.paymentMethod ?? "cash").toLowerCase();

  if (!DISCOUNT_TYPES.has(discountType)) {
    throw new Error("Select a valid discount type.");
  }
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new Error("Select a valid payment method.");
  }
  if (discountValue.lt(0)) {
    throw new Error("Discount must be zero or greater.");
  }
  if (discountType === "percentage" && discountValue.gt(100)) {
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
    discountValue: discountType === "none" ? toMoneyDecimal(0) : roundMoney(discountValue),
    paymentMethod,
  };
}

function calculateTotals(grossSubtotal, cartDiscountTypeOrItemDiscount, cartDiscountValueOrType, maybeDiscountValue) {
  const gross = money(grossSubtotal);

  // Overload A (checkout): (gross, itemDiscountAmount, cartDiscountType, cartDiscountValue)
  // Overload B (legacy): (gross, discountType, discountValue)
  const usesItemDiscountPath =
    arguments.length >= 4 ||
    typeof cartDiscountTypeOrItemDiscount !== "string";

  if (usesItemDiscountPath) {
    const itemDiscountAmount = money(cartDiscountTypeOrItemDiscount);
    const cartDiscountType = String(cartDiscountValueOrType || "none").toLowerCase();
    const cartDiscountValue = money(maybeDiscountValue || 0);

    let cartDiscount = money(0);
    const netBeforeCartDiscount = maxMoney(0, money(gross).sub(itemDiscountAmount));

    if (cartDiscountType === "fixed") {
      if (cartDiscountValue.gt(netBeforeCartDiscount)) {
        throw new Error("Fixed discount cannot exceed the cart total.");
      }
      cartDiscount = cartDiscountValue;
    } else if (cartDiscountType === "percentage") {
      cartDiscount = pctOf(netBeforeCartDiscount, cartDiscountValue);
    }

    const totalDiscountAmount = roundMoney(itemDiscountAmount.add(cartDiscount));
    return {
      discountAmount: totalDiscountAmount,
      totalAmount: roundMoney(maxMoney(0, money(gross).sub(totalDiscountAmount))),
    };
  }

  const discountType = String(cartDiscountTypeOrItemDiscount || "none").toLowerCase();
  const discountValue = money(cartDiscountValueOrType || 0);
  let discountAmount = money(0);

  if (discountType === "fixed") {
    if (discountValue.gt(gross)) {
      throw new Error("Fixed discount cannot exceed the subtotal.");
    }
    discountAmount = discountValue;
  } else if (discountType === "percentage") {
    discountAmount = pctOf(gross, discountValue);
  }

  return {
    discountAmount: roundMoney(discountAmount),
    totalAmount: roundMoney(maxMoney(0, money(gross).sub(discountAmount))),
  };
}

function createInvoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `ALM-${date}-${suffix}`;
}

async function findExistingOfflineSale(tx, businessId, offlineInvoiceNumber) {
  if (!offlineInvoiceNumber || !businessId) {
    return null;
  }

  return tx.sale.findFirst({
    where: { businessId, invoiceNumber: String(offlineInvoiceNumber) },
    include: { items: true, user: true },
  });
}

async function ensureSaleAccount(tx, businessId, paymentMethod) {
  const accountName = paymentMethod === "cash" ? "Cash in hand" : "Online / Wallet";
  const accountType = paymentMethod === "cash" ? "cash" : "online";

  const existing = await tx.account.findUnique({
    where: { businessId_name: { businessId, name: accountName } },
  });
  if (existing) return existing;

  let openingBalance = toMoneyDecimal(0);
  if (paymentMethod === "cash") {
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: { openingCashBalance: true },
    });
    openingBalance = toMoneyDecimal(business?.openingCashBalance ?? 0);
  }

  return tx.account.create({
    data: {
      businessId,
      name: accountName,
      type: accountType,
      openingBalance,
    },
  });
}

async function createSale(tx, userOrReq, rawItems, rawDetails) {
  const businessId = userOrReq?.businessId;
  const userId = userOrReq?.id || userOrReq?.user?.id;
  const offlineInvoiceNumber = rawDetails?.offlineInvoiceNumber
    ? String(rawDetails.offlineInvoiceNumber)
    : null;

  if (!businessId) {
    throw new DomainError("INVALID_TENANT_RESOURCE", "Business context is required.", 400);
  }

  // Idempotency first — never mutate stock if this offline invoice already exists.
  if (offlineInvoiceNumber) {
    const existing = await findExistingOfflineSale(tx, businessId, offlineInvoiceNumber);
    if (existing) {
      return existing;
    }
  }

  // Contends with closeDaily via row lock on daily_closings.
  const saleAt = rawDetails?.offlineCreatedAt ? new Date(rawDetails.offlineCreatedAt) : new Date();
  await assertRegisterOpenForCheckout(tx, businessId, saleAt);

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
      throw new DomainError(
        INSUFFICIENT_STOCK,
        `Not enough stock for ${product.name} (Available: ${product.stock}, Requested: ${quantity}).`,
        409,
      );
    }

    const price = roundMoney(product.sellingPrice || product.price);
    const itemDiscountType = String(
      item.discountType !== undefined ? item.discountType : (product.discountType || "none"),
    ).toLowerCase();
    const rawDiscountVal = money(
      item.discountValue !== undefined ? item.discountValue : (product.discountValue || 0),
    );
    const itemDiscountValue = rawDiscountVal.gte(0) ? rawDiscountVal : money(0);

    let itemDiscountAmount = money(0);
    const baseLineTotal = mulMoney(price, quantity);

    if (itemDiscountType === "fixed" && itemDiscountValue.gt(0)) {
      itemDiscountAmount = minMoney(baseLineTotal, mulMoney(itemDiscountValue, quantity));
    } else if (itemDiscountType === "percentage" && itemDiscountValue.gt(0)) {
      const pct = minMoney(100, maxMoney(0, itemDiscountValue));
      itemDiscountAmount = pctOf(baseLineTotal, pct);
    }

    const lineTotal = roundMoney(maxMoney(0, money(baseLineTotal).sub(itemDiscountAmount)));

    saleItems.push({
      barcode: product.barcode || "",
      name: product.name,
      price: toMoneyDecimal(price),
      productId: product.id,
      quantity,
      discountType: itemDiscountType,
      discountValue: toMoneyDecimal(itemDiscountValue),
      discountAmount: toMoneyDecimal(itemDiscountAmount),
      total: toMoneyDecimal(lineTotal),
    });
  }

  const grossSubtotal = roundMoney(
    saleItems.reduce((sum, item) => money(sum).add(mulMoney(item.price, item.quantity)), money(0)),
  );
  const totalItemDiscounts = roundMoney(
    saleItems.reduce((sum, item) => money(sum).add(money(item.discountAmount || 0)), money(0)),
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

  const hasAnyDiscounts =
    totalItemDiscounts.gt(0) || (details.discountType !== "none" && money(details.discountValue).gt(0));
  if (hasAnyDiscounts) {
    const biz = await tx.business.findUnique({
      where: { id: businessId },
      select: { allowDiscounts: true },
    });
    if (biz && biz.allowDiscounts === false) {
      throw new Error("Discounts are disabled for this store by the owner.");
    }
  }

  const totals = calculateTotals(
    grossSubtotal,
    totalItemDiscounts,
    details.discountType,
    details.discountValue,
  );

  const branchId = await resolveBusinessBranchId(tx, businessId, rawDetails?.branchId);

  // Decrement stock + write logs before sale create so failures roll back together.
  for (const line of saleItems) {
    await applyStockChange(tx, {
      businessId,
      productId: line.productId,
      quantityDelta: -line.quantity,
      note: `SALE`,
      userId: userId || null,
      branchId,
      barcode: line.barcode,
    });
  }

  let sale;
  try {
    sale = await tx.sale.create({
      data: {
        customerMobile: details.customerMobile,
        customerName: details.customerName,
        discountType: details.discountType,
        discountValue: toMoneyDecimal(details.discountValue),
        paymentMethod: details.paymentMethod,
        discountAmount: toMoneyDecimal(totals.discountAmount),
        totalAmount: toMoneyDecimal(totals.totalAmount),
        businessId,
        branchId,
        customerId,
        invoiceNumber: offlineInvoiceNumber || createInvoiceNumber(),
        items: {
          create: saleItems.map((line) => ({
            barcode: line.barcode,
            name: line.name,
            price: line.price,
            productId: line.productId,
            quantity: line.quantity,
            discountType: line.discountType,
            discountValue: line.discountValue,
            discountAmount: line.discountAmount,
            total: line.total,
          })),
        },
        subtotal: toMoneyDecimal(grossSubtotal),
        totalItems,
        userId: userId || null,
        createdAt: rawDetails?.offlineCreatedAt ? new Date(rawDetails.offlineCreatedAt) : undefined,
      },
      include: { items: true, user: true },
    });
  } catch (error) {
    if (error.code === "P2002" && offlineInvoiceNumber) {
      throw new DuplicateOfflineSaleError(offlineInvoiceNumber, businessId);
    }
    // Online invoice collision — retry once with a new number
    if (error.code === "P2002" && !offlineInvoiceNumber) {
      sale = await tx.sale.create({
        data: {
          customerMobile: details.customerMobile,
          customerName: details.customerName,
          discountType: details.discountType,
          discountValue: toMoneyDecimal(details.discountValue),
          paymentMethod: details.paymentMethod,
          discountAmount: toMoneyDecimal(totals.discountAmount),
          totalAmount: toMoneyDecimal(totals.totalAmount),
          businessId,
          branchId,
          customerId,
          invoiceNumber: createInvoiceNumber(),
          items: {
            create: saleItems.map((line) => ({
              barcode: line.barcode,
              name: line.name,
              price: line.price,
              productId: line.productId,
              quantity: line.quantity,
              discountType: line.discountType,
              discountValue: line.discountValue,
              discountAmount: line.discountAmount,
              total: line.total,
            })),
          },
          subtotal: toMoneyDecimal(grossSubtotal),
          totalItems,
          userId: userId || null,
        },
        include: { items: true, user: true },
      });
    } else {
      throw error;
    }
  }

  if (customerId) {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        totalSpent: { increment: toMoneyDecimal(totals.totalAmount) },
        visitCount: { increment: 1 },
        lastVisit: new Date(),
      },
    });
  }

  const account = await ensureSaleAccount(tx, businessId, details.paymentMethod);
  const payment = await tx.payment.create({
    data: {
      businessId,
      accountId: account.id,
      saleId: sale.id,
      customerId,
      amount: toMoneyDecimal(totals.totalAmount),
      type: "sale",
      method: details.paymentMethod,
      createdById: userId || null,
    },
  });
  await tx.ledgerTransaction.create({
    data: {
      businessId,
      accountId: account.id,
      paymentId: payment.id,
      type: "sale",
      direction: "credit",
      amount: toMoneyDecimal(totals.totalAmount),
      reference: sale.invoiceNumber,
      createdById: userId || null,
    },
  });

  return sale;
}

module.exports = {
  calculateTotals,
  createSale,
  ensureSaleAccount,
  normalizeCheckoutDetails,
  DuplicateOfflineSaleError,
  findExistingOfflineSale,
  // keep roundMoney export compatibility for callers/tests
  roundMoney: (v) => toMoneyNumber(roundMoney(v)),
};
