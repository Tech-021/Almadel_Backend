const bcrypt = require("bcryptjs");

const { prisma } = require("../../db");
const { userResponse } = require("../../utils/serializers");
const { emitBusinessEvent } = require("../realtime/socket");
const { sendCredentialsEmail, sendStaffInviteEmail } = require("../auth/email.service");
const { validatePassword } = require("../../utils/validators");

const PASSWORD_HASH_ROUNDS = Number(process.env.PASSWORD_HASH_ROUNDS ?? 10);


function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = String(value ?? "").trim();

  return Boolean(email && email.includes("@"));
}

/** Blocks mutating/removing the business owner or the acting user via staff APIs. */
async function assertStaffMutationAllowed(member, businessId, actorUserId) {
  if (!member) {
    return { ok: false, status: 404, message: "Member account not found in this business." };
  }

  if (member.role === "owner") {
    return {
      ok: false,
      status: 403,
      message: "The business owner cannot be modified or removed from staff management.",
    };
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerId: true },
  });

  if (business && Number(business.ownerId) === Number(member.userId)) {
    return {
      ok: false,
      status: 403,
      message: "The business owner cannot be modified or removed.",
    };
  }

  if (Number(actorUserId) === Number(member.userId)) {
    return {
      ok: false,
      status: 403,
      message: "You cannot modify or remove your own account from this screen.",
    };
  }

  return { ok: true };
}

async function listStaff(req, res) {
  const businessId = req.businessId;
  const { parsePagination, paginationMeta } = require("../../utils/pagination");
  const { page, limit, skip } = parsePagination(req.query, {
    defaultLimit: Number(process.env.STAFF_LIST_DEFAULT_LIMIT || 50),
    maxLimit: Number(process.env.STAFF_LIST_MAX_LIMIT || 100),
  });

  const memberWhere = { businessId, role: { in: ["staff", "accountant"] } };

  const [members, total] = await Promise.all([
    prisma.businessMember.findMany({
      where: memberWhere,
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
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
      skip,
      take: limit,
    }),
    prisma.businessMember.count({ where: memberWhere }),
  ]);

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

  const pagination = paginationMeta(page, limit, total);
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
    pagination,
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

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    const businessName = business?.name || "Your Store";
    const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      const existingMember = await prisma.businessMember.findUnique({
        where: { businessId_userId: { businessId, userId: existingUser.id } },
      });
      if (existingMember) {
        return res.status(409).json({ message: "Member is already added to this business." });
      }

      const otherMembership = await prisma.businessMember.findUnique({
        where: { userId: existingUser.id },
      });
      if (otherMembership) {
        return res.status(409).json({
          message:
            "This email already belongs to another business. Each account can only belong to one business.",
        });
      }

      await prisma.businessMember.create({
        data: { businessId, userId: existingUser.id, role },
      });

      const response = userResponse({ ...existingUser, role });
      emitBusinessEvent(businessId, "staff.created", response);

      setImmediate(() => {
        sendStaffInviteEmail({
          email,
          fullName: fullName || existingUser.fullName,
          role,
          businessName,
          loginUrl,
        }).catch((mailError) => {
          console.error("Failed to send staff invite email:", mailError.message);
        });
      });

      return res.status(201).json({
        ...response,
        invitedExistingAccount: true,
        message:
          "Existing user added to your team. Their password was not changed; they can sign in with their current password.",
      });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ message: passwordCheck.error });
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

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

    // Never block the HTTP response on SMTP
    setImmediate(() => {
      sendCredentialsEmail({
        email,
        fullName,
        role,
        password,
        businessName,
        loginUrl,
      }).catch((mailError) => {
        console.error("Failed to send credentials email:", mailError.message);
      });
    });

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

    const guard = await assertStaffMutationAllowed(member, businessId, req.user?.id);
    if (!guard.ok) {
      return res.status(guard.status).json({ message: guard.message });
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
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        return res.status(400).json({ message: passwordCheck.error });
      }

      data.authVersion = { increment: 1 };
      data.passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No changes provided." });
    }

    const user = await prisma.user.update({ data, where: { id } });

    // If password was updated, send new credentials email (async — don't block response)
    if (password) {
      const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;
      const mailRole = role || member.role;
      setImmediate(() => {
        prisma.business
          .findUnique({ where: { id: businessId }, select: { name: true } })
          .then((business) =>
            sendCredentialsEmail({
              email: user.email,
              fullName: user.fullName,
              role: mailRole,
              password,
              businessName: business?.name || "Your Store",
              loginUrl,
            }),
          )
          .catch((mailError) => {
            console.error("Failed to send updated credentials email:", mailError.message);
          });
      });
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

    const guard = await assertStaffMutationAllowed(member, businessId, req.user?.id);
    if (!guard.ok) {
      return res.status(guard.status).json({ message: guard.message });
    }

    await prisma.businessMember.delete({
      where: { businessId_userId: { businessId, userId: id } },
    });

    emitBusinessEvent(businessId, "staff.deleted", { id });
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Delete staff error:", error);
    return res.status(400).json({ message: "Could not delete staff account." });
  }
}

module.exports = { createStaff, deleteStaff, listStaff, updateStaff };


