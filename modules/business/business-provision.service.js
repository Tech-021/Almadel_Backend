const { prisma } = require("../../db");
const { toMoneyDecimal } = require("../../utils/money");

/**
 * Creates Business + owner membership + default branch + cash account from onboarding draft.
 * Idempotent if the user already has a membership.
 * Accepts optional `client` (Prisma transaction client).
 */
async function provisionBusinessForOwner(
  userId,
  payload,
  workspaceMode,
  userMeta = {},
  options = {},
) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("Invalid user.");
  }

  const run = async (tx) => {
    const memberAgain = await tx.businessMember.findUnique({ where: { userId: uid } });
    if (memberAgain) {
      const biz = await tx.business.findUnique({ where: { id: memberAgain.businessId } });
      if (biz) return biz;
    }

    const name = String(payload.name ?? "").trim();
    const mobileNumber = String(payload.mobileNumber ?? "").trim();
    const openingBalanceNum = toMoneyDecimal(payload.openingCashBalance || 0);
    const startDate = payload.accountingStartDate
      ? new Date(payload.accountingStartDate)
      : new Date();
    const mode = workspaceMode === "financial" ? "financial" : "pos";

    const newBiz = await tx.business.create({
      data: {
        name,
        businessType: String(payload.businessType ?? "Mobile Shop").trim() || "Mobile Shop",
        businessCategory: payload.businessCategory ? String(payload.businessCategory).trim() : null,
        mobileNumber,
        whatsappNumber: payload.whatsappNumber ? String(payload.whatsappNumber).trim() : null,
        email: payload.email ? String(payload.email).trim() : null,
        address: payload.address ? String(payload.address).trim() : null,
        city: payload.city ? String(payload.city).trim() : null,
        area: payload.area ? String(payload.area).trim() : null,
        province: payload.province ? String(payload.province).trim() : null,
        accountingStartDate: startDate,
        openingCashBalance: openingBalanceNum,
        workspaceMode: mode,
        subscriptionStatus: options.subscriptionStatus || "trialing",
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ownerId: uid,
        ...(options.stripeCustomerId
          ? { stripeCustomerId: String(options.stripeCustomerId) }
          : {}),
        ...(options.stripeSubscriptionId
          ? { stripeSubscriptionId: String(options.stripeSubscriptionId) }
          : {}),
      },
    });

    await tx.businessMember.create({
      data: {
        businessId: newBiz.id,
        userId: uid,
        role: "owner",
      },
    });

    await tx.user.update({
      where: { id: uid },
      data: { role: "owner" },
    });

    try {
      await tx.branch.create({
        data: {
          businessId: newBiz.id,
          name: "Main Branch",
          address: payload.address ? String(payload.address).trim() : null,
          phone: mobileNumber,
          isMain: true,
          isActive: true,
        },
      });
    } catch (branchErr) {
      console.warn("Branch creation notice:", branchErr.message);
    }

    // Source of truth for operational opening cash: Cash in hand account.
    await tx.account.create({
      data: {
        businessId: newBiz.id,
        name: "Cash in hand",
        type: "cash",
        openingBalance: openingBalanceNum,
      },
    });

    try {
      await tx.activityLog.create({
        data: {
          businessId: newBiz.id,
          action: "BUSINESS_SETUP",
          category: "Business",
          details: `Business '${newBiz.name}' activated after billing setup`,
          target: newBiz.name,
          meta: {
            businessType: newBiz.businessType,
            businessCategory: newBiz.businessCategory,
            openingCashBalance: Number(openingBalanceNum.toFixed(2)),
          },
          userId: uid,
          userName: userMeta.fullName || userMeta.name || "Owner",
          userEmail: userMeta.email || "",
          userRole: "owner",
        },
      });
    } catch (e) {
      console.warn("Log creation notice:", e.message);
    }

    return newBiz;
  };

  if (options.client) {
    return run(options.client);
  }

  const existingMember = await prisma.businessMember.findUnique({
    where: { userId: uid },
    include: { business: true },
  });
  if (existingMember?.business) {
    return existingMember.business;
  }

  return prisma.$transaction(async (tx) => run(tx));
}

module.exports = { provisionBusinessForOwner };
