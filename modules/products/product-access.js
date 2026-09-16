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

module.exports = { productAccessWhere };