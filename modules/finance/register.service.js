const { DomainError, REGISTER_CLOSED } = require("../../utils/domain-errors");
const { toMoneyDecimal, toMoneyNumber } = require("../../utils/money");

function businessDayStart(date = new Date()) {
  const iso = date.toISOString().slice(0, 10);
  return { iso, day: new Date(`${iso}T00:00:00.000`) };
}

/**
 * Ensure today's register row exists and is not closed.
 * Uses INSERT ... ON CONFLICT DO UPDATE to take a row lock, preventing
 * close-vs-checkout races from producing an invalid serialization.
 */
async function assertRegisterOpenForCheckout(tx, businessId, at = new Date()) {
  const { day } = businessDayStart(at);

  const business = await tx.business.findUnique({
    where: { id: businessId },
    select: { openingCashBalance: true },
  });

  const cashAccount = await tx.account.findFirst({
    where: {
      businessId,
      isActive: true,
      type: { equals: "cash", mode: "insensitive" },
    },
    orderBy: { id: "asc" },
    select: { openingBalance: true },
  });

  // Operational opening: sticky closing row > cash account > business config
  const openingCash = toMoneyDecimal(
    cashAccount?.openingBalance ?? business?.openingCashBalance ?? 0,
  );

  const rows = await tx.$queryRaw`
    INSERT INTO daily_closings (
      "businessId", "businessDate", status, "openingCash", "expectedCash", "createdAt", "updatedAt"
    )
    VALUES (
      ${businessId},
      ${day}::date,
      'open',
      ${openingCash}::numeric,
      0,
      NOW(),
      NOW()
    )
    ON CONFLICT ("businessId", "businessDate")
    DO UPDATE SET "updatedAt" = daily_closings."updatedAt"
    RETURNING status, "openingCash"
  `;

  const status = String(rows?.[0]?.status || "open");
  if (status === "closed") {
    throw new DomainError(
      REGISTER_CLOSED,
      "This business day is closed. Reopen the register before creating sales.",
      409,
    );
  }

  return { day, status, openingCash: toMoneyNumber(rows[0].openingCash) };
}

module.exports = {
  assertRegisterOpenForCheckout,
  businessDayStart,
};
