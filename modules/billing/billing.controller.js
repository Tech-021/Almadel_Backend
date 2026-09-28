const { prisma } = require("../../db");
const {
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
  syncBusinessSubscription,
  getCheckoutSessionContext,
  activateBusinessFromCheckoutSession,
} = require("./stripe.service");

const BILLING_MANAGE_ROLES = new Set(["owner", "admin"]);

/**
 * Ensures the authenticated user belongs to the target business.
 * When `manage` is true, requires business role owner or admin (billing mutations).
 * Does not treat global User.role === "admin" as cross-tenant access.
 */
async function assertBillingAccess(userId, businessId, { manage = false } = {}) {
  const id = Number(businessId);
  const uid = Number(userId);

  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error("businessId is required.");
    err.status = 400;
    throw err;
  }

  if (!Number.isInteger(uid) || uid <= 0) {
    const err = new Error("Authentication required.");
    err.status = 401;
    throw err;
  }

  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: id, userId: uid } },
  });

  if (!membership) {
    const err = new Error("Access denied to business.");
    err.status = 403;
    throw err;
  }

  if (manage && !BILLING_MANAGE_ROLES.has(membership.role)) {
    const err = new Error("Only business owners or admins can manage billing.");
    err.status = 403;
    throw err;
  }

  return { businessId: id, membership };
}

function sendAccessError(res, error, fallbackMessage) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error(fallbackMessage, error);
    return res.status(500).json({ message: fallbackMessage });
  }
  return res.status(status).json({ message: error.message || fallbackMessage });
}

// GET /billing/status?businessId=:id
async function getBillingStatus(req, res) {
  try {
    const businessId = Number(req.query.businessId);
    const userId = Number(req.user?.id);

    await assertBillingAccess(userId, businessId, { manage: false });

    let business = await prisma.business.findUnique({
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
    if (error.status) {
      return sendAccessError(res, error, "Failed to load billing status.");
    }
    console.error("Billing status error:", error);
    return res.status(500).json({ message: "Failed to load billing status." });
  }
}

// POST /billing/sync
async function syncSubscription(req, res) {
  try {
    const businessId = Number(req.body.businessId);
    const userId = Number(req.user?.id);

    await assertBillingAccess(userId, businessId, { manage: true });

    const updated = await syncBusinessSubscription(businessId);
    return res.json({
      success: true,
      business: updated,
      isSubscribed: updated?.subscriptionStatus === "active" || Boolean(updated?.stripeSubscriptionId),
    });
  } catch (error) {
    if (error.status) {
      return sendAccessError(res, error, "Failed to sync subscription status.");
    }
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

    const { businessId: authorizedBusinessId } = await assertBillingAccess(
      userId,
      businessId,
      { manage: true },
    );

    const biz = await prisma.business.findUnique({
      where: { id: authorizedBusinessId },
    });

    if (!biz) {
      return res.status(404).json({ message: "Business not found." });
    }

    const session = await createCheckoutSession({
      businessId: authorizedBusinessId,
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
    if (error.status) {
      return sendAccessError(res, error, "Failed to create Stripe Checkout session.");
    }
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
    const userId = Number(req.user?.id);

    const { businessId: authorizedBusinessId } = await assertBillingAccess(
      userId,
      businessId,
      { manage: true },
    );

    const session = await createPortalSession({
      businessId: authorizedBusinessId,
      returnUrl,
    });

    return res.json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    if (error.status) {
      return sendAccessError(res, error, "Failed to create Stripe Customer Portal session.");
    }
    console.error("Create portal session error:", error);
    return res.status(500).json({
      message: error.message || "Failed to create Stripe Customer Portal session.",
    });
  }
}

// POST /billing/webhook
async function handleWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  // Use only the raw buffer captured by express.json verify — never fall back to parsed body.
  const rawBody = req.rawBody;

  if (!rawBody) {
    return res
      .status(400)
      .send("Webhook Error: Raw request body required for signature verification.");
  }

  try {
    const result = await handleWebhookEvent(rawBody, sig);
    return res.json(result);
  } catch (error) {
    console.error("Stripe Webhook error:", error.message);
    const status = Number(error.status) || 400;
    return res.status(status).send(`Webhook Error: ${error.message}`);
  }
}

// POST /billing/verify-session
async function verifySession(req, res) {
  try {
    const { sessionId } = req.body;
    const userId = Number(req.user?.id);

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required." });
    }

    const ctx = await getCheckoutSessionContext(sessionId);
    if (!ctx?.businessId) {
      return res.status(400).json({
        message: "Checkout session is not linked to a business.",
      });
    }

    // Authorize against the business embedded in the Stripe session — never from session ID alone.
    await assertBillingAccess(userId, ctx.businessId, { manage: true });

    if (!ctx.isComplete) {
      return res.json({
        success: true,
        verified: false,
        business: null,
      });
    }

    const business = await activateBusinessFromCheckoutSession(ctx.session, ctx.businessId);

    return res.json({
      success: true,
      verified: Boolean(business),
      business,
    });
  } catch (error) {
    if (error.status) {
      return sendAccessError(res, error, "Failed to verify Stripe session.");
    }
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
