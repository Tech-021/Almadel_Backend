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

/** RP ID(s) accepted at verification (desktop + mobile browsers share the same web rpId). */
function resolveExpectedRpIds() {
  const primary = resolveRpId();
  const extras = parseOriginList(process.env.WEBAUTHN_RP_IDS)
    .map((entry) => entry.replace(/^https?:\/\//, "").split(":")[0])
    .filter(Boolean);
  const ids = new Set([primary, ...extras]);
  return ids.size === 1 ? primary : [...ids];
}

/**
 * WebAuthn authenticator selection for registration.
 * Do not set authenticatorAttachment to "platform" only — that blocks USB security keys
 * and confused frontends into treating passkeys as mobile-only. Platform authenticators
 * (Windows Hello, Touch ID) still work without attachment restriction.
 */
function resolveAuthenticatorSelection(overrideAttachment) {
  const fromRequest = String(overrideAttachment ?? "").trim().toLowerCase();
  const fromEnv = process.env.WEBAUTHN_AUTHENTICATOR_ATTACHMENT?.trim().toLowerCase();
  const attachment =
    fromRequest === "platform" || fromRequest === "cross-platform"
      ? fromRequest
      : fromEnv;
  const selection = {
    residentKey: "required",
    requireResidentKey: true,
    userVerification: "required",
  };
  if (attachment === "platform" || attachment === "cross-platform") {
    selection.authenticatorAttachment = attachment;
  }
  return selection;
}

function passkeyPublicConfig() {
  return {
    enabled: isPasskeyEnabled(),
    rpId: resolveRpId(),
    rpName: resolveRpName(),
    origins: resolveWebAuthnOrigins(),
    /** Backend accepts platform (Windows Hello / Touch ID) and cross-platform (USB keys). */
    authenticatorTypes: ["platform", "cross-platform"],
    userVerification: "preferred",
    residentKey: "preferred",
  };
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
  passkeyPublicConfig,
  resolveAuthenticatorSelection,
  resolveExpectedRpIds,
  resolveRpId,
  resolveRpName,
  resolveWebAuthnOrigins,
};
