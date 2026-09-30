const {
  DomainError,
  INSUFFICIENT_BALANCE,
  INVALID_TENANT_RESOURCE,
  PAYMENT_ALREADY_PROCESSED,
} = require("../../utils/domain-errors");
const {
  isPositiveMoney,
  toMoneyDecimal,
  toMoneyNumber,
} = require("../../utils/money");

async function accountFor(tx, businessId, accountId) {
  const account = await tx.account.findFirst({
    where: { id: Number(accountId), businessId, isActive: true },
  });
  if (!account) {
    throw new DomainError(INVALID_TENANT_RESOURCE, "Account not found for this business.", 404);
  }
  return account;
}

/**
 * Create a customer/supplier payment with:
 * - single transaction
 * - conditional balance decrement (concurrency-safe)
 * - one ledger row per payment (DB unique on paymentId)
 * - optional idempotencyKey via payment.reference
 */
async function createPartyPayment(tx, {
  businessId,
  userId,
  accountId,
  partyId,
  type,
  amount,
  method = "cash",
  reference = null,
  idempotencyKey = null,
}) {
  const paymentType = type === "supplier" ? "supplier" : "customer";
  const paymentAmount = toMoneyDecimal(amount);

  if (!isPositiveMoney(paymentAmount)) {
    throw new DomainError("INVALID_AMOUNT", "Amount must be greater than zero.", 400);
  }

  await accountFor(tx, businessId, accountId);

  const idemRef = idempotencyKey ? String(idempotencyKey).trim() : null;
  if (idemRef) {
    const existing = await tx.payment.findFirst({
      where: {
        businessId,
        reference: idemRef,
        type: paymentType,
        ...(paymentType === "customer" ? { customerId: Number(partyId) } : { supplierId: Number(partyId) }),
      },
      include: { ledgerTransactions: true },
    });
    if (existing) {
      const err = new DomainError(
        PAYMENT_ALREADY_PROCESSED,
        "This payment was already processed.",
        200,
        { payment: existing },
      );
      err.payment = existing;
      throw err;
    }
  }

  const party =
    paymentType === "customer"
      ? await tx.customer.findFirst({ where: { id: Number(partyId), businessId } })
      : await tx.supplier.findFirst({ where: { id: Number(partyId), businessId } });

  if (!party) {
    throw new DomainError(INVALID_TENANT_RESOURCE, "Party not found for this business.", 404);
  }

  const payment = await tx.payment.create({
    data: {
      businessId,
      accountId: Number(accountId),
      ...(paymentType === "customer" ? { customerId: party.id } : { supplierId: party.id }),
      amount: paymentAmount,
      type: paymentType,
      method: String(method || "cash"),
      reference: idemRef || (reference ? String(reference) : null),
      createdById: Number(userId) || null,
    },
  });

  try {
    await tx.ledgerTransaction.create({
      data: {
        businessId,
        accountId: Number(accountId),
        paymentId: payment.id,
        type: `${paymentType}_payment`,
        direction: paymentType === "customer" ? "credit" : "debit",
        amount: paymentAmount,
        reference: payment.reference,
        createdById: Number(userId) || null,
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      throw new DomainError(
        PAYMENT_ALREADY_PROCESSED,
        "Ledger entry already exists for this payment.",
        409,
      );
    }
    throw error;
  }

  // Concurrency-safe balance guard: refuse overpayment below zero.
  const balanceUpdate =
    paymentType === "customer"
      ? await tx.customer.updateMany({
          where: {
            id: party.id,
            businessId,
            currentBalance: { gte: paymentAmount },
          },
          data: { currentBalance: { decrement: paymentAmount } },
        })
      : await tx.supplier.updateMany({
          where: {
            id: party.id,
            businessId,
            currentBalance: { gte: paymentAmount },
          },
          data: { currentBalance: { decrement: paymentAmount } },
        });

  if (balanceUpdate.count !== 1) {
    throw new DomainError(
      INSUFFICIENT_BALANCE,
      `Insufficient ${paymentType} balance. Available: ${toMoneyNumber(party.currentBalance)}.`,
      409,
      { available: toMoneyNumber(party.currentBalance), requested: toMoneyNumber(paymentAmount) },
    );
  }

  return payment;
}

module.exports = {
  accountFor,
  createPartyPayment,
};
