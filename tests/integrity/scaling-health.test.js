require("dotenv").config();

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

describe("scaling health endpoints", () => {
  /** @type {import("http").Server | null} */
  let server = null;

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    const { _resetRedisForTests } = require("../../utils/redis");
    const { resetPrismaClient } = require("../../db");
    await _resetRedisForTests();
    await resetPrismaClient();
  });

  it("GET /health and /health/ready respond", async () => {
    const { createApp } = require("../../app");
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(live.status, 200);

    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.ok([200, 503].includes(ready.status));
    const body = await ready.json();
    assert.equal(typeof body.ok, "boolean");
    assert.ok(body.db);
  });
});
