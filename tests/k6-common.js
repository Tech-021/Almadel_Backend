import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";

const BASE_URL = __ENV.API_BASE_URL || "http://localhost:4000";
const EMAIL = __ENV.API_TEST_EMAIL;
const PASSWORD = __ENV.API_TEST_PASSWORD;
const DEFAULT_ITERATIONS = Number(__ENV.API_TEST_ITERATIONS || 1000);
const DEFAULT_VUS = Number(__ENV.API_TEST_VUS || 1000);

export function createSuite(apiCases) {
  const activeCases = apiCases.filter((test) => test.enabled !== false);
  const testsById = Object.fromEntries(apiCases.map((test) => [test.id, test]));
  const scenarios = Object.fromEntries(
    activeCases.map((test) => [
      test.id,
      {
        executor: test.executor ?? "per-vu-iterations",
        exec: "runEndpoint",
        vus: test.vus ?? DEFAULT_VUS,
        iterations: test.iterations ?? DEFAULT_ITERATIONS,
        maxDuration:
          test.maxDuration ??
          (test.executor === "per-vu-iterations" ? "30m" : "5m"),
      },
    ]),
  );

  return {
    options: {
      scenarios,
      thresholds: {
        http_req_failed: ["rate<0.01"],
        http_req_duration: ["p(95)<1000"],
      },
    },

    setup() {
      if (!EMAIL || !PASSWORD) {
        throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in the project .env file.");
      }

      const response = http.post(
        `${BASE_URL}/auth/sign-in`,
        JSON.stringify({ email: EMAIL, password: PASSWORD }),
        { headers: { "Content-Type": "application/json" }, tags: { endpoint: "sign-in" } },
      );

      const signedIn = check(response, {
        "sign-in returns 200": (res) => res.status === 200,
        "sign-in returns an access token": (res) => {
          if (res.status !== 200 || !res.body) return false;
          try {
            return Boolean(res.json("token"));
          } catch {
            return false;
          }
        },
      });

      if (!signedIn) {
        throw new Error(`Sign-in failed (${response.status}). Check credentials and API availability.`);
      }

      return { token: response.json("token") };
    },

    runEndpoint(data) {
      const test = testsById[exec.scenario.name];
      const headers = {};

      if (test.requiresAuth !== false) headers.Authorization = `Bearer ${data.token}`;
      const hasBody = test.body !== undefined || typeof test.bodyFactory === "function";
      const body = typeof test.bodyFactory === "function" ? test.bodyFactory() : test.body;
      const path = typeof test.pathFactory === "function" ? test.pathFactory() : test.path;

      if (hasBody && test.multipart !== true) {
        headers["Content-Type"] = "application/json";
      }

      const requestBody = !hasBody
        ? null
        : test.multipart === true
          ? body
          : JSON.stringify(body);

      const response = http.request(
        test.method,
        `${BASE_URL}${path}`,
        requestBody,
        { headers, tags: { endpoint: test.id, method: test.method } },
      );

      const expectedStatus = test.expectedStatus ?? 200;
      const checks = {
        [`${test.id} returns ${expectedStatus}`]: (res) => res.status === expectedStatus,
      };

      if (test.responseType) {
        checks[`${test.id} returns ${test.responseType} JSON`] = (res) => {
          try {
            const body = res.json();
            if (test.responseType === "array") return Array.isArray(body);
            if (test.responseType === "object") {
              return body !== null && typeof body === "object" && !Array.isArray(body);
            }
            return true;
          } catch {
            return false;
          }
        };
      }

      check(response, checks);
    },
  };
}
