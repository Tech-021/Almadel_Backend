require("dotenv").config();

const assert = require("node:assert/strict");
const http = require("http");
const { describe, it, before, after } = require("node:test");
const bcrypt = require("bcryptjs");

const { prisma, resetPrismaClient } = require("../../db");
const { createAccessToken } = require("../../modules/auth/token.service");

describe("passkey API", () => {
  let port;
  let server;
  let token;
  let userId;

  before(async () => {
    process.env.AUTH_RATE_LIMIT_DISABLED = "true";
    process.env.ENABLE_PASSKEY = "true";
    process.env.WEBAUTHN_RP_ID = "localhost";
    process.env.WEBAUTHN_ORIGINS = "http://127.0.0.1";
    process.env.CORS_ORIGINS = "http://127.0.0.1";

    const email = `passkey-test-${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash("TestPass_12345", 10);
    const user = await prisma.user.create({
      data: {
        email,
        fullName: "Passkey Test",
        passwordHash,
        role: "pending",
      },
    });
    userId = user.id;
    token = createAccessToken(user);

    const { createApp } = require("../../app");
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  after(async () => {
    const { _resetRedisForTests } = require("../../utils/redis");
    await prisma.passkeyCredential.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await new Promise((resolve) => server.close(resolve));
    await _resetRedisForTests?.();
    await resetPrismaClient();
  });

  it("register options requires auth", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/auth/passkey/register/options`, {
      method: "POST",
      headers: { Origin: "http://127.0.0.1" },
    });
    assert.equal(response.status, 401);
  });

  it("POST /auth/passkey/register/options returns WebAuthn options", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/auth/passkey/register/options`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "http://127.0.0.1",
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.challenge);
    assert.equal(body.rp.id, "localhost");
  });

  it("POST /auth/passkey/sign-in/options returns challenge", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/auth/passkey/sign-in/options`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
      },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.challenge);
  });
});
