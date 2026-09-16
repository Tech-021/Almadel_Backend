const crypto = require("crypto");

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function createResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function passwordResetUrl(token) {
  const baseUrl =
    process.env.PASSWORD_RESET_URL?.trim() || "myapp://reset-password";
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
