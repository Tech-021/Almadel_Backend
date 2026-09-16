const { prisma } = require("../db");
const { verifyAccessToken } = require("../modules/auth/token.service");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    const payload = verifyAccessToken(token);
    const userId = normalizeUserId(payload.id);

    if (!userId) {
      return res.status(401).json({
        message: "Session is outdated. Please sign in again.",
      });
    }

    const user = await prisma.user.findUnique({
      select: { authVersion: true, id: true, role: true, email: true, fullName: true },
      where: { id: userId },
    });

    if (!user || user.authVersion !== Number(payload.authVersion ?? 0)) {
      return res.status(401).json({ message: "Invalid or expired session." });
    }

    req.user = {
      ...payload,
      id: user.id,
      role: user.role,
    };

    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired session." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required." });
  }

  return next();
}

function normalizeUserId(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return Number.isInteger(value) && value > 0 ? value : null;
}


async function requireBusiness(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Authentication required." });
  }

  const headerBizId = req.headers["x-business-id"];
  const userId = Number(req.user.id);

  let businessId = headerBizId && !isNaN(Number(headerBizId)) ? Number(headerBizId) : null;
  let member = null;

  if (businessId) {
    member = await prisma.businessMember.findUnique({
      where: {
        businessId_userId: {
          businessId,
          userId,
        },
      },
    });
  }

  // If header businessId is missing or doesn't belong to this user (e.g. stale localStorage),
  // fallback to the user's primary/first business
  if (!member) {
    const primary = await prisma.businessMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (primary) {
      businessId = primary.businessId;
      member = primary;
    }
  }

  if (!member || !businessId) {
    return res.status(400).json({
      message: "No active business found. Please set up a business first.",
      requiresBusinessSetup: true,
    });
  }

  req.businessId = businessId;
  req.businessRole = member.role;
  return next();
}

module.exports = { requireAdmin, requireAuth, requireBusiness };