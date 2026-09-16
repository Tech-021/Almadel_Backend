function toNonNegativeNumber(value, field) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${field} must be a valid positive number.`);
  }

  return number;
}

function toPositiveInteger(value, field) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${field} must be a valid whole number greater than zero.`);
  }

  return number;
}

module.exports = { toNonNegativeNumber, toPositiveInteger };