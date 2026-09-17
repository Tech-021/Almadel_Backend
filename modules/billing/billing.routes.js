const express = require("express");
const { requireAuth } = require("../../middleware/auth");
const {
  getBillingStatus,
  createCheckout,
  createPortal,
  verifySession,
  handleWebhook,
} = require("./billing.controller");

const billingRouter = express.Router();

// Webhook endpoint (unauthenticated - verified by Stripe signature)
billingRouter.post("/webhook", handleWebhook);

// Protected endpoints
billingRouter.get("/status", requireAuth, getBillingStatus);
billingRouter.post("/create-checkout-session", requireAuth, createCheckout);
billingRouter.post("/create-portal-session", requireAuth, createPortal);
billingRouter.post("/verify-session", requireAuth, verifySession);

module.exports = { billingRouter };
