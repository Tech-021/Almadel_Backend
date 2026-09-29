/**
 * Tiny in-process TTL cache for hot read endpoints (dashboard / reports).
 * Not shared across instances; safe as a short-lived soft cache.
 */

const store = new Map();

function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs = 30000) {
  store.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
  // Opportunistic cleanup when the map grows
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now > v.expiresAt) store.delete(k);
    }
  }
}

module.exports = { cacheGet, cacheSet };
