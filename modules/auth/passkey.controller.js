const { prisma } = require("../../db");
const { formatBusinessSubscription } = require("../business/business.controller");
const { createAccessToken } = require("./token.service");
const { isPasskeyEnabled, passkeyPublicConfig } = require("../../utils/webauthn-config");
const {
  authenticationOptions,
  deleteCredentialForUser,
  listCredentialsForUser,
  registrationOptionsForUser,
  verifyAuthentication,
  verifyRegistrationForUser,
} = require("./passkey.service");

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

function businessesForUser(user) {
  return (user.businessMemberships || []).map((m) => ({
    ...formatBusinessSubscription(m.business),
    role: m.role,
    membershipRole: m.role,
  }));
}

async function sessionPayloadForUser(user) {
  const fullUser =
    user.businessMemberships !== undefined
      ? user
      : await prisma.user.findUnique({
          where: { id: user.id },
          include: {
            businessMemberships: {
              include: { business: true },
            },
          },
        });

  if (!fullUser) {
    return null;
  }

  const businesses = businessesForUser(fullUser);

  return {
    token: createAccessToken(fullUser),
    user: publicUser(fullUser),
    businesses,
    hasBusiness: businesses.length > 0,
    activeBusinessId: businesses[0]?.id || null,
  };
}

function passkeyDisabled(_req, res) {
  return res.status(503).json({
    message: "Passkey sign-in is not enabled on this server.",
  });
}

function requestOrigin(req) {
  return req.headers.origin || null;
}

async function passkeyRegisterOptions(req, res) {
  if (!isPasskeyEnabled()) {
    return passkeyDisabled(req, res);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.user.id) },
    });
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const attachment = String(req.body?.attachment ?? "").trim().toLowerCase();
    const hints =
      attachment === "platform" || attachment === "cross-platform"
        ? { attachment }
        : {};
    const options = await registrationOptionsForUser(user, requestOrigin(req), hints);
    return res.json(options);
  } catch (error) {
    if (error.code === "ORIGIN_NOT_ALLOWED") {
      return res.status(403).json({ message: error.message });
    }
    if (error.code === "P2021") {
      return res.status(503).json({
        message:
          "Passkey database table is missing. In Almadel_Backend run: npm run db:passkey (or npx prisma migrate deploy), then restart the API.",
      });
    }
    console.error("Passkey register options error:", error);
    const detail =
      process.env.NODE_ENV !== "production" && error?.message
        ? String(error.message).split("\n")[0]
        : null;
    return res.status(400).json({
      message: detail || "Could not start passkey registration.",
    });
  }
}

async function passkeyRegisterVerify(req, res) {
  if (!isPasskeyEnabled()) {
    return passkeyDisabled(req, res);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.user.id) },
    });
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    await verifyRegistrationForUser(user, req.body, requestOrigin(req));
    const credentials = await listCredentialsForUser(user.id);
    return res.json({
      message: "Passkey registered.",
      credentials,
    });
  } catch (error) {
    if (error.code === "ORIGIN_NOT_ALLOWED") {
      return res.status(403).json({ message: error.message });
    }
    console.error("Passkey register verify error:", error);
    return res.status(400).json({
      message: error.message || "Could not register passkey.",
    });
  }
}

async function passkeySignInOptions(req, res) {
  if (!isPasskeyEnabled()) {
    return passkeyDisabled(req, res);
  }

  try {
    const email = String(req.body.email ?? "")
      .trim()
      .toLowerCase();
    const options = await authenticationOptions(email || undefined, requestOrigin(req));
    return res.json(options);
  } catch (error) {
    if (error.code === "ORIGIN_NOT_ALLOWED") {
      return res.status(403).json({ message: error.message });
    }
    if (error.statusCode === 400 && error.message) {
      return res.status(400).json({ message: error.message });
    }
    console.error("Passkey sign-in options error:", error);
    return res.status(400).json({ message: "Could not start passkey sign-in." });
  }
}

async function passkeySignInVerify(req, res) {
  if (!isPasskeyEnabled()) {
    return passkeyDisabled(req, res);
  }

  try {
    const user = await verifyAuthentication(req.body, requestOrigin(req));
    const session = await sessionPayloadForUser(user);
    if (!session) {
      return res.status(400).json({ message: "Could not sign in with passkey." });
    }
    return res.json(session);
  } catch (error) {
    if (error.code === "ORIGIN_NOT_ALLOWED") {
      return res.status(403).json({ message: error.message });
    }
    console.error("Passkey sign-in verify error:", error);
    return res.status(401).json({
      message: error.message || "Passkey sign-in failed.",
    });
  }
}

async function passkeyConfig(_req, res) {
  return res.json(passkeyPublicConfig());
}

async function passkeyListCredentials(req, res) {
  if (!isPasskeyEnabled()) {
    return passkeyDisabled(req, res);
  }

  const credentials = await listCredentialsForUser(Number(req.user.id));
  return res.json({ credentials });
}

async function passkeyDeleteCredential(req, res) {
  if (!isPasskeyEnabled()) {
    return passkeyDisabled(req, res);
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid passkey id." });
  }

  const removed = await deleteCredentialForUser(Number(req.user.id), id);
  if (!removed) {
    return res.status(404).json({ message: "Passkey not found." });
  }

  return res.json({ message: "Passkey removed." });
}

module.exports = {
  passkeyConfig,
  passkeyDeleteCredential,
  passkeyListCredentials,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  passkeySignInOptions,
  passkeySignInVerify,
  publicUser,
  sessionPayloadForUser,
};
