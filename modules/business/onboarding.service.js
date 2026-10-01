const { prisma } = require("../../db");
const { provisionBusinessForOwner } = require("./business-provision.service");
const { getStripeClient } = require("../billing/stripe.service");
const { DomainError, ONBOARDING_ALREADY_FULFILLED } = require("../../utils/domain-errors");

function parseOnboardingUserIdFromSession(session) {
  const fromMeta = Number(session?.metadata?.onboardingUserId);
  if (Number.isInteger(fromMeta) && fromMeta > 0) {
    return fromMeta;
  }

  const ref = String(session?.client_reference_id || "");
  if (ref.startsWith("onboarding-")) {
    const id = Number(ref.slice("onboarding-".length));
    if (Number.isInteger(id) && id > 0) {
      return id;
    }
  }

  return null;
}

async function assertUserCanStartOnboarding(userId) {
  const uid = Number(userId);
  const existingOwnerBiz = await prisma.business.findUnique({
    where: { ownerId: uid },
  });
  if (existingOwnerBiz) {
    const err = new Error(
      "You already have a registered business with this account. Each account is strictly limited to one business.",
    );
    err.status = 400;
    err.business = existingOwnerBiz;
    throw err;
  }

  const existingMembership = await prisma.businessMember.findUnique({
    where: { userId: uid },
  });
  if (existingMembership) {
    const err = new Error(
      "You already belong to a registered business. Each account is strictly limited to one business.",
    );
    err.status = 400;
    throw err;
  }
}

async function saveOnboardingDraft(userId, payload, workspaceMode) {
  await assertUserCanStartOnboarding(userId);

  const mode =
    workspaceMode === "financial" || workspaceMode === "pos" ? workspaceMode : undefined;

  return prisma.businessOnboardingDraft.upsert({
    where: { userId: Number(userId) },
    create: {
      userId: Number(userId),
      payload,
      workspaceMode: mode || "pos",
    },
    update: {
      payload,
      ...(mode ? { workspaceMode: mode } : {}),
    },
  });
}

async function updateOnboardingWorkspaceMode(userId, workspaceMode) {
  if (workspaceMode !== "financial" && workspaceMode !== "pos") {
    const err = new Error("workspaceMode must be pos or financial.");
    err.status = 400;
    throw err;
  }

  const draft = await prisma.businessOnboardingDraft.findUnique({
    where: { userId: Number(userId) },
  });
  if (!draft) {
    const err = new Error("Complete business details before choosing a workspace.");
    err.status = 400;
    throw err;
  }

  return prisma.businessOnboardingDraft.update({
    where: { userId: Number(userId) },
    data: { workspaceMode },
  });
}

async function getOnboardingDraft(userId) {
  return prisma.businessOnboardingDraft.findUnique({
    where: { userId: Number(userId) },
  });
}

/**
 * After Stripe checkout completes: create business, owner membership, billing linkage.
 * Local DB mutations run in one transaction. Stripe metadata update happens after commit.
 */
async function fulfillOnboardingFromCheckoutSession(session, expectedUserId) {
  const onboardingUserId = parseOnboardingUserIdFromSession(session);
  if (!onboardingUserId) {
    return null;
  }

  if (
    expectedUserId != null &&
    Number(expectedUserId) !== Number(onboardingUserId)
  ) {
    const err = new Error("Checkout session does not belong to this account.");
    err.status = 403;
    throw err;
  }

  const isComplete =
    session.status === "complete" ||
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required";

  if (!isComplete) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: onboardingUserId },
    select: { id: true, email: true, fullName: true },
  });
  if (!user) {
    const err = new Error("Account not found for onboarding session.");
    err.status = 404;
    throw err;
  }

  const stripeCustomerId = session.customer ? String(session.customer) : null;
  const stripeSubscriptionId = session.subscription ? String(session.subscription) : null;

  const business = await prisma.$transaction(async (tx) => {
    const draft = await tx.businessOnboardingDraft.findUnique({
      where: { userId: onboardingUserId },
    });

    let existing = await tx.businessMember
      .findUnique({ where: { userId: onboardingUserId }, include: { business: true } })
      .then((m) => m?.business ?? null);

    if (!existing) {
      if (!draft) {
        const err = new Error("Onboarding draft not found. Please submit business details again.");
        err.status = 400;
        throw err;
      }

      existing = await provisionBusinessForOwner(
        onboardingUserId,
        draft.payload,
        draft.workspaceMode,
        user,
        {
          client: tx,
          stripeCustomerId,
          stripeSubscriptionId,
          subscriptionStatus: "trialing",
        },
      );
    } else {
      existing = await tx.business.update({
        where: { id: existing.id },
        data: {
          subscriptionStatus: "trialing",
          ...(stripeCustomerId ? { stripeCustomerId } : {}),
          ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
        },
      });
    }

    // Ensure billing fields are set even on first provision path.
    existing = await tx.business.update({
      where: { id: existing.id },
      data: {
        subscriptionStatus: "trialing",
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
        ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
      },
    });

    await tx.businessOnboardingDraft.deleteMany({
      where: { userId: onboardingUserId },
    });

    return existing;
  });

  // External Stripe call after local commit (not held inside DB transaction).
  const stripe = getStripeClient();
  const subId = stripeSubscriptionId || "";
  const isRealStripeSub =
    /^sub_[A-Za-z0-9]+$/.test(subId) &&
    !subId.startsWith("sub_stress_") &&
    !subId.startsWith("sub_live_load_") &&
    !subId.startsWith("sub_test_fake");
  if (stripe && isRealStripeSub) {
    try {
      await stripe.subscriptions.update(subId, {
        metadata: { businessId: String(business.id) },
      });
    } catch (e) {
      console.warn("Stripe subscription metadata update notice:", e.message);
    }
  }

  return business;
}

module.exports = {
  assertUserCanStartOnboarding,
  fulfillOnboardingFromCheckoutSession,
  getOnboardingDraft,
  parseOnboardingUserIdFromSession,
  saveOnboardingDraft,
  updateOnboardingWorkspaceMode,
  ONBOARDING_ALREADY_FULFILLED,
  DomainError,
};
