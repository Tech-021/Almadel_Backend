const express = require("express");
const { requireAuth } = require("../../middleware/auth");
const {
  getBillingStatus,
  createOnboardingCheckout,
  createCheckout,
  createPortal,
  verifySession,
  syncSubscription,
  handleWebhook,
  stressCompleteOnboarding,
} = require("./billing.controller");

const billingRouter = express.Router();

// Webhook endpoint (unauthenticated - verified by Stripe signature)
billingRouter.post("/webhook", handleWebhook);

// Protected endpoints
billingRouter.get("/status", requireAuth, getBillingStatus);
billingRouter.post("/onboarding-checkout", requireAuth, createOnboardingCheckout);
billingRouter.post("/create-checkout-session", requireAuth, createCheckout);
billingRouter.post("/create-portal-session", requireAuth, createPortal);
billingRouter.post("/verify-session", requireAuth, verifySession);
billingRouter.post("/sync", requireAuth, syncSubscription);

// Stress-only shortcut for provisioning after draft (no real Stripe)
if (process.env.NODE_ENV === "stress" && process.env.STRESS_TEST === "true") {
  billingRouter.post("/stress-complete-onboarding", requireAuth, stressCompleteOnboarding);
}

module.exports = { billingRouter };

