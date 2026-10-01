require("dotenv").config();

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const http = require("http");

const { prisma, resetPrismaClient } = require("../../db");
const {
  claimMagicLinkToken,
  createMagicLinkToken,
  hashMagicLinkToken,
  magicLinkExpiry,
  magicLinkUrl,
  MagicLinkError,
} = require("../../modules/auth/magic-link.service");
const { verifyAccessToken } = require("../../modules/auth/token.service");

describe("magic link auth", () => {
  let testUser;
  let testEmail;
  const createdUserIds = [];

  before(async () => {
    process.env.AUTH_RATE_LIMIT_DISABLED = "true";
    process.env.NODE_ENV = "stress";
    process.env.STRESS_TEST = "true";

    testEmail = `magic-link-${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash("TestPass1", 10);
    testUser = await prisma.user.create({
      data: {
        email: testEmail,
        fullName: "Magic Link Tester",
        passwordHash,
        role: "pending",
      },
    });
    createdUserIds.push(testUser.id);
  });

  after(async () => {
    if (createdUserIds.length) {
      await prisma.magicLinkToken.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await resetPrismaClient();
  });

  it("builds magic link URL with token query param", () => {
    const url = magicLinkUrl("abc123");
    assert.match(url, /token=abc123/);
  });

  it("claims a valid token once and rejects reuse", async () => {
    const raw = createMagicLinkToken();
    await prisma.magicLinkToken.create({
      data: {
        userId: testUser.id,
        tokenHash: hashMagicLinkToken(raw),
        expiresAt: magicLinkExpiry(),
      },
    });

    const user = await claimMagicLinkToken(raw);
    assert.equal(user.id, testUser.id);
    assert.equal(user.email, testEmail);

    await assert.rejects(
      () => claimMagicLinkToken(raw),
      (error) => error instanceof MagicLinkError && error.code === "invalid",
    );
  });

  it("POST /auth/magic-link/verify returns JWT session", async () => {
    const { createApp } = require("../../app");
    const app = createApp();
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const raw = createMagicLinkToken();
    await prisma.magicLinkToken.create({
      data: {
        userId: testUser.id,
        tokenHash: hashMagicLinkToken(raw),
        expiresAt: magicLinkExpiry(),
      },
    });

    const response = await fetch(`http://127.0.0.1:${port}/auth/magic-link/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: raw }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.token);
    assert.equal(body.user.email, testEmail);

    const payload = verifyAccessToken(body.token);
    assert.equal(payload.id, testUser.id);

    await new Promise((resolve) => server.close(resolve));
  });

  it("POST /auth/magic-link/request returns generic success", async () => {
    const { createApp } = require("../../app");
    const app = createApp();
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const known = await fetch(`http://127.0.0.1:${port}/auth/magic-link/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail }),
    });
    assert.equal(known.status, 200);
    const knownBody = await known.json();
    assert.match(knownBody.message, /sign-in link/i);

    const unknown = await fetch(`http://127.0.0.1:${port}/auth/magic-link/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    assert.equal(unknown.status, 200);
    const unknownBody = await unknown.json();
    assert.equal(unknownBody.message, knownBody.message);

    await new Promise((resolve) => server.close(resolve));
  });
});
