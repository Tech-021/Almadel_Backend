import exec from "k6/execution";
import { createSuite } from "./k6-common.js";

const mutationEnabled = __ENV.API_TEST_ENABLE_MUTATIONS === "true";
const defaultVus = Number(__ENV.API_TEST_VUS || 1000);
const apiCases = [];

function addDeleteCase(id, pathPrefix, listVariable, singleVariable) {
  const ids = (__ENV[listVariable] || __ENV[singleVariable] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!mutationEnabled || ids.length === 0) return;

  apiCases.push({
    id,
    method: "DELETE",
    executor: "shared-iterations",
    pathFactory: () => `${pathPrefix}/${encodeURIComponent(ids[exec.scenario.iterationInTest])}`,
    expectedStatus: 200,
    iterations: ids.length,
    vus: Math.min(defaultVus, ids.length),
    responseType: "object",
  });
}

// For a concurrent delete test, provide a comma-separated list of distinct,
// disposable IDs. A single ID deliberately produces only one delete request.
addDeleteCase("products-delete", "/products", "API_TEST_DELETE_PRODUCT_IDS", "API_TEST_DELETE_PRODUCT_ID");
addDeleteCase("customers-delete", "/customers", "API_TEST_DELETE_CUSTOMER_IDS", "API_TEST_DELETE_CUSTOMER_ID");
addDeleteCase("staff-delete", "/admin/staff", "API_TEST_DELETE_STAFF_IDS", "API_TEST_DELETE_STAFF_ID");

if (apiCases.length === 0) {
  console.warn("No DELETE cases enabled. Provide disposable target IDs; list variables allow concurrent deletes of distinct records.");
  apiCases.push({
    id: "delete-suite-preflight-only",
    method: "GET",
    path: "/health",
    requiresAuth: false,
    iterations: 1,
    vus: 1,
  });
}

const suite = createSuite(apiCases);
export const options = suite.options;
export const setup = suite.setup;
export const runEndpoint = suite.runEndpoint;
