const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "https://web-app-allmadal.vercel.app",
];

function buildAllowedOriginSet() {
  const custom = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const frontend = process.env.FRONTEND_URL?.trim();
  const merged = [...DEFAULT_ORIGINS, ...custom];
  if (frontend) {
    merged.push(frontend);
  }

  return new Set(merged);
}

/**
 * Explicit allowlist only — no *.vercel.app (or other) suffix wildcards.
 * Non-browser requests (no Origin header) are allowed.
 */
function isAllowedCorsOrigin(origin, allowedSet = buildAllowedOriginSet()) {
  if (!origin) {
    return true;
  }

  if (allowedSet.has(origin)) {
    return true;
  }

  const isDev = process.env.NODE_ENV !== "production";
  if (
    isDev &&
    (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))
  ) {
    return true;
  }

  return false;
}

function createCorsOriginCallback() {
  const allowed = buildAllowedOriginSet();
  return (origin, callback) => {
    if (isAllowedCorsOrigin(origin, allowed)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  };
}

module.exports = {
  buildAllowedOriginSet,
  createCorsOriginCallback,
  isAllowedCorsOrigin,
};
