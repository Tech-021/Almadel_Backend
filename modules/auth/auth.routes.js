const express = require("express");
const { requireAuth } = require("../../middleware/auth");
const {
  forgotPasswordLimiters,
  resetPasswordLimiters,
  signInIpLimiter,
  signInEmailLimiter,
  signUpLimiters,
} = require("../../middleware/auth-rate-limit");

const {
  forgotPassword,
  getMe,
  resetPassword,
  signIn,
  signUpStaff,
  updateMe,
} = require("./auth.controller");

const authRouter = express.Router();

authRouter.post("/staff/sign-up", ...signUpLimiters, signUpStaff);
authRouter.post("/sign-up", ...signUpLimiters, signUpStaff);
authRouter.post("/owner/sign-up", ...signUpLimiters, signUpStaff);
authRouter.post("/sign-in", signInIpLimiter, signInEmailLimiter, signIn);
authRouter.post("/forgot-password", ...forgotPasswordLimiters, forgotPassword);
authRouter.post("/reset-password", ...resetPasswordLimiters, resetPassword);
authRouter.get("/me", requireAuth, getMe);
authRouter.patch("/me", requireAuth, updateMe);

module.exports = { authRouter };
