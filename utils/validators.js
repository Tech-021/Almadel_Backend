/**
 * Backend Request Validation Utilities
 */

const PHONE_REGEX = /^(\+92|0092|0)?3[0-9]{9}$|^(\+)?[1-9][0-9]{9,14}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NTN_REGEX = /^[0-9]{7}-?[0-9]$/;
const STRN_REGEX = /^[0-9]{2}-?[0-9]{2}-?[0-9]{4}-?[0-9]{3}-?[0-9]{2}$|^[0-9]{13}$/;

function validatePhone(value, options = true, deprecatedLabel) {
  const isReq = typeof options === "boolean" ? options : (options && options.required !== undefined ? options.required : true);
  const label = typeof options === "object" ? (options.fieldName || options.fieldLabel || "Mobile number") : (deprecatedLabel || "Mobile number");

  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return isReq
      ? { valid: false, error: `${label} is required.` }
      : { valid: true, error: null };
  }
  const cleanNumber = trimmed.replace(/[\s\-_()]/g, "");
  const digitsOnly = cleanNumber.replace(/^\+/, "");
  if (!/^\+?[0-9]+$/.test(cleanNumber)) {
    return { valid: false, error: `${label} can only contain numbers.` };
  }
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    return { valid: false, error: `${label} must be between 10 and 15 digits (e.g. 0300-1234567).` };
  }
  if (!PHONE_REGEX.test(cleanNumber)) {
    return { valid: false, error: `Please enter a valid ${label.toLowerCase()} (e.g. 03XXXXXXXXX).` };
  }
  return { valid: true, error: null };
}

function validateEmail(value, options = false, deprecatedLabel) {
  const isReq = typeof options === "boolean" ? options : (options && options.required !== undefined ? options.required : false);
  const label = typeof options === "object" ? (options.fieldName || options.fieldLabel || "Email address") : (deprecatedLabel || "Email address");

  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return isReq
      ? { valid: false, error: `${label} is required.` }
      : { valid: true, error: null };
  }
  if (trimmed.length > 100 || !EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: `Please enter a valid ${label.toLowerCase()}.` };
  }
  return { valid: true, error: null };
}

function validateText(value, options = {}) {
  const min = options.minLength ?? options.min ?? 1;
  const max = options.maxLength ?? options.max ?? 200;
  const required = options.required ?? true;
  const label = options.fieldName ?? options.fieldLabel ?? "Field";

  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return required
      ? { valid: false, error: `${label} is required.` }
      : { valid: true, error: null };
  }
  if (trimmed.length < min) {
    return { valid: false, error: `${label} must be at least ${min} characters.` };
  }
  if (trimmed.length > max) {
    return { valid: false, error: `${label} cannot exceed ${max} characters.` };
  }
  return { valid: true, error: null };
}

function validateNumber(value, options = {}) {
  const min = options.min ?? 0;
  const max = options.max ?? 1_000_000_000;
  const integer = options.integerOnly ?? options.integer ?? false;
  const required = options.required ?? true;
  const label = options.fieldName ?? options.fieldLabel ?? "Value";

  if (value === undefined || value === null || String(value).trim() === "") {
    return required
      ? { valid: false, error: `${label} is required.` }
      : { valid: true, error: null };
  }
  const num = Number(value);
  if (isNaN(num)) {
    return { valid: false, error: `${label} must be a valid number.` };
  }
  if (integer && !Number.isInteger(num)) {
    return { valid: false, error: `${label} must be a whole integer.` };
  }
  if (num < min) {
    return { valid: false, error: `${label} cannot be less than ${min}.` };
  }
  if (num > max) {
    return { valid: false, error: `${label} cannot exceed ${max.toLocaleString()}.` };
  }
  return { valid: true, error: null };
}

module.exports = {
  PHONE_REGEX,
  EMAIL_REGEX,
  NTN_REGEX,
  STRN_REGEX,
  validatePhone,
  validateEmail,
  validateText,
  validateNumber,
};
