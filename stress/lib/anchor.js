const fs = require("fs");
const path = require("path");

const { ANCHOR_BUSINESS, ANCHOR_EMAIL, PASSWORD } = require("./constants");
const { requestJson } = require("./http");

function anchorPath(config) {
  return path.join(config.root, "stress", "runtime", "anchor.json");
}

function readAnchor(config) {
  const file = anchorPath(config);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeAnchor(config, anchor) {
  const file = anchorPath(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(anchor, null, 2));
  return anchor;
}

async function signIn(config, email, password = PASSWORD) {
  const response = await requestJson(config, {
    method: "POST",
    path: "/auth/sign-in",
    body: { email, password },
  });
  if (!response.ok || !response.json?.token) {
    throw new Error(`Sign-in failed for ${email}: ${response.status} ${response.errorMessage}`);
  }
  return response.json;
}

async function ensureAnchor(config) {
  const existing = readAnchor(config);
  if (existing?.token && existing?.businessId) {
    const probe = await requestJson(config, {
      method: "GET",
      path: "/business/my-businesses",
      token: existing.token,
      businessId: existing.businessId,
    });
    if (probe.ok) return existing;
  }

  let token;
  let userId;
  const signedUp = await requestJson(config, {
    method: "POST",
    path: "/auth/sign-up",
    body: {
      email: ANCHOR_EMAIL,
      password: PASSWORD,
      fullName: "Loadtest Anchor Owner",
    },
  });

  if (signedUp.ok) {
    token = signedUp.json.token;
    userId = signedUp.json.user?.id;
  } else if (signedUp.status === 409) {
    const signedIn = await signIn(config, ANCHOR_EMAIL);
    token = signedIn.token;
    userId = signedIn.user?.id;
    const businesses = signedIn.businesses || [];
    const match = businesses.find((business) => business.name === ANCHOR_BUSINESS) || businesses[0];
    if (match) {
      return writeAnchor(config, {
        email: ANCHOR_EMAIL,
        token,
        userId,
        businessId: match.id,
        businessName: match.name,
      });
    }
  } else {
    throw new Error(`Anchor sign-up failed: ${signedUp.status} ${signedUp.errorMessage}`);
  }

  const setup = await requestJson(config, {
    method: "POST",
    path: "/business/setup",
    token,
    body: {
      name: ANCHOR_BUSINESS,
      mobileNumber: "03001110001",
      businessType: "Mobile Shop",
    },
  });

  if (!setup.ok || !setup.json?.business?.id) {
    throw new Error(`Anchor business setup failed: ${setup.status} ${setup.errorMessage}`);
  }

  return writeAnchor(config, {
    email: ANCHOR_EMAIL,
    token,
    userId,
    businessId: setup.json.business.id,
    businessName: setup.json.business.name,
  });
}

async function assertApiUsesStressDatabase(config, prisma) {
  const health = await requestJson(config, { path: "/health" });
  if (!health.ok) {
    throw new Error(`API health check failed at ${config.baseUrl}: ${health.errorClass} ${health.errorMessage}`);
  }

  const email = `loadtest_probe_${Date.now()}@example.test`;
  const created = await requestJson(config, {
    method: "POST",
    path: "/auth/sign-up",
    body: { email, password: PASSWORD, fullName: "Loadtest Probe" },
  });
  if (!created.ok) {
    throw new Error(`Probe sign-up failed: ${created.status} ${created.errorMessage}`);
  }

  const row = await prisma.user.findUnique({ where: { email } });
  if (!row) {
    throw new Error(
      "The API did not write the probe user into almadel_stress. Refusing to continue because the server may be using another database.",
    );
  }
}

function phoneFor(runSalt, sequence) {
  const value = (runSalt % 10000) * 100000 + (sequence % 100000);
  return `03${String(value).padStart(9, "0")}`;
}

module.exports = {
  assertApiUsesStressDatabase,
  ensureAnchor,
  phoneFor,
  signIn,
};
