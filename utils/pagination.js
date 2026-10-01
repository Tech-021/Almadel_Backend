/**
 * Shared list pagination helpers.
 * page is 1-based; limit is hard-capped to avoid unbounded responses.
 */

function parsePagination(query, { defaultLimit = 50, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(String(query?.page ?? "1"), 10) || 1);
  const rawLimit = query?.limit;
  const parsed =
    rawLimit === undefined || rawLimit === "" || rawLimit === null
      ? defaultLimit
      : Number.parseInt(String(rawLimit), 10);
  const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(parsed) ? parsed : defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function paginationMeta(page, limit, total) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  return {
    page,
    limit,
    total: safeTotal,
    totalPages: limit > 0 ? Math.max(1, Math.ceil(safeTotal / limit)) : 1,
  };
}

module.exports = { parsePagination, paginationMeta };
