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
      barcode: item.barcode,
      name: item.name,
      price: toMoneyNumber(item.price),
      quantity: item.quantity,
      total: toMoneyNumber(item.total),
    })),
    paymentMethod: sale.paymentMethod,
    subtotal: toMoneyNumber(sale.subtotal),
    totalAmount: toMoneyNumber(sale.totalAmount),
    totalItems: sale.totalItems,
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

module.exports = { customerResponse, invoiceResponse, saleResponse, userResponse };
