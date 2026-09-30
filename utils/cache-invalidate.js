const { cacheInvalidateBusiness } = require("./ttl-cache");
const { logger } = require("./logger");

/** Fire-and-forget soft-cache bust after mutations that affect dashboards/reports. */
function invalidateBusinessCaches(businessId) {
  if (businessId == null) return;
  Promise.resolve()
    .then(() => cacheInvalidateBusiness(businessId))
    .catch((err) => logger.warn("cache invalidate failed:", err.message));
}

module.exports = { invalidateBusinessCaches };
