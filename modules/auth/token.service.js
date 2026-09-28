const jwt = require("jsonwebtoken");

const MIN_JWT_SECRET_LENGTH = 32;
const FORBIDDEN_SECRETS = new Set(["change-this-secret", "secret", "jwt-secret"]);

/**
 * Returns the configured JWT signing secret.
 * Fail-closed: never falls back to a hardcoded default.
 */
function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();

  if (!secret) {
    throw new Error(
      "JWT_SECRET is not configured. Set a strong random secret (at least 32 characters) in the environment.",
    );
  }

  if (FORBIDDEN_SECRETS.has(secret.toLowerCase()) || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is missing, too short, or uses a known insecure value. Use a random secret of at least ${MIN_JWT_SECRET_LENGTH} characters.`,
    );
  }

  return secret;
}

/** Call during process startup so misconfigured deploys fail before accepting traffic. */
function assertJwtSecretConfigured() {
  getJwtSecret();
}

function createAccessToken(user) {
  return jwt.sign(
    {
      authVersion: user.authVersion ?? 0,
      id: user.id,
      role: user.role,
    },
    getJwtSecret(),
    { expiresIn: "7d" },
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, getJwtSecret());
}

module.exports = {
  assertJwtSecretConfigured,
  createAccessToken,
  verifyAccessToken,
};
