const { prisma } = require("../../db");
const {
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
  syncBusinessSubscription,
  verifyCheckoutSession,
} = require("./stripe.service");

// GET /billing/status?businessId=:id
async function getBillingStatus(req, res) {
  try {
    const businessId = Number(req.query.businessId);
    const userId = Number(req.user?.id);

    if (!businessId) {
      return res.status(400).json({ message: "businessId query parameter is required." });
    }

    const memberModel = prisma.businessMember || prisma.BusinessMember;
    const bizModel = prisma.business || prisma.Business;

    if (memberModel) {
      const membership = await memberModel.findUnique({
        where: { businessId_userId: { businessId, userId } },
      });
      if (!membership && req.user.role !== "admin") {
        return res.status(403).json({ message: "Access denied to business." });
      }
    }

    let business = await bizModel.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        createdAt: true,
      },
    });

    if (!business) {
      return res.status(404).json({ message: "Business not found." });
    }

    // Auto-sync with Stripe if not yet active or missing stripeSubscriptionId
    if (business.subscriptionStatus !== "active" || !business.stripeSubscriptionId) {
      try {
        const synced = await syncBusinessSubscription(businessId);
        if (synced) {
          business = {
            ...business,
            subscriptionStatus: synced.subscriptionStatus,
            stripeCustomerId: synced.stripeCustomerId,
            stripeSubscriptionId: synced.stripeSubscriptionId,
          };
        }
      } catch (e) {
        // continue
      }
    }

    // Compute 30-day trial remaining days
    const trialEnd = business.trialEndsAt
      ? new Date(business.trialEndsAt)
      : new Date(new Date(business.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000);

    const now = new Date();
    const diffMs = trialEnd.getTime() - now.getTime();
    const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const isTrialActive = daysLeft > 0;
    const isSubscribed = business.subscriptionStatus === "active" || Boolean(business.stripeSubscriptionId);

    return res.json({
      success: true,
      status: isSubscribed ? "active" : (business.subscriptionStatus || (isTrialActive ? "trialing" : "expired")),
      daysLeft,
      trialEndsAt: trialEnd,
      isTrialActive,
      isSubscribed,
      business,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    });
  } catch (error) {
    console.error("Billing status error:", error);
    return res.status(500).json({ message: "Failed to load billing status." });
  }
}

// POST /billing/sync
async function syncSubscription(req, res) {
  try {
    const businessId = Number(req.body.businessId);
    if (!businessId) {
      return res.status(400).json({ message: "businessId is required." });
    }

    const updated = await syncBusinessSubscription(businessId);
    return res.json({
      success: true,
      business: updated,
      isSubscribed: updated?.subscriptionStatus === "active" || Boolean(updated?.stripeSubscriptionId),
    });
  } catch (error) {
    console.error("Sync subscription error:", error);
    return res.status(500).json({ message: "Failed to sync subscription status." });
  }
}


// POST /billing/create-checkout-session
async function createCheckout(req, res) {
  try {
    const { businessId, successUrl, cancelUrl } = req.body;
    const userId = Number(req.user?.id);
    const userEmail = req.user?.email;

    if (!businessId) {
      return res.status(400).json({ message: "businessId is required." });
    }

    const biz = await prisma.business.findUnique({
      where: { id: Number(businessId) },
    });

    if (!biz) {
      return res.status(404).json({ message: "Business not found." });
    }

    const session = await createCheckoutSession({
      businessId: Number(businessId),
      userEmail,
      businessName: biz.name,
      successUrl,
      cancelUrl,
    });

    return res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Create checkout session error:", error);
    return res.status(500).json({
      message: error.message || "Failed to create Stripe Checkout session.",
    });
  }
}

// POST /billing/create-portal-session
async function createPortal(req, res) {
  try {
    const { businessId, returnUrl } = req.body;

    if (!businessId) {
      return res.status(400).json({ message: "businessId is required." });
    }

    const session = await createPortalSession({
      businessId: Number(businessId),
      returnUrl,
    });

    return res.json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    console.error("Create portal session error:", error);
    return res.status(500).json({
      message: error.message || "Failed to create Stripe Customer Portal session.",
    });
  }
}

// POST /billing/webhook
async function handleWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  const rawBody = req.rawBody || req.body;

  try {
    const result = await handleWebhookEvent(rawBody, sig);
    return res.json(result);
  } catch (error) {
    console.error("Stripe Webhook error:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}

// POST /billing/verify-session
async function verifySession(req, res) {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required." });
    }

    const { verifyCheckoutSession } = require("./stripe.service");
    const business = await verifyCheckoutSession(sessionId);

    return res.json({
      success: true,
      verified: Boolean(business),
      business,
    });
  } catch (error) {
    console.error("Verify session error:", error);
    return res.status(500).json({ message: "Failed to verify Stripe session." });
  }
}

module.exports = {
  getBillingStatus,
  createCheckout,
  createPortal,
  verifySession,
  syncSubscription,
  handleWebhook,
};

