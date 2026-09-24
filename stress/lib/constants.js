const PASSWORD = "StressTest1!";

const PREFIX = {
  apiEmail: "loadtest_",
  seedEmail: "stress_",
  apiBusiness: "loadtest_",
  seedBusiness: "stress_",
  apiBarcode: "LOADTEST-",
  seedBarcode: "STRESS-",
};

const ANCHOR_EMAIL = "loadtest_anchor_owner@example.test";
const ANCHOR_BUSINESS = "loadtest_anchor_business";
const SEED_OWNER_EMAIL = "stress_seed_owner@example.test";
const WORST_CASE_BUSINESS = "stress_worst_case_tenant";

module.exports = {
  ANCHOR_BUSINESS,
  ANCHOR_EMAIL,
  PASSWORD,
  PREFIX,
  SEED_OWNER_EMAIL,
  WORST_CASE_BUSINESS,
};
