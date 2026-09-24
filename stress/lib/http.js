const { classifyNetworkError, classifyStatus } = require("./metrics");

async function requestJson(config, { method = "GET", path, token, businessId, body }) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (businessId) headers["x-business-id"] = String(businessId);

  const started = performance.now();
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await response.text();
    const latencyMs = performance.now() - started;
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const ok = response.status >= 200 && response.status < 300;
    return {
      ok,
      status: response.status,
      latencyMs,
      bytes: Buffer.byteLength(text),
      json,
      errorClass: ok ? null : classifyStatus(response.status, json?.message || text),
      errorMessage: ok ? "" : String(json?.message || text || response.statusText).slice(0, 300),
    };
  } catch (error) {
    const failure = classifyNetworkError(error);
    return {
      ok: false,
      status: 0,
      latencyMs: performance.now() - started,
      bytes: 0,
      json: null,
      ...failure,
    };
  }
}

async function runPool(items, concurrency, worker, shouldStop) {
  const results = new Array(items.length);
  let cursor = 0;

  async function loop() {
    while (cursor < items.length) {
      if (shouldStop && shouldStop()) return;
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => loop());
  await Promise.all(workers);
  return results.filter((result) => result !== undefined);
}

module.exports = { requestJson, runPool };
