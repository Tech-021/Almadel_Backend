class DomainError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isDomainError(error) {
  return error instanceof DomainError || (error && error.name === "DomainError" && error.code);
}

function toHttpError(error) {
  if (isDomainError(error)) {
    return {
      status: error.status || 400,
      body: {
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  if (error?.code === "P2002") {
    return {
      status: 409,
      body: { message: "Duplicate record.", code: "UNIQUE_VIOLATION" },
    };
  }

  if (error?.code === "P2003") {
    return {
      status: 409,
      body: { message: "Related record prevents this change.", code: "FOREIGN_KEY_VIOLATION" },
    };
  }

  return null;
}

module.exports = {
  DomainError,
  isDomainError,
  toHttpError,
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  REGISTER_CLOSED: "REGISTER_CLOSED",
  PAYMENT_ALREADY_PROCESSED: "PAYMENT_ALREADY_PROCESSED",
  PRODUCT_HAS_SALE_HISTORY: "PRODUCT_HAS_SALE_HISTORY",
  INVALID_TENANT_RESOURCE: "INVALID_TENANT_RESOURCE",
  ONBOARDING_ALREADY_FULFILLED: "ONBOARDING_ALREADY_FULFILLED",
};
