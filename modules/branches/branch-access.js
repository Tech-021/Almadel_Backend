/**
 * Resolves a branch for the active business.
 * Caller-supplied branchId must belong to businessId and be active.
 * When omitted, falls back to the main active branch for that business.
 */
async function resolveBusinessBranchId(tx, businessId, branchIdInput) {
  const bizId = Number(businessId);
  if (!Number.isInteger(bizId) || bizId <= 0) {
    throw new Error("Active business is required.");
  }

  if (!tx.branch) {
    return undefined;
  }

  if (branchIdInput != null && branchIdInput !== "") {
    const branchId = Number(branchIdInput);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      throw new Error("Invalid branch id.");
    }

    const branch = await tx.branch.findFirst({
      where: { id: branchId, businessId: bizId, isActive: true },
      select: { id: true },
    });

    if (!branch) {
      throw new Error("Branch not found for this business.");
    }

    return branch.id;
  }

  const mainBranch = await tx.branch.findFirst({
    where: { businessId: bizId, isMain: true, isActive: true },
    select: { id: true },
  });

  return mainBranch?.id;
}

module.exports = { resolveBusinessBranchId };
