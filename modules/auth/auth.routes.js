const express = require("express");

const {
  forgotPassword,
  resetPassword,
  signIn,
  signUpStaff,
} = require("./auth.controller");

const authRouter = express.Router();

authRouter.post("/staff/sign-up", signUpStaff);
authRouter.post("/sign-up", signUpStaff);
authRouter.post("/owner/sign-up", signUpStaff);
authRouter.post("/sign-in", signIn);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);

module.exports = { authRouter };