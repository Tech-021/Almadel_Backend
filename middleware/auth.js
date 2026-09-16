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
      select: { authVersion: true, id: true, role: true },
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

module.exports = { requireAdmin, requireAuth };
