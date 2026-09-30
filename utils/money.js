const { Prisma } = require("@prisma/client");

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

function money(value) {
  if (value == null || value === "") return ZERO;
  if (value instanceof Prisma.Decimal) return value;
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new Error("Invalid monetary value.");
  }
}

/** Round to 2 decimal places (banker's? no — half-up via Decimal). */
function roundMoney(value) {
  return money(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function addMoney(...values) {
  return roundMoney(values.reduce((sum, v) => money(sum).add(money(v)), ZERO));
}

function subMoney(a, b) {
  return roundMoney(money(a).sub(money(b)));
}

function mulMoney(a, b) {
  return roundMoney(money(a).mul(money(b)));
}

function divMoney(a, b) {
  const denom = money(b);
  if (denom.isZero()) throw new Error("Division by zero in money calculation.");
  return roundMoney(money(a).div(denom));
}

function pctOf(amount, percent) {
  return roundMoney(money(amount).mul(money(percent)).div(HUNDRED));
}

function maxMoney(a, b) {
  const left = money(a);
  const right = money(b);
  return left.gte(right) ? left : right;
}

function minMoney(a, b) {
  const left = money(a);
  const right = money(b);
  return left.lte(right) ? left : right;
}

function isPositiveMoney(value) {
  try {
    return money(value).gt(0);
  } catch {
    return false;
  }
}

function isNonNegativeMoney(value) {
  try {
    return money(value).gte(0);
  } catch {
    return false;
  }
}

/** API-compatible number (2 dp). Prefer this at response boundaries. */
function toMoneyNumber(value) {
  if (value == null) return 0;
  return Number(roundMoney(value).toFixed(2));
}

/** Prisma write-safe Decimal (2 dp). */
function toMoneyDecimal(value) {
  return roundMoney(value);
}

function moneyEquals(a, b) {
  return roundMoney(a).eq(roundMoney(b));
}

module.exports = {
  ZERO,
  money,
  roundMoney,
  addMoney,
  subMoney,
  mulMoney,
  divMoney,
  pctOf,
  maxMoney,
  minMoney,
  isPositiveMoney,
  isNonNegativeMoney,
  toMoneyNumber,
  toMoneyDecimal,
  moneyEquals,
};
