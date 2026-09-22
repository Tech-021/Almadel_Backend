/* Socket.IO connection/load test.
 *
 * Safe local default: SOCKET_TEST_STAGES=100,500,1000
 * For 10k/30k, run distributed load generators.
 */
const { io } = require("socket.io-client");

const baseUrl = (process.env.SOCKET_TEST_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const businessId = process.env.SOCKET_TEST_BUSINESS_ID;
const stages = (process.env.SOCKET_TEST_STAGES || "100,500,1000")
  .split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
const holdSeconds = Number(process.env.SOCKET_TEST_HOLD_SECONDS || 30);
const rampMs = Number(process.env.SOCKET_TEST_RAMP_MS || 10);
const eventName = process.env.SOCKET_TEST_EVENT || "product.created";
const users = JSON.parse(process.env.SOCKET_TEST_USERS_JSON || "[]");

if (!businessId) throw new Error("Set SOCKET_TEST_BUSINESS_ID.");
if (!users.length && (!process.env.SOCKET_TEST_EMAIL || !process.env.SOCKET_TEST_PASSWORD)) {
  throw new Error("Set SOCKET_TEST_EMAIL and SOCKET_TEST_PASSWORD, or SOCKET_TEST_USERS_JSON.");
}

const sockets = new Set();
let connected = 0;
let failed = 0;
let received = 0;

async function tokenFor(user) {
  const response = await fetch(`${baseUrl}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) throw new Error(`Sign-in failed for ${user.email}: ${response.status}`);
  return body.token;
}

function addClient(token) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 10000,
    auth: { token, businessId: String(businessId) },
  });
  sockets.add(socket);
  socket.on("connect", () => { connected += 1; });
  socket.on("connect_error", () => { failed += 1; });
  socket.on(eventName, () => { received += 1; });
  socket.on("disconnect", () => { connected = Math.max(0, connected - 1); });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const credentials = users.length ? users : [{
    email: process.env.SOCKET_TEST_EMAIL,
    password: process.env.SOCKET_TEST_PASSWORD,
  }];
  const tokens = await Promise.all(credentials.map(tokenFor));
  let target = 0;

  for (const nextTarget of stages) {
    if (nextTarget < target) continue;
    const add = nextTarget - target;
    console.log(`Ramping from ${target} to ${nextTarget} connections...`);
    for (let i = 0; i < add; i += 1) {
      addClient(tokens[i % tokens.length]);
      if (rampMs) await sleep(rampMs);
    }
    target = nextTarget;
    await sleep(5000);
    console.log(JSON.stringify({ target, connected, failed, eventName, received }));
    await sleep(holdSeconds * 1000);
  }

  console.log(JSON.stringify({ finalTarget: target, connected, failed, eventName, received }));
  for (const socket of sockets) socket.disconnect();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


