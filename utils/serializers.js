const { toMoneyNumber } = require("./money");

function saleResponse(sale) {
  return {
    customer_mobile: sale.customerMobile,
    customer_name: sale.customerName,
    id: sale.id,
    invoice_number: sale.invoiceNumber,
    payment_method: sale.paymentMethod,
    total_amount: toMoneyNumber(sale.totalAmount),
    total_items: sale.totalItems,
    created_at: sale.createdAt,
  };
}

function invoiceResponse(sale) {
  return {
    cashierName: sale.user?.fullName ?? sale.user?.email ?? "Staff",
    storeName: sale.user?.fullName ?? sale.user?.email ?? "Almadel",
    createdAt: sale.createdAt,
    customerMobile: sale.customerMobile,
    customerName: sale.customerName,
    discountAmount: toMoneyNumber(sale.discountAmount),
    discountType: sale.discountType,
    discountValue: toMoneyNumber(sale.discountValue),
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    items: (sale.items ?? []).map((item) => ({
      id: item.id,
      barcode: item.barcode,
      name: item.name,
      price: toMoneyNumber(item.price),
      quantity: item.quantity,
      refundedQuantity: item.refundedQuantity ?? 0,
      total: toMoneyNumber(item.total),
    })),
    paymentMethod: sale.paymentMethod,
    subtotal: toMoneyNumber(sale.subtotal),
    totalAmount: toMoneyNumber(sale.totalAmount),
    refundedAmount: toMoneyNumber(sale.refundedAmount ?? 0),
    totalItems: sale.totalItems,
  };
}

function refundResponse(refund) {
  return {
    id: refund.id,
    refundNumber: refund.refundNumber,
    saleId: refund.saleId,
    invoiceNumber: refund.sale?.invoiceNumber ?? null,
    customerName: refund.sale?.customerName ?? null,
    customerMobile: refund.sale?.customerMobile ?? null,
    totalAmount: toMoneyNumber(refund.totalAmount),
    reason: refund.reason,
    paymentMethod: refund.paymentMethod,
    createdAt: refund.createdAt,
    processedBy: refund.user?.fullName ?? refund.user?.email ?? "Staff",
    items: (refund.items ?? []).map((item) => ({
      id: item.id,
      saleItemId: item.saleItemId,
      barcode: item.barcode,
      name: item.name,
      quantity: item.quantity,
      unitAmount: toMoneyNumber(item.unitAmount),
      total: toMoneyNumber(item.total),
    })),
  };
}

function customerResponse(customer) {
  return {
    id: customer.id,
    name: customer.name,
    mobile: customer.mobile,
    email: customer.email,
    totalSpent: toMoneyNumber(customer.totalSpent),
    visitCount: customer.visitCount,
    openingBalance: toMoneyNumber(customer.openingBalance ?? 0),
    currentBalance: toMoneyNumber(customer.currentBalance ?? 0),
    lastVisit: customer.lastVisit,
    createdAt: customer.createdAt,
  };
}

function userResponse(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

module.exports = {
  customerResponse,
  invoiceResponse,
  refundResponse,
  saleResponse,
  userResponse,
};
