/**
 * Optional Elasticsearch complement for product search / analytics.
 * When ELASTICSEARCH_URL is unset, callers fall back to PostgreSQL (Prisma).
 */

const { logger } = require("../../utils/logger");

function isElasticsearchEnabled() {
  return Boolean(String(process.env.ELASTICSEARCH_URL || "").trim());
}

function baseUrl() {
  return String(process.env.ELASTICSEARCH_URL || "").trim().replace(/\/$/, "");
}

function productsIndex() {
  return process.env.ELASTICSEARCH_PRODUCTS_INDEX || "almadel-products";
}

async function esRequest(path, options = {}) {
  const url = `${baseUrl()}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const apiKey = process.env.ELASTICSEARCH_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `ApiKey ${apiKey}`;
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(Number(process.env.ELASTICSEARCH_TIMEOUT_MS || 3000)),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Elasticsearch ${response.status}: ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function pingElasticsearch() {
  if (!isElasticsearchEnabled()) {
    return { enabled: false, ok: true };
  }
  try {
    await esRequest("/");
    return { enabled: true, ok: true };
  } catch (error) {
    logger.warn("Elasticsearch ping failed:", error.message);
    return { enabled: true, ok: false, error: error.message };
  }
}

/**
 * Full-text product search (tenant scoped). Returns null → use Postgres fallback.
 */
async function searchProductsElasticsearch({ businessId, query, limit = 50 }) {
  if (!isElasticsearchEnabled()) {
    return null;
  }

  const q = String(query || "").trim();
  if (!q) {
    return { ids: [] };
  }

  try {
    const body = {
      size: limit,
      query: {
        bool: {
          filter: [{ term: { businessId: Number(businessId) } }],
          must: [
            {
              multi_match: {
                query: q,
                fields: ["name^3", "barcode^2", "sku", "category", "qrCode"],
                type: "best_fields",
                fuzziness: "AUTO",
              },
            },
          ],
        },
      },
    };

    const result = await esRequest(`/${productsIndex()}/_search`, {
      method: "POST",
      body,
    });

    const ids = (result.hits?.hits || [])
      .map((hit) => Number(hit._source?.id ?? hit._id))
      .filter((id) => Number.isInteger(id) && id > 0);

    return { ids };
  } catch (error) {
    logger.warn("Elasticsearch search failed, use Postgres fallback:", error.message);
    return null;
  }
}

module.exports = {
  isElasticsearchEnabled,
  pingElasticsearch,
  searchProductsElasticsearch,
};
