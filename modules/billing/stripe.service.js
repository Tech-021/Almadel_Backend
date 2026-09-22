const Stripe = require("stripe");
const { prisma } = require("../../db");

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return null;
  }
  return new Stripe(secretKey);
}

/**
 * Creates a Stripe Checkout Session for a single flat subscription plan.
 */
async function createCheckoutSession({ businessId, userEmail, businessName, successUrl, cancelUrl }) {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY is not configured in backend environment.");
  }

  const biz = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!biz) {
    throw new Error("Business not found.");
  }

  let customerId = biz.stripeCustomerId;
  let customerExists = false;

  if (customerId) {
    try {
      const existingCustomer = await stripe.customers.retrieve(customerId);
      if (existingCustomer && !existingCustomer.deleted) {
        customerExists = true;
      }
    } catch (err) {
      // If customer was created in a different mode (live vs test) or account, safely treat as non-existent
      customerExists = false;
    }
  }

  if (!customerExists) {
    const customer = await stripe.customers.create({
      email: userEmail || biz.email || undefined,
      name: businessName || biz.name,
      metadata: {
        businessId: String(businessId),
      },
    });
    customerId = customer.id;
    await prisma.business.update({
      where: { id: businessId },
      data: { stripeCustomerId: customerId },
    });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  let lineItems = [];

  if (priceId) {
    lineItems = [{ price: priceId, quantity: 1 }];
  } else {
    // Dynamic price data if no specific STRIPE_PRICE_ID is configured
    const currency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();
    const amount = Number(process.env.STRIPE_AMOUNT || 2900); // $29.00 USD default
    lineItems = [
      {
        price_data: {
          currency,
          product_data: {
            name: "Almadel Pro Subscription",
            description: "Full access to POS, Financial Accounts, Khata, Inventory, and Reports",
          },
          unit_amount: amount,
          recurring: {
            interval: "month",
          },
        },
        quantity: 1,
      },
    ];
  }

    // Calculate remaining trial days or 30 days if starting trial
    let trialPeriodDays = undefined;
    const isTrialing = biz.subscriptionStatus === "trialing" || !biz.stripeSubscriptionId;
    if (isTrialing) {
      if (biz.trialEndsAt) {
        const remainingDays = Math.ceil((new Date(biz.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        trialPeriodDays = remainingDays > 0 ? remainingDays : undefined;
      } else {
        trialPeriodDays = 30;
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: customerId,
      client_reference_id: String(businessId),
      line_items: lineItems,
      metadata: {
        businessId: String(businessId),
      },
      subscription_data: {
        trial_period_days: trialPeriodDays,
        metadata: {
          businessId: String(businessId),
        },
      },
      success_url: successUrl
        ? (successUrl.includes("{CHECKOUT_SESSION_ID}")
            ? successUrl
            : `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`)
        : `${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/payments?payment=canceled`,
    });

  return session;
}

/**
 * Directly verifies a completed Checkout Session on redirect return (works without webhooks).
 */
async function verifyCheckoutSession(sessionId) {
  const stripe = getStripeClient();
  if (!stripe || !sessionId) {
    return null;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session) {
    return null;
  }

  const businessId = Number(session.client_reference_id || session.metadata?.businessId);
  if (businessId && (session.status === "complete" || session.payment_status === "paid" || session.payment_status === "no_payment_required")) {
    const updated = await prisma.business.update({
      where: { id: businessId },
      data: {
        subscriptionStatus: "active",
        stripeCustomerId: session.customer ? String(session.customer) : undefined,
        stripeSubscriptionId: session.subscription ? String(session.subscription) : undefined,
      },
    });
    return updated;
  }

  return null;
}

/**
 * Actively syncs subscription status directly from Stripe API for a given business.
 */
async function syncBusinessSubscription(businessId) {
  const stripe = getStripeClient();
  if (!stripe || !businessId) {
    return null;
  }

  const biz = await prisma.business.findUnique({
    where: { id: Number(businessId) },
  });

  if (!biz) {
    return null;
  }

  let customerId = biz.stripeCustomerId;

  // If customerId is not in DB, search Stripe by business metadata or email
  if (!customerId) {
    try {
      const searchRes = await stripe.customers.search({
        query: `metadata['businessId']:'${businessId}'`,
      });
      if (searchRes.data && searchRes.data.length > 0) {
        customerId = searchRes.data[0].id;
      }
    } catch (e) {
      // Fallback search
    }
  }

  if (customerId) {
    try {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        limit: 1,
      });

      if (subs.data && subs.data.length > 0) {
        const sub = subs.data[0];
        const isActive = sub.status === "active" || sub.status === "trialing";
        if (isActive) {
          const updated = await prisma.business.update({
            where: { id: Number(businessId) },
            data: {
              subscriptionStatus: "active",
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
              cancelAtPeriodEnd: sub.cancel_at_period_end || false,
            },
          });
          return updated;
        }
      }
    } catch (err) {
      console.warn("Stripe customer subscription lookup notice:", err.message);
    }
  }

  return biz;
}


/**
 * Creates a Stripe Customer Portal session for managing billing.
 */
async function createPortalSession({ businessId, returnUrl }) {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  const biz = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!biz || !biz.stripeCustomerId) {
    throw new Error("No active Stripe customer found for this business.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: biz.stripeCustomerId,
    return_url: returnUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/payments`,
  });

  return session;
}

/**
 * Handles incoming Stripe Webhook events.
 */
async function handleWebhookEvent(rawBody, signature) {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY not configured.");
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  if (webhookSecret && signature) {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } else {
    event = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  }

  const dataObject = event.data?.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = dataObject;
      const businessId = Number(session.client_reference_id || session.metadata?.businessId);
      if (businessId) {
        await prisma.business.update({
          where: { id: businessId },
          data: {
            subscriptionStatus: "active",
            stripeCustomerId: session.customer ? String(session.customer) : undefined,
            stripeSubscriptionId: session.subscription ? String(session.subscription) : undefined,
          },
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = dataObject;
      const customerId = String(subscription.customer);
      const status = subscription.status === "trialing" ? "active" : subscription.status;
      const periodEnd = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : undefined;

      const businessId = Number(subscription.metadata?.businessId);

      if (businessId) {
        await prisma.business.update({
          where: { id: businessId },
          data: {
            subscriptionStatus: status,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
          },
        });
      } else {
        await prisma.business.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            subscriptionStatus: status,
            stripeSubscriptionId: subscription.id,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
          },
        });
      }
      break;
    }


    case "customer.subscription.deleted": {
      const subscription = dataObject;
      const customerId = String(subscription.customer);
      await prisma.business.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          subscriptionStatus: "canceled",
          cancelAtPeriodEnd: false,
        },
      });
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = dataObject;
      const customerId = String(invoice.customer);
      if (customerId) {
        await prisma.business.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            subscriptionStatus: "active",
          },
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = dataObject;
      const customerId = String(invoice.customer);
      if (customerId) {
        await prisma.business.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            subscriptionStatus: "past_due",
          },
        });
      }
      break;
    }
  }

  return { received: true };
}

module.exports = {
  getStripeClient,
  createCheckoutSession,
  verifyCheckoutSession,
  syncBusinessSubscription,
  createPortalSession,
  handleWebhookEvent,
};

