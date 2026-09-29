/** Tenant scope + field-level ACL for product payloads (AUD-020). */

function productAccessWhere(reqOrUser, extraWhere = {}) {
  const businessId = reqOrUser?.businessId || extraWhere?.businessId;
  if (businessId) {
    return {
      ...extraWhere,
      businessId,
    };
  }
  return extraWhere;
}

/** Cost / margin fields: owner, store admin, or accountant membership only — not counter staff. */
function canViewCostPrice(req) {
  const role = req?.businessRole;
  return role === "owner" || role === "admin" || role === "accountant";
}

function serializeProduct(product, req) {
  if (!product) return product;
  const row = typeof product.toJSON === "function" ? product.toJSON() : { ...product };
  if (!canViewCostPrice(req)) {
    delete row.costPrice;
  }
  return row;
}

function serializeProducts(products, req) {
  if (!Array.isArray(products)) return products;
  return products.map((p) => serializeProduct(p, req));
}

module.exports = {
  canViewCostPrice,
  productAccessWhere,
  serializeProduct,
  serializeProducts,
};
