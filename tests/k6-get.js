import { createSuite } from "./k6-common.js";

const apiCases = [
  { id: "health", method: "GET", path: "/health", requiresAuth: false, responseType: "object" },
  { id: "my-businesses", method: "GET", path: "/business/my-businesses", responseType: "object" },
  { id: "products-list", method: "GET", path: "/products", responseType: "array" },
  { id: "products-search", method: "GET", path: "/products/search?q=test", responseType: "object" },
  {
    id: "products-barcode",
    method: "GET",
    path: `/products/barcode/${encodeURIComponent(__ENV.API_TEST_BARCODE || "k6-no-match")}`,
  },
  { id: "dashboard-me", method: "GET", path: "/dashboard/me", responseType: "object" },
  { id: "dashboard-admin", method: "GET", path: "/dashboard/", responseType: "object" },
  { id: "customers-list", method: "GET", path: "/customers", responseType: "object" },
  { id: "admin-staff", method: "GET", path: "/admin/staff", responseType: "object" },
  { id: "admin-logs", method: "GET", path: "/admin/logs", responseType: "object" },
];

if (__ENV.API_TEST_BUSINESS_ID) {
  apiCases.push({
    id: "business-details",
    method: "GET",
    path: `/business/${encodeURIComponent(__ENV.API_TEST_BUSINESS_ID)}`,
    responseType: "object",
  });
}

if (__ENV.API_TEST_SALE_ID) {
  apiCases.push({
    id: "sale-invoice",
    method: "GET",
    path: `/sales/${encodeURIComponent(__ENV.API_TEST_SALE_ID)}`,
    responseType: "object",
  });
}

const suite = createSuite(apiCases);
export const options = suite.options;
export const setup = suite.setup;
export const runEndpoint = suite.runEndpoint;
