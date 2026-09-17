const express = require("express");
const { requireAuth } = require("../../middleware/auth");

const {
  forgotPassword,
  resetPassword,
  signIn,
  signUpStaff,
  updateMe,
} = require("./auth.controller");

const authRouter = express.Router();

authRouter.post("/staff/sign-up", signUpStaff);
authRouter.post("/sign-up", signUpStaff);
authRouter.post("/owner/sign-up", signUpStaff);
authRouter.post("/sign-in", signIn);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.patch("/me", requireAuth, updateMe);

module.exports = { authRouter };
