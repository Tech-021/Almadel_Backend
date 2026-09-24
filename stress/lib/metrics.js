function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function summarizeSamples(samples, extra = {}) {
  const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const successful = samples.filter((sample) => sample.ok).length;
  const failed = samples.length - successful;
  const statusCodes = {};
  const errorGroups = {};
  let bytes = 0;
  let timeoutCount = 0;

  for (const sample of samples) {
    const code = String(sample.status || (sample.ok ? 200 : "error"));
    statusCodes[code] = (statusCodes[code] || 0) + 1;
    bytes += sample.bytes || 0;
    if (sample.errorClass === "timeout") timeoutCount += 1;
    if (!sample.ok) {
      const key = sample.errorClass || "unknown";
      if (!errorGroups[key]) {
        errorGroups[key] = { count: 0, example: sample.errorMessage || "" };
      }
      errorGroups[key].count += 1;
    }
  }

  const sum = latencies.reduce((total, value) => total + value, 0);
  const elapsedMs = extra.elapsedMs || 0;

  return {
    requests: samples.length,
    successful,
    failed,
    errorRate: samples.length === 0 ? 0 : failed / samples.length,
    requestsPerSecond: elapsedMs > 0 ? Number(((samples.length / elapsedMs) * 1000).toFixed(2)) : 0,
    bytes,
    timeoutCount,
    latency: {
      minMs: latencies[0] || 0,
      averageMs: latencies.length ? Math.round(sum / latencies.length) : 0,
      medianMs: Math.round(percentile(latencies, 50)),
      p90Ms: Math.round(percentile(latencies, 90)),
      p95Ms: Math.round(percentile(latencies, 95)),
      p99Ms: Math.round(percentile(latencies, 99)),
      maxMs: latencies[latencies.length - 1] || 0,
    },
    statusCodes,
    errorGroups,
    ...extra,
  };
}

function classifyStatus(status, message = "") {
  const text = String(message || "");
  if (status === 409 || /already exists|unique|duplicate/i.test(text)) return "constraint";
  if (status === 400) return "validation";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  return "http";
}

function classifyNetworkError(error) {
  const code = error?.cause?.code || error?.code || "";
  const message = error?.message || String(error);
  if (error?.name === "TimeoutError" || error?.name === "AbortError" || /timeout/i.test(message)) {
    return { errorClass: "timeout", errorMessage: message };
  }
  if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(message)) {
    return { errorClass: "connection-refused", errorMessage: message };
  }
  if (code === "ECONNRESET" || /ECONNRESET|socket hang up/i.test(message)) {
    return { errorClass: "connection-reset", errorMessage: message };
  }
  return { errorClass: "network", errorMessage: message };
}

function gradeStage(stage, thresholds) {
  if (stage.integrityFailed) return "FAIL";
  if (stage.requests === 0) return "FAIL";
  if (stage.errorRate > 0.05 || stage.latency.p95Ms > 3000) return "FAIL";
  if (stage.errorRate >= 0.01 || stage.latency.p95Ms >= 1000) return "WARNING";
  if (thresholds && (stage.errorRate > thresholds.maxErrorRate || stage.latency.p95Ms > thresholds.maxP95Ms)) {
    return "FAIL";
  }
  return "PASS";
}

module.exports = {
  classifyNetworkError,
  classifyStatus,
  gradeStage,
  percentile,
  summarizeSamples,
};
