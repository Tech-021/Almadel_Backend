const bcrypt = require("bcryptjs");

const { prisma } = require("../../db");
const { userResponse } = require("../../utils/serializers");

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

  const members = await prisma.businessMember.findMany({
    where: { businessId, role: "staff" },
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
  });

  const staffUsers = members.map((m) => m.user);
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

    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const existingMember = await prisma.businessMember.findUnique({
        where: { businessId_userId: { businessId, userId: user.id } },
      });
      if (existingMember) {
        return res.status(409).json({ message: "Staff member is already added to this business." });
      }

      await prisma.businessMember.create({
        data: { businessId, userId: user.id, role: "staff" },
      });

      return res.status(201).json(userResponse(user));
    }

    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, fullName, passwordHash, role: "staff" },
      });
      await tx.businessMember.create({
        data: { businessId, userId: created.id, role: "staff" },
      });
      return created;
    });

    return res.status(201).json(userResponse(newUser));
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Staff member already exists." });
    }

    console.error("Create staff error:", error);
    return res.status(400).json({ message: "Could not create staff account." });
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
    });

    if (!member) {
      return res.status(404).json({ message: "Staff account not found in this business." });
    }

    const data = {};
    const email = normalizeEmail(req.body.email);
    const fullName = String(req.body.fullName ?? "").trim();
    const password = String(req.body.password ?? "");

    if (email && !isValidEmail(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }

    if (email) {
      data.email = email;
    }

    if (fullName) {
      data.fullName = fullName;
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

    return res.json(userResponse(user));
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Email is already registered." });
    }

    if (error.code === "P2025") {
      return res.status(404).json({ message: "Staff account not found." });
    }

    console.error("Update staff error:", error);
    return res.status(400).json({ message: "Could not update staff account." });
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

    return res.json({ deleted: true });
  } catch (error) {
    console.error("Delete staff error:", error);
    return res.status(400).json({ message: "Could not delete staff account." });
  }
}

module.exports = { createStaff, deleteStaff, listStaff, updateStaff };