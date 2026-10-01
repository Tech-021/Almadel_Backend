const { prisma, prismaRead } = require("../../db");

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

function resolveLogActor(req) {
  const authUser = req.user;
  if (!authUser?.id) {
    return null;
  }

  const membershipRole = req.businessRole;
  let userRole = "staff";
  if (membershipRole === "owner" || membershipRole === "admin") {
    userRole = "admin";
  } else if (membershipRole === "accountant") {
    userRole = "accountant";
  } else if (membershipRole === "staff") {
    userRole = "staff";
  }

  const userName =
    String(authUser.fullName || authUser.name || "").trim() ||
    String(authUser.email || "").trim() ||
    "Unknown user";
  const userEmail = String(authUser.email || "").trim();

  return {
    userId: Number(authUser.id),
    userName,
    userEmail,
    userRole,
  };
}

// POST /logs - Record new activity event (scoped to the caller's business)
async function createLog(req, res) {
  try {
    const businessId = requireScopedBusinessId(req, res);
    if (!businessId) return;

    const { action, category, details, target, meta } = req.body;
    // Ignore any client-supplied userName, userEmail, userRole, userId (AUD-F10).

    if (!action || !category || !details) {
      return res.status(400).json({
        success: false,
        message: "action, category, and details are required.",
      });
    }

    const actor = resolveLogActor(req);
    if (!actor) {
      return res.status(401).json({
        success: false,
        message: "Authentication required to record activity.",
      });
    }

    const { userId, userName, userEmail, userRole } = actor;

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

    const { category, action, search } = req.query;
    const { parsePagination, paginationMeta } = require("../../utils/pagination");
    const { page: pageNum, limit: limitNum, skip } = parsePagination(req.query, {
      defaultLimit: 50,
      maxLimit: 100,
    });

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

    const [rawLogs, total] = await Promise.all([
      prismaRead.activityLog.findMany({
        where,
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        skip,
        take: limitNum,
      }),
      prismaRead.activityLog.count({ where }),
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

    const pagination = paginationMeta(pageNum, limitNum, total);
    return res.status(200).json({
      success: true,
      total: pagination.total,
      page: pagination.page,
      limit: pagination.limit,
      pagination,
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
