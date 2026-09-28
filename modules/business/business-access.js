const { prisma } = require("../../db");

async function getBusinessMembership(userId, businessId) {
  const uid = Number(userId);
  const bid = Number(businessId);
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(bid) || bid <= 0) {
    return null;
  }

  return prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: bid, userId: uid } },
  });
}

/** Any active member may read business details. */
async function assertBusinessMemberAccess(userId, businessId) {
  const membership = await getBusinessMembership(userId, businessId);
  if (!membership) {
    return {
      ok: false,
      status: 403,
      message: "You do not have access to this business.",
    };
  }
  return { ok: true, membership };
}

/** Mutations (settings, financial setup) require owner or business admin membership. */
async function assertBusinessManagementAccess(userId, businessId) {
  const membership = await getBusinessMembership(userId, businessId);
  if (!membership) {
    return {
      ok: false,
      status: 403,
      message: "You do not have access to manage this business.",
    };
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    return {
      ok: false,
      status: 403,
      message: "Only business owners or admins can perform this action.",
    };
  }
  return { ok: true, membership };
}

module.exports = {
  assertBusinessManagementAccess,
  assertBusinessMemberAccess,
  getBusinessMembership,
};
