import http from "k6/http";
import exec from "k6/execution";
import { createSuite } from "./k6-common.js";

// POST endpoints that write data are opt-in. Set API_TEST_ENABLE_MUTATIONS=true
// and select cases with API_TEST_POST_ENDPOINTS or legacy per-case flags.
const mutationsEnabled = __ENV.API_TEST_ENABLE_MUTATIONS === "true";
const selectedEndpoints = new Set(
  (__ENV.API_TEST_POST_ENDPOINTS || "")
    .split(",")
    .map((endpoint) => endpoint.trim().toLowerCase())
    .filter(Boolean),
);
const hasEndpointSelection = selectedEndpoints.size > 0;
const isEnabled = (name, endpointId) =>
  mutationsEnabled &&
  (hasEndpointSelection
    ? selectedEndpoints.has("all") || selectedEndpoints.has(endpointId)
    : __ENV[name] === "true");
const DEFAULT_ITERATIONS = Number(__ENV.API_TEST_ITERATIONS || 1000);
const DEFAULT_VUS = Number(__ENV.API_TEST_VUS || 1000);
const uniqueSuffix = () => `${Date.now()}-${exec.vu.idInTest}-${exec.vu.iterationInScenario}`;
const uniqueMobile = () => `+1555${exec.vu.idInTest}${exec.vu.iterationInScenario}`;
const uniqueEmail = (configuredEmail, prefix) => {
  const suffix = uniqueSuffix();
  if (configuredEmail && configuredEmail.includes("@")) {
    const [localPart, domain] = configuredEmail.split("@");
    return `${localPart}+${suffix}@${domain}`;
  }
  return `${prefix}-${suffix}@example.test`;
};
const testPassword = __ENV.API_TEST_NEW_PASSWORD || "K6-Test-Password-123!";
const imageFile = http.file(
  open("./fixtures/k6-test-image.png", "b"),
  "k6-test-image.png",
  "image/png",
);

const writeCase = (test) => ({
  enabled: false,
  executor: "per-vu-iterations",
  iterations: DEFAULT_ITERATIONS,
  vus: DEFAULT_VUS,
  ...test,
});

const apiCases = [
  // Only stress sign-in when selected; setup still signs in once.
  {
    id: "auth-sign-in",
    method: "POST",
    path: "/auth/sign-in",
    requiresAuth: false,
    enabled: hasEndpointSelection
      ? selectedEndpoints.has("all") || selectedEndpoints.has("auth-sign-in")
      : true,
    executor: "per-vu-iterations",
    body: { email: __ENV.API_TEST_EMAIL, password: __ENV.API_TEST_PASSWORD },
    responseType: "object",
  },
  writeCase({
    id: "auth-staff-sign-up",
    method: "POST",
    path: "/auth/staff/sign-up",
    requiresAuth: false,
    enabled: isEnabled("API_TEST_POST_SIGNUP", "auth-staff-sign-up"),
    bodyFactory: () => ({
      fullName: "k6 test owner",
      email: uniqueEmail(__ENV.API_TEST_SIGNUP_EMAIL, "k6-owner"),
      password: testPassword,
    }),
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "auth-sign-up-alias",
    method: "POST",
    path: "/auth/sign-up",
    requiresAuth: false,
    enabled: isEnabled("API_TEST_POST_SIGNUP_ALIAS", "auth-sign-up-alias"),
    bodyFactory: () => ({
      fullName: "k6 test owner alias",
      email: `k6-owner-alias-${uniqueSuffix()}@example.test`,
      password: testPassword,
    }),
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "auth-owner-sign-up-alias",
    method: "POST",
    path: "/auth/owner/sign-up",
    requiresAuth: false,
    enabled: isEnabled("API_TEST_POST_OWNER_SIGNUP_ALIAS", "auth-owner-sign-up-alias"),
    bodyFactory: () => ({
      fullName: "k6 test owner alias",
      email: `k6-owner-owner-alias-${uniqueSuffix()}@example.test`,
      password: testPassword,
    }),
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "auth-forgot-password",
    method: "POST",
    path: "/auth/forgot-password",
    requiresAuth: false,
    enabled: isEnabled("API_TEST_POST_FORGOT_PASSWORD", "auth-forgot-password"),
    body: { email: __ENV.API_TEST_FORGOT_EMAIL || __ENV.API_TEST_EMAIL },
    executor: "shared-iterations",
    iterations: 1,
    vus: 1,
    responseType: "object",
  }),
  writeCase({
    id: "auth-reset-password",
    method: "POST",
    path: "/auth/reset-password",
    requiresAuth: false,
    enabled: isEnabled("API_TEST_POST_RESET_PASSWORD", "auth-reset-password") && Boolean(__ENV.API_TEST_RESET_TOKEN),
    body: { token: __ENV.API_TEST_RESET_TOKEN, password: testPassword },
    executor: "shared-iterations",
    iterations: 1,
    vus: 1,
    responseType: "object",
  }),
  writeCase({
    id: "products-create",
    method: "POST",
    path: "/products",
    enabled: isEnabled("API_TEST_POST_CREATE_PRODUCT", "products-create"),
    bodyFactory: () => ({
      barcode: `${__ENV.API_TEST_PRODUCT_BARCODE || "K6"}-${uniqueSuffix()}`,
      name: "k6 test product",
      category: "k6 test",
      costPrice: 0.5,
      sellingPrice: 1,
      stock: Number(__ENV.API_TEST_PRODUCT_INITIAL_STOCK || 10),
      lowStockThreshold: 1,
    }),
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "products-upload-image",
    method: "POST",
    path: "/products/images",
    enabled: isEnabled("API_TEST_POST_PRODUCT_IMAGE", "products-upload-image"),
    body: { image: imageFile },
    multipart: true,
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "products-import",
    method: "POST",
    path: "/products/import",
    enabled: isEnabled("API_TEST_POST_IMPORT_PRODUCTS", "products-import"),
    bodyFactory: () => ({
      products: [{
        barcode: `K6-IMPORT-${uniqueSuffix()}`,
        name: "k6 imported test product",
        category: "k6 test",
        costPrice: 0.5,
        sellingPrice: 1,
        stock: 10,
        lowStockThreshold: 1,
      }],
    }),
    responseType: "object",
  }),
  writeCase({
    id: "stock-receive-one",
    method: "POST",
    path: "/stock/receive-one",
    enabled: isEnabled("API_TEST_POST_RECEIVE_STOCK", "stock-receive-one") && Boolean(__ENV.API_TEST_PRODUCT_BARCODE),
    body: { barcode: __ENV.API_TEST_PRODUCT_BARCODE },
    responseType: "object",
  }),
  writeCase({
    id: "stock-add",
    method: "POST",
    path: "/stock/add",
    enabled: isEnabled("API_TEST_POST_ADD_STOCK", "stock-add") && Boolean(__ENV.API_TEST_PRODUCT_BARCODE),
    body: {
      barcode: __ENV.API_TEST_PRODUCT_BARCODE,
      quantity: Number(__ENV.API_TEST_STOCK_QUANTITY || 1),
      note: "k6 stock API test",
    },
    responseType: "object",
  }),
  writeCase({
    id: "sales-checkout",
    method: "POST",
    path: "/sales/checkout",
    enabled: isEnabled("API_TEST_POST_CHECKOUT", "sales-checkout") && Boolean(__ENV.API_TEST_PRODUCT_BARCODE),
    body: {
      items: [{
        barcode: __ENV.API_TEST_PRODUCT_BARCODE,
        quantity: Number(__ENV.API_TEST_CHECKOUT_QUANTITY || 1),
      }],
      discountType: "none",
      discountValue: 0,
      paymentMethod: "cash",
    },
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "customers-create",
    method: "POST",
    path: "/customers",
    enabled: isEnabled("API_TEST_POST_CREATE_CUSTOMER", "customers-create"),
    bodyFactory: () => ({ name: "k6 test customer", mobile: uniqueMobile() }),
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "admin-staff-create",
    method: "POST",
    path: "/admin/staff",
    enabled: isEnabled("API_TEST_POST_CREATE_STAFF", "admin-staff-create"),
    bodyFactory: () => ({
      fullName: "k6 test staff",
      email: uniqueEmail(__ENV.API_TEST_STAFF_EMAIL, "k6-staff"),
      password: testPassword,
    }),
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "business-setup",
    method: "POST",
    path: "/business/setup",
    enabled: isEnabled("API_TEST_POST_BUSINESS_SETUP", "business-setup"),
    bodyFactory: () => ({
      name: `k6 test business ${uniqueSuffix()}`,
      businessType: "Mobile Shop",
      mobileNumber: `+92300${uniqueMobile().slice(1)}`,
      email: `k6-business-${uniqueSuffix()}@example.test`,
      city: "Test City",
      openingCashBalance: 0,
    }),
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "logs-create",
    method: "POST",
    path: "/logs",
    enabled: isEnabled("API_TEST_POST_CREATE_LOG", "logs-create"),
    bodyFactory: () => ({
      action: "K6_API_TEST",
      category: "Test",
      details: `k6 POST /logs load test ${uniqueSuffix()}`,
      target: "k6 test suite",
      meta: { source: "k6" },
    }),
    expectedStatus: 201,
    responseType: "object",
  }),
  writeCase({
    id: "admin-logs-create",
    method: "POST",
    path: "/admin/logs",
    enabled: isEnabled("API_TEST_POST_CREATE_ADMIN_LOG", "admin-logs-create"),
    bodyFactory: () => ({
      action: "K6_API_TEST",
      category: "Test",
      details: `k6 POST /admin/logs load test ${uniqueSuffix()}`,
      target: "k6 test suite",
      meta: { source: "k6" },
    }),
    expectedStatus: 201,
    responseType: "object",
  }),
];

const suite = createSuite(apiCases);
export const options = suite.options;
export const setup = suite.setup;
export const runEndpoint = suite.runEndpoint;
