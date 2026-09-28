const { prisma } = require("../../db");

function requireScopedBusinessId(req, res) {
  const businessId = Number(req.businessId);
  if (!Number.isInteger(businessId) || businessId <= 0) {
    res.status(400).json({
      success: false,
      message: "Active business is required.",
      requiresBusinessSetup: true,
    });
    return null;
  }
  return businessId;
}

// POST /logs - Record new activity event (scoped to the caller's business)
async function createLog(req, res) {
  try {
    const businessId = requireScopedBusinessId(req, res);
    if (!businessId) return;

    const { action, category, details, target, meta } = req.body;

    if (!action || !category || !details) {
      return res.status(400).json({
        success: false,
        message: "action, category, and details are required.",
      });
    }

    // Derive actor from the authenticated session — never trust client-supplied identity.
    const authUser = req.user;
    const userName = authUser?.fullName || authUser?.name || "System Operator";
    const userEmail = authUser?.email || "system@almadel.com";
    const userRole = req.businessRole || authUser?.role || "staff";
    const userId = authUser?.id ? Number(authUser.id) : null;

    const log = await prisma.activityLog.create({
      data: {
        action: String(action),
        businessId,
        category: String(category),
        details: String(details),
        target: target ? String(target) : null,
        meta: meta || {},
        userId,
        userName,
        userEmail,
        userRole: String(userRole),
      },
    });

    return res.status(201).json({
      success: true,
      message: "Log recorded successfully.",
      data: log,
    });
  } catch (error) {
    console.error("Error in createLog:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to record activity log.",
      error: error.message,
    });
  }
}

// GET /logs - Retrieve logs for the active business only
async function getLogs(req, res) {
  try {
    const businessId = requireScopedBusinessId(req, res);
    if (!businessId) return;

    const { category, action, search, page = 1, limit = 100 } = req.query;

    const where = {
      businessId,
    };

    if (category && category !== "All") {
      if (category === "Product & Stock") {
        where.category = { in: ["Product", "Stock"] };
      } else if (category === "Auth & Sessions") {
        where.category = "Auth";
      } else if (category === "Page Visits") {
        where.category = "Visit";
      } else {
        where.category = String(category);
      }
    }

    if (action) {
      where.action = String(action);
    }

    if (search) {
      const q = String(search);
      where.OR = [
        { details: { contains: q, mode: "insensitive" } },
        { target: { contains: q, mode: "insensitive" } },
        { userName: { contains: q, mode: "insensitive" } },
        { userEmail: { contains: q, mode: "insensitive" } },
        { action: { contains: q, mode: "insensitive" } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [rawLogs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.activityLog.count({ where }),
    ]);

    const logs = rawLogs.map((item) => ({
      id: String(item.id),
      timestamp: item.timestamp.toISOString(),
      action: item.action,
      category: item.category,
      user: {
        id: item.userId,
        name: item.userName,
        email: item.userEmail,
        role: item.userRole,
      },
      details: item.details,
      target: item.target,
      meta: item.meta,
    }));

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      logs,
    });
  } catch (error) {
    console.error("Error in getLogs:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch activity logs.",
      error: error.message,
    });
  }
}

// DELETE /logs - Clear logs for the active business only (owner/admin)
async function clearLogs(req, res) {
  try {
    const businessId = requireScopedBusinessId(req, res);
    if (!businessId) return;

    const result = await prisma.activityLog.deleteMany({
      where: { businessId },
    });

    return res.status(200).json({
      success: true,
      message: "All activity logs have been cleared successfully.",
      deleted: result.count,
    });
  } catch (error) {
    console.error("Error in clearLogs:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear activity logs.",
      error: error.message,
    });
  }
}

module.exports = {
  createLog,
  getLogs,
  clearLogs,
};
