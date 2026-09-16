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
  const staff = await prisma.user.findMany({
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
    select: {
      _count: {
        select: { products: true, sales: true, stockLogs: true },
      },
      email: true,
      fullName: true,
      id: true,
      role: true,
    },
    where: { role: "staff" },
  });

  const staffIds = staff.map((user) => user.id);
  const saleTotals =
    staffIds.length > 0
      ? await prisma.sale.groupBy({
          by: ["userId"],
          _sum: { totalAmount: true, totalItems: true },
          where: { userId: { in: staffIds } },
        })
      : [];
  const totalsByUser = new Map(
    saleTotals.map((total) => [total.userId, total]),
  );

  res.json({
    staff: staff.map((user) => {
      const totals = totalsByUser.get(user.id);

      return {
        stats: {
          products: user._count.products,
          sales: user._count.sales,
          stockLogs: user._count.stockLogs,
          totalItemsSold: totals?._sum.totalItems ?? 0,
          totalSales: totals?._sum.totalAmount ?? 0,
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
    const user = await prisma.user.create({
      data: { email, fullName, passwordHash, role: "staff" },
    });

    return res.status(201).json(userResponse(user));
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Email is already registered." });
    }

    console.error("Create staff error:", error);
    return res.status(400).json({ message: "Could not create staff account." });
  }
}

async function updateStaff(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid staff id." });
    }

    const existing = await prisma.user.findFirst({
      where: { id, role: "staff" },
    });

    if (!existing) {
      return res.status(404).json({ message: "Staff account not found." });
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

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid staff id." });
    }

    const deleted = await prisma.user.deleteMany({
      where: { id, role: "staff" },
    });

    if (deleted.count !== 1) {
      return res.status(404).json({ message: "Staff account not found." });
    }

    return res.json({ deleted: true });
  } catch (error) {
    console.error("Delete staff error:", error);
    return res.status(400).json({ message: "Could not delete staff account." });
  }
}

module.exports = { createStaff, deleteStaff, listStaff, updateStaff };
