const { PASSWORD } = require("../lib/constants");
const { phoneFor } = require("../lib/anchor");
const { requestJson } = require("../lib/http");
const { runCountedStages } = require("../lib/stages");

async function runBusinessSuite(config, runSalt) {
  return runCountedStages({
    config,
    test: "business-create",
    scenario: "API load. Each request signs up a new owner and calls POST /business/setup. No staff or products are attached.",
    counts: config.profile.businessCounts,
    makeItem: (sequence) => sequence,
    worker: async (sequence) => {
      const email = `loadtest_business_${runSalt}_${String(sequence).padStart(6, "0")}@example.test`;
      const started = performance.now();
      const signup = await requestJson(config, {
        method: "POST",
        path: "/auth/sign-up",
        body: { email, password: PASSWORD, fullName: `Loadtest Owner ${sequence}` },
      });
      if (!signup.ok) {
        return { ...signup, latencyMs: performance.now() - started, parts: { signupMs: signup.latencyMs, setupMs: 0 } };
      }

      const setup = await requestJson(config, {
        method: "POST",
        path: "/business/setup",
        token: signup.json.token,
        body: {
          name: `loadtest_business_${runSalt}_${String(sequence).padStart(6, "0")}`,
          mobileNumber: phoneFor(runSalt, sequence),
          businessType: "Mobile Shop",
        },
      });
      return {
        ...setup,
        latencyMs: performance.now() - started,
        parts: { signupMs: signup.latencyMs, setupMs: setup.latencyMs },
      };
    },
  });
}

module.exports = { runBusinessSuite };
