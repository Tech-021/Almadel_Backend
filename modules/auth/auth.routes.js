const express = require("express");
const { requireAuth } = require("../../middleware/auth");
const {
  forgotPasswordLimiters,
  magicLinkRequestLimiters,
  magicLinkVerifyLimiters,
  passkeySignInLimiters,
  resetPasswordLimiters,
  signInIpLimiter,
  signInEmailLimiter,
  signUpLimiters,
} = require("../../middleware/auth-rate-limit");

const {
  forgotPassword,
  getMe,
  requestMagicLink,
  resetPassword,
  signIn,
  signUpStaff,
  updateMe,
  verifyMagicLink,
} = require("./auth.controller");
const {
  passkeyConfig,
  passkeyDeleteCredential,
  passkeyListCredentials,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  passkeySignInOptions,
  passkeySignInVerify,
} = require("./passkey.controller");

const authRouter = express.Router();

authRouter.post("/staff/sign-up", ...signUpLimiters, signUpStaff);
authRouter.post("/sign-up", ...signUpLimiters, signUpStaff);
authRouter.post("/owner/sign-up", ...signUpLimiters, signUpStaff);
authRouter.post("/sign-in", signInIpLimiter, signInEmailLimiter, signIn);
authRouter.post("/forgot-password", ...forgotPasswordLimiters, forgotPassword);
authRouter.post("/magic-link/request", ...magicLinkRequestLimiters, requestMagicLink);
authRouter.post("/magic-link/verify", ...magicLinkVerifyLimiters, verifyMagicLink);
authRouter.get("/passkey/config", passkeyConfig);
authRouter.post("/passkey/register/options", requireAuth, passkeyRegisterOptions);
authRouter.post("/passkey/register/verify", requireAuth, passkeyRegisterVerify);
authRouter.get("/passkey/credentials", requireAuth, passkeyListCredentials);
authRouter.delete("/passkey/credentials/:id", requireAuth, passkeyDeleteCredential);
authRouter.post("/passkey/sign-in/options", ...passkeySignInLimiters, passkeySignInOptions);
authRouter.post("/passkey/sign-in/verify", ...passkeySignInLimiters, passkeySignInVerify);
authRouter.post("/reset-password", ...resetPasswordLimiters, resetPassword);
authRouter.get("/me", requireAuth, getMe);
authRouter.patch("/me", requireAuth, updateMe);

module.exports = { authRouter };
