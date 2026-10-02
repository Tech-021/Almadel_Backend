/**
 * WebAuthn relying party settings for passkeys.
 * rpID must be a registrable domain suffix of the browser origin (no port).
 */

function parseOriginList(raw) {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function originFromUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function resolveWebAuthnOrigins() {
  const explicit = parseOriginList(process.env.WEBAUTHN_ORIGINS);
  if (explicit.length) {
    return explicit;
  }

  const fromCors = parseOriginList(process.env.CORS_ORIGINS);
  const frontend = originFromUrl(process.env.FRONTEND_URL?.trim());
  const origins = new Set(fromCors);
  if (frontend) {
    origins.add(frontend);
  }
  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");
  return [...origins];
}

function resolveRpId() {
  const explicit = process.env.WEBAUTHN_RP_ID?.trim();
  if (explicit) {
    return explicit.replace(/^https?:\/\//, "").split(":")[0];
  }

  const frontend = process.env.FRONTEND_URL?.trim();
  if (frontend) {
    try {
      return new URL(frontend).hostname;
    } catch {
      // fall through
    }
  }

  return "localhost";
}

function resolveRpName() {
  return process.env.WEBAUTHN_RP_NAME?.trim() || "Almadel";
}

function isPasskeyEnabled() {
  return process.env.ENABLE_PASSKEY !== "false";
}

function assertOriginAllowed(requestOrigin) {
  const origins = resolveWebAuthnOrigins();
  if (!requestOrigin || !origins.includes(requestOrigin)) {
    const err = new Error("Passkey origin is not allowed.");
    err.code = "ORIGIN_NOT_ALLOWED";
    throw err;
  }
}

module.exports = {
  assertOriginAllowed,
  isPasskeyEnabled,
  resolveRpId,
  resolveRpName,
  resolveWebAuthnOrigins,
};
