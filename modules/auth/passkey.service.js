const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} = require("@simplewebauthn/server");

const { prisma } = require("../../db");
const {
  assertOriginAllowed,
  resolveAuthenticatorSelection,
  resolveExpectedRpIds,
  resolveRpId,
  resolveRpName,
  resolveWebAuthnOrigins,
} = require("../../utils/webauthn-config");
const { redisDel, redisGetJson, redisSetJson } = require("../../utils/redis");

const CHALLENGE_TTL_SEC = 300;
const memoryChallenges = new Map();

function userHandleBuffer(userId) {
  return Buffer.from(String(userId), "utf8");
}

function challengeKey(challenge) {
  return `passkey:challenge:${challenge}`;
}

async function storeChallenge(challenge, payload) {
  const key = challengeKey(challenge);
  const ok = await redisSetJson(key, payload, CHALLENGE_TTL_SEC);
  if (!ok) {
    memoryChallenges.set(key, payload);
    setTimeout(() => memoryChallenges.delete(key), CHALLENGE_TTL_SEC * 1000);
  }
}

async function consumeChallenge(challenge) {
  const key = challengeKey(challenge);
  const fromRedis = await redisGetJson(key);
  if (fromRedis) {
    await redisDel(key);
    return fromRedis;
  }
  const fromMemory = memoryChallenges.get(key);
  memoryChallenges.delete(key);
  return fromMemory;
}

function credentialIdToBase64(credentialId) {
  if (typeof credentialId === "string") {
    return credentialId;
  }
  return Buffer.from(credentialId).toString("base64url");
}

async function listCredentialsForUser(userId) {
  return prisma.passkeyCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      friendlyName: true,
      deviceType: true,
      backedUp: true,
      transports: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
}

function mapAllowCredentials(creds) {
  if (!creds?.length) {
    return undefined;
  }
  return creds.map((row) => ({
    id: row.credentialId,
  }));
}

async function registrationOptionsForUser(user, requestOrigin, registrationHints = {}) {
  assertOriginAllowed(requestOrigin);

  const existing = await prisma.passkeyCredential.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: resolveRpName(),
    rpID: resolveRpId(),
    userName: user.email,
    userDisplayName: user.fullName?.trim() || user.email,
    userID: userHandleBuffer(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({
      id: row.credentialId,
    })),
    authenticatorSelection: resolveAuthenticatorSelection(registrationHints.attachment),
    extensions: {
      credProps: true,
    },
  });

  await storeChallenge(options.challenge, {
    type: "registration",
    userId: user.id,
  });

  return options;
}

async function verifyRegistrationForUser(user, body, requestOrigin) {
  assertOriginAllowed(requestOrigin);

  const expectedChallenge = body?.expectedChallenge || extractChallengeFromClientData(body?.response?.clientDataJSON);
  if (!expectedChallenge) {
    throw new Error("Passkey challenge is missing.");
  }

  const stored = await consumeChallenge(expectedChallenge);
  if (!stored || stored.type !== "registration" || stored.userId !== user.id) {
    throw new Error("Passkey registration session expired. Try again.");
  }

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: resolveWebAuthnOrigins(),
    expectedRPID: resolveExpectedRpIds(),
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey could not be verified.");
  }

  const { registrationInfo } = verification;
  const cred = registrationInfo.credential;
  const credentialId = credentialIdToBase64(cred.id);
  const reportedTransports = Array.isArray(body.response?.transports)
    ? body.response.transports
    : registrationInfo.credentialDeviceType === "singleDevice"
      ? ["internal"]
      : [];

  await prisma.passkeyCredential.create({
    data: {
      userId: user.id,
      credentialId,
      publicKey: Buffer.from(cred.publicKey),
      counter: BigInt(cred.counter),
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      transports: reportedTransports,
      aaguid: registrationInfo.aaguid,
      friendlyName:
        String(body?.friendlyName ?? "").trim() ||
        `Passkey ${new Date().toISOString().slice(0, 10)}`,
    },
  });

  return { verified: true };
}

async function authenticationOptions(email, requestOrigin) {
  assertOriginAllowed(requestOrigin);

  const normalized = String(email ?? "")
    .trim()
    .toLowerCase();

  if (normalized) {
    const user = await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (user) {
      const count = await prisma.passkeyCredential.count({
        where: { userId: user.id },
      });
      if (count === 0) {
        const err = new Error(
          "No passkey on this account yet. Sign in with password, open Settings → “Add passkey on this PC”, then try again.",
        );
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // Discoverable ceremony (no allowCredentials) so Windows Hello can use a resident PC passkey.
  const options = await generateAuthenticationOptions({
    rpID: resolveRpId(),
    userVerification: "required",
    allowCredentials: undefined,
  });

  await storeChallenge(options.challenge, {
    type: "authentication",
    email: normalized || null,
  });

  return options;
}

async function verifyAuthentication(body, requestOrigin) {
  assertOriginAllowed(requestOrigin);

  const expectedChallenge =
    body?.expectedChallenge || extractChallengeFromClientData(body?.response?.clientDataJSON);
  if (!expectedChallenge) {
    throw new Error("Passkey challenge is missing.");
  }

  const stored = await consumeChallenge(expectedChallenge);
  if (!stored || stored.type !== "authentication") {
    throw new Error("Passkey sign-in session expired. Try again.");
  }

  const credentialId = credentialIdToBase64(body?.id ?? body?.rawId);
  const credential = await prisma.passkeyCredential.findUnique({
    where: { credentialId },
    include: {
      user: {
        include: {
          businessMemberships: {
            include: { business: true },
          },
        },
      },
    },
  });

  if (!credential) {
    throw new Error("Unknown passkey.");
  }

  if (stored.email && stored.email !== credential.user.email.toLowerCase()) {
    throw new Error("Passkey does not match this account.");
  }

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: resolveWebAuthnOrigins(),
    expectedRPID: resolveExpectedRpIds(),
    requireUserVerification: false,
    credential: {
      id: credential.credentialId,
      publicKey: credential.publicKey,
      counter: Number(credential.counter),
      transports: credential.transports ?? [],
    },
  });

  if (!verification.verified) {
    throw new Error("Passkey could not be verified.");
  }

  const newCounter = BigInt(verification.authenticationInfo.newCounter);
  await prisma.passkeyCredential.update({
    where: { id: credential.id },
    data: {
      counter: newCounter,
      lastUsedAt: new Date(),
    },
  });

  return credential.user;
}

function extractChallengeFromClientData(clientDataJSON) {
  if (!clientDataJSON) {
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8"));
    return json.challenge || null;
  } catch {
    return null;
  }
}

async function deleteCredentialForUser(userId, credentialRowId) {
  const row = await prisma.passkeyCredential.findFirst({
    where: { id: credentialRowId, userId },
  });
  if (!row) {
    return false;
  }
  await prisma.passkeyCredential.delete({ where: { id: row.id } });
  return true;
}

module.exports = {
  authenticationOptions,
  deleteCredentialForUser,
  listCredentialsForUser,
  registrationOptionsForUser,
  verifyAuthentication,
  verifyRegistrationForUser,
};
