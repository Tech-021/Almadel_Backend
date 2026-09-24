const bcrypt = require("bcryptjs");

const { PASSWORD } = require("../lib/constants");
const { requestJson } = require("../lib/http");
const { summarizeSamples } = require("../lib/metrics");
const { runCountedStages } = require("../lib/stages");

async function runTeamSuite(config, anchor, runSalt) {
  const rounds = Number(process.env.PASSWORD_HASH_ROUNDS ?? 10);
  const hashStarted = performance.now();
  const samples = 3;
  for (let i = 0; i < samples; i += 1) {
    await bcrypt.hash(PASSWORD, rounds);
  }
  const bcryptMeanMs = Math.round((performance.now() - hashStarted) / samples);

  const result = await runCountedStages({
    config,
    test: "team-create",
    scenario: "WORST-CASE SINGLE TENANT. One business. 50% staff and 50% accountant via POST /admin/staff.",
    counts: config.profile.teamCounts,
    makeItem: (sequence) => ({
      sequence,
      role: sequence % 2 === 0 ? "accountant" : "staff",
    }),
    worker: async (item) => {
      const response = await requestJson(config, {
        method: "POST",
        path: "/admin/staff",
        token: anchor.token,
        businessId: anchor.businessId,
        body: {
          email: `loadtest_${item.role}_${runSalt}_${String(item.sequence).padStart(6, "0")}@example.test`,
          password: PASSWORD,
          fullName: `Loadtest ${item.role} ${item.sequence}`,
          role: item.role,
        },
      });
      return { ...response, role: item.role };
    },
  });

  result.localBcrypt = {
    rounds,
    samples,
    meanMs: bcryptMeanMs,
    note: "Local bcrypt sample in the test process. It is not the server measurement. Compare it with endpoint latency.",
  };
  return result;
}

async function probeTeamList(config, anchor, concurrencyLevels) {
  const stages = [];
  for (const concurrency of concurrencyLevels) {
    const started = performance.now();
    const calls = Array.from({ length: concurrency }, () =>
      requestJson(config, {
        method: "GET",
        path: "/admin/staff",
        token: anchor.token,
        businessId: anchor.businessId,
      }),
    );
    const samples = await Promise.all(calls);
    const summary = summarizeSamples(samples, {
      test: "team-list",
      endpoint: "GET /admin/staff",
      concurrency,
      elapsedMs: performance.now() - started,
      paginated: false,
      rowsReturned: Array.isArray(samples[0]?.json?.staff) ? samples[0].json.staff.length : null,
    });
    stages.push(summary);
  }
  return stages;
}

module.exports = { probeTeamList, runTeamSuite };
