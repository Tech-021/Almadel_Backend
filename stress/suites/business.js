const { PASSWORD } = require("../lib/constants");
const { phoneFor } = require("../lib/anchor");
const { requestJson } = require("../lib/http");
const { runCountedStages } = require("../lib/stages");

/**
 * Full new-owner journey under stress:
 * 1) POST /auth/sign-up  → User.role = pending
 * 2) POST /business/setup → onboarding draft only
 * 3) POST /billing/stress-complete-onboarding → create Business + owner membership
 *    (stress-only stand-in for successful Stripe checkout)
 */
async function runBusinessSuite(config, runSalt) {
  return runCountedStages({
    config,
    test: "business-create",
    scenario:
      "API load for new-owner activation: sign-up → business draft → stress Stripe fulfill (creates live business + owner membership).",
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
        return {
          ...signup,
          latencyMs: performance.now() - started,
          parts: { signupMs: signup.latencyMs, setupMs: 0, fulfillMs: 0 },
          signupRole: signup.json?.user?.role || null,
        };
      }

      const setup = await requestJson(config, {
        method: "POST",
        path: "/business/setup",
        token: signup.json.token,
        body: {
          name: `loadtest_business_${runSalt}_${String(sequence).padStart(6, "0")}`,
          mobileNumber: phoneFor(runSalt, sequence),
          businessType: "Mobile Shop",
          workspaceMode: "pos",
        },
      });
      if (!setup.ok) {
        return {
          ...setup,
          latencyMs: performance.now() - started,
          parts: { signupMs: signup.latencyMs, setupMs: setup.latencyMs, fillMs: 0, fulfillMs: 0 },
          signupRole: signup.json?.user?.role || null,
        };
      }

      const fulfill = await requestJson(config, {
        method: "POST",
        path: "/billing/stress-complete-onboarding",
        token: signup.json.token,
      });

      return {
        ...fulfill,
        latencyMs: performance.now() - started,
        parts: {
          signupMs: signup.latencyMs,
          setupMs: setup.latencyMs,
          fulfillMs: fulfill.latencyMs,
        },
        signupRole: signup.json?.user?.role || null,
        businessId: fulfill.json?.business?.id || null,
      };
    },
  });
}

module.exports = { runBusinessSuite };
