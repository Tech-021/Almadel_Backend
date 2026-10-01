const { rateLimit } = require("express-rate-limit");
const { createRedisRateLimitStore } = require("./redis-rate-limit-store");

const RATE_LIMIT_MESSAGE = {
  message: "Too many attempts. Please wait a few minutes and try again.",
};

function rateLimitDisabled() {
  return process.env.AUTH_RATE_LIMIT_DISABLED === "true";
}

function windowMs() {
  const parsed = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
}

function maxFromEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function baseRateLimitOptions(extra = {}) {
  const ms = windowMs();
  const store = createRedisRateLimitStore(ms);
  return {
    windowMs: ms,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => rateLimitDisabled(),
    handler: createJson429Handler(),
    ...(store ? { store } : {}),
    ...extra,
  };
}

function normalizeEmailFromBody(req) {
  return String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
}

function tokenKeyFromBody(req) {
  const token = String(req.body?.token ?? "").trim();
  if (!token) {
    return null;
  }
  return `token:${token.slice(0, 32)}`;
}

function createJson429Handler() {
  return (_req, res, _next, options) => {
    res.status(options.statusCode).json(RATE_LIMIT_MESSAGE);
  };
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function createIpLimiter(maxEnvName, fallbackMax) {
  return rateLimit(
    baseRateLimitOptions({
      max: maxFromEnv(maxEnvName, fallbackMax),
    }),
  );
}

function createEmailLimiter(maxEnvName, fallbackMax) {
  return rateLimit(
    baseRateLimitOptions({
      max: maxFromEnv(maxEnvName, fallbackMax),
      keyGenerator: (req) => {
        const email = normalizeEmailFromBody(req);
        if (email) {
          return `email:${email}`;
        }
        return clientIp(req);
      },
    }),
  );
}

function createResetTokenLimiter() {
  return rateLimit(
    baseRateLimitOptions({
      max: maxFromEnv("AUTH_RESET_PASSWORD_MAX_PER_TOKEN", 5),
      keyGenerator: (req) => {
        const tokenKey = tokenKeyFromBody(req);
        if (tokenKey) {
          return tokenKey;
        }
        return clientIp(req);
      },
    }),
  );
}

const signInIpLimiter = createIpLimiter("AUTH_SIGNIN_MAX_PER_IP", 30);
const signInEmailLimiter = createEmailLimiter("AUTH_SIGNIN_MAX_PER_EMAIL", 10);

const signUpIpLimiter = createIpLimiter("AUTH_SIGNUP_MAX_PER_IP", 20);
const signUpEmailLimiter = createEmailLimiter("AUTH_SIGNUP_MAX_PER_EMAIL", 5);

const staffCreateIpLimiter = createIpLimiter("AUTH_STAFF_CREATE_MAX_PER_IP", 30);

const forgotPasswordIpLimiter = createIpLimiter("AUTH_FORGOT_PASSWORD_MAX_PER_IP", 15);
const forgotPasswordEmailLimiter = createEmailLimiter(
  "AUTH_FORGOT_PASSWORD_MAX_PER_EMAIL",
  5,
);

const resetPasswordIpLimiter = createIpLimiter("AUTH_RESET_PASSWORD_MAX_PER_IP", 20);
const resetPasswordTokenLimiter = createResetTokenLimiter();

const forgotPasswordLimiters = [
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
];

const magicLinkIpLimiter = createIpLimiter("AUTH_MAGIC_LINK_MAX_PER_IP", 15);
const magicLinkEmailLimiter = createEmailLimiter("AUTH_MAGIC_LINK_MAX_PER_EMAIL", 5);
const magicLinkVerifyIpLimiter = createIpLimiter("AUTH_MAGIC_LINK_VERIFY_MAX_PER_IP", 30);
const magicLinkVerifyTokenLimiter = rateLimit(
  baseRateLimitOptions({
    max: maxFromEnv("AUTH_MAGIC_LINK_VERIFY_MAX_PER_TOKEN", 5),
    keyGenerator: (req) => {
      const tokenKey = tokenKeyFromBody(req);
      if (tokenKey) {
        return tokenKey;
      }
      return clientIp(req);
    },
  }),
);

const magicLinkRequestLimiters = [magicLinkIpLimiter, magicLinkEmailLimiter];
const magicLinkVerifyLimiters = [
  magicLinkVerifyIpLimiter,
  magicLinkVerifyTokenLimiter,
];

const resetPasswordLimiters = [
  resetPasswordIpLimiter,
  resetPasswordTokenLimiter,
];

const signUpLimiters = [signUpIpLimiter, signUpEmailLimiter];

module.exports = {
  forgotPasswordLimiters,
  magicLinkRequestLimiters,
  magicLinkVerifyLimiters,
  resetPasswordLimiters,
  signInIpLimiter,
  signInEmailLimiter,
  signUpIpLimiter,
  signUpEmailLimiter,
  signUpLimiters,
  staffCreateIpLimiter,
};
