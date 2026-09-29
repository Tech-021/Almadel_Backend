const express = require("express");
const { requireAuth } = require("../../middleware/auth");
const {
  forgotPasswordLimiters,
  resetPasswordLimiters,
  signInIpLimiter,
  signInEmailLimiter,
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

authRouter.post("/staff/sign-up", signUpStaff);
authRouter.post("/sign-up", signUpStaff);
authRouter.post("/owner/sign-up", signUpStaff);
authRouter.post("/sign-in", signInIpLimiter, signInEmailLimiter, signIn);
authRouter.post("/forgot-password", ...forgotPasswordLimiters, forgotPassword);
authRouter.post("/reset-password", ...resetPasswordLimiters, resetPassword);
authRouter.get("/me", requireAuth, getMe);
authRouter.patch("/me", requireAuth, updateMe);

module.exports = { authRouter };
