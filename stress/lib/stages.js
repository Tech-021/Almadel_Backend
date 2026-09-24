const { concurrencyForStage } = require("./config");
const { gradeStage, summarizeSamples } = require("./metrics");
const { runPool } = require("./http");

async function runCountedStages({
  config,
  test,
  counts,
  scenario,
  makeItem,
  worker,
}) {
  const stages = [];
  let created = 0;
  let aborted = null;

  for (let index = 0; index < counts.length; index += 1) {
    const target = counts[index];
    const needed = target - created;
    if (needed <= 0) continue;

    const concurrency = concurrencyForStage(index, config.profile);
    const items = Array.from({ length: needed }, (_, offset) => makeItem(created + offset + 1));
    const samples = [];
    let stopReason = null;
    const started = performance.now();

    const shouldStop = () => Boolean(stopReason);

    await runPool(items, concurrency, async (item) => {
      if (stopReason) return null;
      const sample = await worker(item);
      samples.push(sample);
      if (samples.length >= 20 && samples.length % 25 === 0) {
        const failed = samples.filter((entry) => !entry.ok).length;
        const refused = samples.filter((entry) => entry.errorClass === "connection-refused").length;
        if (failed / samples.length > config.maxErrorRate) {
          stopReason = `error rate exceeded ${config.maxErrorRate}`;
        } else if (refused >= 5) {
          stopReason = "repeated connection refused";
        }
      }
      return sample;
    }, shouldStop);

    const elapsedMs = performance.now() - started;
    const summary = summarizeSamples(samples, {
      test,
      scenario,
      stage: String(target),
      target,
      concurrency,
      elapsedMs,
    });
    const roles = ["staff", "accountant"];
    if (samples.some((sample) => sample.role)) {
      summary.byRole = Object.fromEntries(
        roles.map((role) => [
          role,
          summarizeSamples(
            samples.filter((sample) => sample.role === role),
            { role },
          ),
        ]),
      );
    }
    if (samples.some((sample) => sample.parts)) {
      const average = (values) =>
        values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
      summary.parts = {
        signupAvgMs: average(samples.map((sample) => sample.parts?.signupMs || 0)),
        setupAvgMs: average(samples.map((sample) => sample.parts?.setupMs || 0)),
      };
    }
    summary.grade = gradeStage(summary, config);
    summary.stoppedEarly = Boolean(stopReason);
    stages.push(summary);
    created += summary.successful;

    if (stopReason || summary.latency.p95Ms > config.maxP95Ms || summary.errorRate > config.maxErrorRate) {
      aborted = {
        test,
        stage: String(target),
        concurrency,
        requestsPerSecond: summary.requestsPerSecond,
        errorRate: summary.errorRate,
        p95Ms: summary.latency.p95Ms,
        p99Ms: summary.latency.p99Ms,
        reason: stopReason || (summary.errorRate > config.maxErrorRate
          ? `error rate ${summary.errorRate.toFixed(3)} exceeded ${config.maxErrorRate}`
          : `p95 ${summary.latency.p95Ms}ms exceeded ${config.maxP95Ms}ms`),
        dominantErrors: summary.errorGroups,
        at: new Date().toISOString(),
      };
      break;
    }
  }

  return { stages, aborted, created };
}

module.exports = { runCountedStages };
