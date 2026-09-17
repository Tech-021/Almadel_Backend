import { createSuite } from "./k6-common.js";

const mutationEnabled = __ENV.API_TEST_ENABLE_MUTATIONS === "true";
const apiCases = [];

// Set the target ID and customize the body before enabling mutations.
if (mutationEnabled && __ENV.API_TEST_PRODUCT_ID) {
  apiCases.push({
    id: "products-update",
    method: "PATCH",
    path: `/products/${encodeURIComponent(__ENV.API_TEST_PRODUCT_ID)}`,
    body: {
      barcode: __ENV.API_TEST_PRODUCT_BARCODE || `K6-${Date.now()}`,
      name: "k6 updated test product",
      price: 1,
      stock: 10,
    },
    expectedStatus: 200,
    responseType: "object",
  });
}

if (mutationEnabled && __ENV.API_TEST_CUSTOMER_ID) {
  apiCases.push({
    id: "customers-update",
    method: "PATCH",
    path: `/customers/${encodeURIComponent(__ENV.API_TEST_CUSTOMER_ID)}`,
    body: { name: "k6 updated test customer" },
    expectedStatus: 200,
    responseType: "object",
  });
}

if (mutationEnabled && __ENV.API_TEST_STAFF_ID) {
  apiCases.push({
    id: "staff-update",
    method: "PATCH",
    path: `/admin/staff/${encodeURIComponent(__ENV.API_TEST_STAFF_ID)}`,
    body: { fullName: "k6 updated test staff" },
    expectedStatus: 200,
    responseType: "object",
  });
}

if (mutationEnabled && __ENV.API_TEST_BUSINESS_ID) {
  apiCases.push({
    id: "business-update",
    method: "PATCH",
    path: `/business/${encodeURIComponent(__ENV.API_TEST_BUSINESS_ID)}`,
    body: { name: "k6 updated test business" },
    expectedStatus: 200,
    responseType: "object",
  });
}

if (apiCases.length === 0) {
  console.warn("No PATCH cases enabled. Set API_TEST_ENABLE_MUTATIONS=true and a target ID to run a one-request update test.");
  apiCases.push({
    id: "patch-suite-preflight-only",
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
