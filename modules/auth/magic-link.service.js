const {
  createResetToken: createMagicLinkToken,
  hashResetToken: hashMagicLinkToken,
} = require("./password-reset.service");
const { prisma } = require("../../db");

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

class MagicLinkError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function resolveMagicLinkBaseUrl() {
  const explicit = process.env.MAGIC_LINK_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const frontend = process.env.FRONTEND_URL?.trim();
  if (frontend) {
    return `${frontend.replace(/\/$/, "")}/magic-link`;
  }

  return "http://localhost:3000/magic-link";
}

function magicLinkUrl(token) {
  const baseUrl = resolveMagicLinkBaseUrl();
  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function magicLinkExpiry() {
  return new Date(Date.now() + MAGIC_LINK_TTL_MS);
}

async function claimMagicLinkToken(rawToken) {
  const token = String(rawToken ?? "").trim();
  if (!token) {
    throw new MagicLinkError("invalid");
  }

  const record = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hashMagicLinkToken(token) },
  });

  if (
    !record ||
    record.usedAt ||
    record.expiresAt.getTime() <= Date.now()
  ) {
    throw new MagicLinkError("invalid");
  }

  const usedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.magicLinkToken.updateMany({
      data: { usedAt },
      where: { id: record.id, usedAt: null },
    });

    if (claimed.count !== 1) {
      throw new MagicLinkError("used");
    }

    await tx.magicLinkToken.updateMany({
      data: { usedAt },
      where: { userId: record.userId, usedAt: null },
    });

    return tx.user.findUnique({
      where: { id: record.userId },
      include: {
        businessMemberships: {
          include: { business: true },
        },
      },
    });
  });
}

module.exports = {
  MagicLinkError,
  claimMagicLinkToken,
  createMagicLinkToken,
  hashMagicLinkToken,
  magicLinkExpiry,
  magicLinkUrl,
};
