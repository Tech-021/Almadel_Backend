const bcrypt = require("bcryptjs");

const { prisma } = require("../../db");
const { userResponse } = require("../../utils/serializers");
const { emitBusinessEvent } = require("../realtime/socket");
const { sendCredentialsEmail } = require("../auth/email.service");

const PASSWORD_HASH_ROUNDS = Number(process.env.PASSWORD_HASH_ROUNDS ?? 10);


function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = String(value ?? "").trim();

  return Boolean(email && email.includes("@"));
}

async function listStaff(req, res) {
  const businessId = req.businessId;

  // Staff page also has no pagination; 10k members freezes the UI. Cap the list for display.
  const DEFAULT_LIMIT = Number(process.env.STAFF_LIST_DEFAULT_LIMIT || 200);
  const MAX_LIMIT = Number(process.env.STAFF_LIST_MAX_LIMIT || 10000);
  const requested = req.query.limit;
  const limit =
    requested === undefined || requested === ""
      ? DEFAULT_LIMIT
      : Math.min(Math.max(Number(requested) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const members = await prisma.businessMember.findMany({
    where: { businessId, role: { in: ["staff", "accountant"] } },
    include: {
      user: {
        select: {
          email: true,
          fullName: true,
          id: true,
          role: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const staffUsers = members.map((m) => ({
    ...m.user,
    role: m.role || m.user.role,
  }));
  const staffIds = staffUsers.map((user) => user.id);

  const [saleTotals, productCounts, stockLogCounts] = await Promise.all([
    staffIds.length > 0
      ? prisma.sale.groupBy({
          by: ["userId"],
          _count: { id: true },
          _sum: { totalAmount: true, totalItems: true },
          where: { businessId, userId: { in: staffIds } },
        })
      : [],
    staffIds.length > 0
      ? prisma.product.groupBy({
          by: ["createdByUserId"],
          _count: { id: true },
          where: { businessId, createdByUserId: { in: staffIds } },
        })
      : [],
    staffIds.length > 0
      ? prisma.stockLog.groupBy({
          by: ["userId"],
          _count: { id: true },
          where: { businessId, userId: { in: staffIds } },
        })
      : [],
  ]);

  const salesByUser = new Map(saleTotals.map((t) => [t.userId, t]));
  const productsByUser = new Map(productCounts.map((p) => [p.createdByUserId, p._count.id]));
  const stockLogsByUser = new Map(stockLogCounts.map((s) => [s.userId, s._count.id]));

  res.json({
    staff: staffUsers.map((user) => {
      const saleStat = salesByUser.get(user.id);
      const prodCount = productsByUser.get(user.id) || 0;
      const stockCount = stockLogsByUser.get(user.id) || 0;

      return {
        stats: {
          products: prodCount,
          sales: saleStat?._count?.id ?? 0,
          stockLogs: stockCount,
          totalItemsSold: saleStat?._sum?.totalItems ?? 0,
          totalSales: saleStat?._sum?.totalAmount ?? 0,
        },
        user: userResponse(user),
      };
    }),
  });
}

async function createStaff(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password ?? "");
    const fullName = String(req.body.fullName ?? "").trim();
    const role = req.body.role === "accountant" ? "accountant" : "staff";
    const businessId = req.businessId;

    if (!fullName || !isValidEmail(email)) {
      return res.status(400).json({
        message: "Name and a valid email are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must contain at least 8 characters.",
      });
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    const businessName = business?.name || "Your Store";
    const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;

    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const existingMember = await prisma.businessMember.findUnique({
        where: { businessId_userId: { businessId, userId: user.id } },
      });
      if (existingMember) {
        return res.status(409).json({ message: "Member is already added to this business." });
      }

      await prisma.businessMember.create({
        data: { businessId, userId: user.id, role },
      });

      if (password) {
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash, authVersion: { increment: 1 } },
        });
      }

      const response = userResponse({ ...user, role });
      emitBusinessEvent(businessId, "staff.created", response);

      // Send credentials email
      try {
        await sendCredentialsEmail({
          email,
          fullName: fullName || user.fullName,
          role,
          password,
          businessName,
          loginUrl,
        });
      } catch (mailError) {
        console.error("Failed to send credentials email:", mailError.message);
      }

      return res.status(201).json(response);
    }

    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, fullName, passwordHash, role },
      });
      await tx.businessMember.create({
        data: { businessId, userId: created.id, role },
      });
      return created;
    });

    const response = userResponse(newUser);
    emitBusinessEvent(businessId, "staff.created", response);

    // Send credentials email
    try {
      await sendCredentialsEmail({
        email,
        fullName,
        role,
        password,
        businessName,
        loginUrl,
      });
    } catch (mailError) {
      console.error("Failed to send credentials email:", mailError.message);
    }

    return res.status(201).json(response);
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Account with this email already exists." });
    }

    console.error("Create team member error:", error);
    return res.status(400).json({ message: "Could not create team member account." });
  }
}

async function updateStaff(req, res) {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId;

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid staff id." });
    }

    const member = await prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId: id } },
      include: { user: true },
    });

    if (!member) {
      return res.status(404).json({ message: "Member account not found in this business." });
    }

    const data = {};
    const email = normalizeEmail(req.body.email);
    const fullName = String(req.body.fullName ?? "").trim();
    const password = String(req.body.password ?? "");
    const role = req.body.role;

    if (email && !isValidEmail(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }

    if (email) {
      data.email = email;
    }

    if (fullName) {
      data.fullName = fullName;
    }

    if (role && ["staff", "accountant"].includes(role)) {
      data.role = role;
      await prisma.businessMember.update({
        where: { businessId_userId: { businessId, userId: id } },
        data: { role },
      });
    }

    if (password) {
      if (password.length < 8) {
        return res.status(400).json({
          message: "Password must contain at least 8 characters.",
        });
      }

      data.authVersion = { increment: 1 };
      data.passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No changes provided." });
    }

    const user = await prisma.user.update({ data, where: { id } });

    // If password was updated, send new credentials email
    if (password) {
      try {
        const business = await prisma.business.findUnique({
          where: { id: businessId },
          select: { name: true },
        });
        await sendCredentialsEmail({
          email: user.email,
          fullName: user.fullName,
          role: role || member.role,
          password,
          businessName: business?.name || "Your Store",
          loginUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`,
        });
      } catch (mailError) {
        console.error("Failed to send updated credentials email:", mailError.message);
      }
    }

    const response = userResponse({ ...user, role: role || member.role });
    emitBusinessEvent(businessId, "staff.updated", response);
    return res.json(response);

  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Email is already registered." });
    }

    if (error.code === "P2025") {
      return res.status(404).json({ message: "Team member account not found." });
    }

    console.error("Update staff error:", error);
    return res.status(400).json({ message: "Could not update team member account." });
  }
}

async function deleteStaff(req, res) {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId;

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid staff id." });
    }

    const member = await prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId: id } },
    });

    if (!member) {
      return res.status(404).json({ message: "Staff account not found in this business." });
    }

    await prisma.businessMember.delete({
      where: { businessId_userId: { businessId, userId: id } },
    });

    const remainingMemberships = await prisma.businessMember.count({
      where: { userId: id },
    });

    if (remainingMemberships === 0) {
      await prisma.user.delete({ where: { id } }).catch(() => null);
    }

    emitBusinessEvent(businessId, "staff.deleted", { id });
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Delete staff error:", error);
    return res.status(400).json({ message: "Could not delete staff account." });
  }
}

module.exports = { createStaff, deleteStaff, listStaff, updateStaff };


