const crypto = require("crypto");

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function createResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function resolvePasswordResetBaseUrl() {
  const explicit = process.env.PASSWORD_RESET_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const frontend = process.env.FRONTEND_URL?.trim();
  if (frontend) {
    return `${frontend.replace(/\/$/, "")}/reset-password`;
  }

  return "http://localhost:3000/reset-password";
}

function passwordResetUrl(token) {
  const baseUrl = resolvePasswordResetBaseUrl();
  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function resetTokenExpiry() {
  return new Date(Date.now() + RESET_TOKEN_TTL_MS);
}

module.exports = {
  createResetToken,
  hashResetToken,
  passwordResetUrl,
  resetTokenExpiry,
};