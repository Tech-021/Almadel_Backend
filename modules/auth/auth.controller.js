const bcrypt = require("bcryptjs");

const { prisma } = require("../../db");
const { sendPasswordResetEmail, sendMagicLinkEmail } = require("./email.service");
const {
  createResetToken,
  hashResetToken,
  passwordResetUrl,
  resetTokenExpiry,
} = require("./password-reset.service");
const {
  claimMagicLinkToken,
  createMagicLinkToken,
  hashMagicLinkToken,
  magicLinkExpiry,
  magicLinkUrl,
  MagicLinkError,
} = require("./magic-link.service");
const { createAccessToken } = require("./token.service");
const { formatBusinessSubscription } = require("../business/business.controller");
const { validatePassword } = require("../../utils/validators");

const GENERIC_RESET_RESPONSE = {
  message:
    "If an account exists for this email, password reset instructions have been sent.",
};
const GENERIC_MAGIC_LINK_RESPONSE = {
  message:
    "If an account exists for this email, a sign-in link has been sent.",
};
const PASSWORD_HASH_ROUNDS = Number(process.env.PASSWORD_HASH_ROUNDS ?? 10);

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

async function signUpStaff(req, res) {
  return signUpOwner(req, res);
}

async function signUpOwner(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password ?? "");
    const fullName = String(req.body.fullName ?? "").trim();

    if (!email || !password || !fullName) {
      return res.status(400).json({
        message: "Name, email, and password are required.",
      });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ message: passwordCheck.error });
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
    const user = await prisma.user.create({
      data: { email, fullName, passwordHash, role: "pending" },
    });

    return res.status(201).json({
      token: createAccessToken(user),
      user: publicUser(user),
      isOwner: true,
      hasBusiness: false,
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Email is already registered." });
    }

    console.error("Owner sign up error:", error);
    return res.status(500).json({ message: "Could not create account." });
  }
}

async function signIn(req, res) {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password ?? "");
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        businessMemberships: {
          include: { business: true },
        },
      },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const businesses = (user.businessMemberships || []).map((m) => ({
      ...formatBusinessSubscription(m.business),
      role: m.role,
      membershipRole: m.role,
    }));

    return res.json({
      token: createAccessToken(user),
      user: publicUser(user),
      businesses,
      hasBusiness: businesses.length > 0,
      activeBusinessId: businesses[0]?.id || null,
    });
  } catch (error) {
    console.error("Sign in error:", error);
    return res.status(500).json({ message: "Could not sign in." });
  }
}

async function forgotPassword(req, res) {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email || !email.includes("@")) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.json(GENERIC_RESET_RESPONSE);
    }

    const token = createResetToken();
    const resetToken = await prisma.passwordResetToken.create({
      data: {
        expiresAt: resetTokenExpiry(),
        tokenHash: hashResetToken(token),
        userId: user.id,
      },
    });

    try {
      await sendPasswordResetEmail({
        email: user.email,
        fullName: user.fullName,
        resetUrl: passwordResetUrl(token),
      });
    } catch (emailError) {
      await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
      console.error("Password reset email error:", emailError);
    }

    return res.json(GENERIC_RESET_RESPONSE);
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      message: "Could not prepare password recovery.",
    });
  }
}

async function requestMagicLink(req, res) {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email || !email.includes("@")) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.json(GENERIC_MAGIC_LINK_RESPONSE);
    }

    const token = createMagicLinkToken();
    const magicLinkRecord = await prisma.magicLinkToken.create({
      data: {
        expiresAt: magicLinkExpiry(),
        tokenHash: hashMagicLinkToken(token),
        userId: user.id,
      },
    });

    try {
      const mailResult = await sendMagicLinkEmail({
        email: user.email,
        fullName: user.fullName,
        magicLinkUrl: magicLinkUrl(token),
      });
      console.info("Magic link email sent", {
        provider: mailResult.provider,
        messageId: mailResult.messageId,
        userId: user.id,
      });
    } catch (emailError) {
      await prisma.magicLinkToken.delete({ where: { id: magicLinkRecord.id } });
      console.error("Magic link email error:", emailError);
    }

    return res.json(GENERIC_MAGIC_LINK_RESPONSE);
  } catch (error) {
    console.error("Magic link request error:", error);
    return res.status(500).json({
      message: "Could not send sign-in link.",
    });
  }
}

function businessesForUser(user) {
  return (user.businessMemberships || []).map((m) => ({
    ...formatBusinessSubscription(m.business),
    role: m.role,
    membershipRole: m.role,
  }));
}

async function verifyMagicLink(req, res) {
  try {
    const token = String(req.body.token ?? "").trim();

    if (!token) {
      return res.status(400).json({
        message: "This sign-in link is invalid.",
      });
    }

    const user = await claimMagicLinkToken(token);
    if (!user) {
      return res.status(400).json({
        message: "This sign-in link is invalid or has expired.",
      });
    }

    const businesses = businessesForUser(user);

    return res.json({
      token: createAccessToken(user),
      user: publicUser(user),
      businesses,
      hasBusiness: businesses.length > 0,
      activeBusinessId: businesses[0]?.id || null,
    });
  } catch (error) {
    if (error instanceof MagicLinkError) {
      return res.status(400).json({
        message: "This sign-in link is invalid or has expired.",
      });
    }

    console.error("Magic link verify error:", error);
    return res.status(400).json({
      message: "Could not sign in with this link.",
    });
  }
}

async function resetPassword(req, res) {
  try {
    const token = String(req.body.token ?? "").trim();
    const password = String(req.body.password ?? "");

    if (!token) {
      return res.status(400).json({
        message: "The password reset link is invalid.",
      });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ message: passwordCheck.error });
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() <= Date.now()
    ) {
      return res.status(400).json({
        message: "This password reset link is invalid or has expired.",
      });
    }

    await replacePassword(resetToken, password);

    return res.json({
      message: "Password updated. You can now sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(400).json({
      message:
        error.message === "Password reset link has already been used."
          ? error.message
          : "Could not reset the password.",
    });
  }
}

async function getMe(req, res) {
  return res.json({
    user: publicUser({
      id: req.user.id,
      email: req.user.email,
      fullName: req.user.fullName,
      role: req.user.role,
    }),
  });
}

async function updateMe(req, res) {
  const fullName = req.body.fullName === undefined ? undefined : String(req.body.fullName).trim();
  const email = req.body.email === undefined ? undefined : normalizeEmail(req.body.email);
  if (fullName !== undefined && fullName.length < 2) return res.status(400).json({ message: "Name must be at least 2 characters." });
  if (email !== undefined && !email.includes("@")) return res.status(400).json({ message: "Please enter a valid email address." });
  try {
    const user = await prisma.user.update({ where: { id: Number(req.user.id) }, data: { fullName, email } });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return res.status(error.code === "P2002" ? 409 : 400).json({ message: error.code === "P2002" ? "Email is already registered." : "Could not update account details." });
  }
}

async function replacePassword(resetToken, password) {
  const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
  const usedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      data: { usedAt },
      where: { id: resetToken.id, usedAt: null },
    });

    if (claimed.count !== 1) {
      throw new Error("Password reset link has already been used.");
    }

    await tx.user.update({
      data: {
        authVersion: { increment: 1 },
        passwordHash,
      },
      where: { id: resetToken.userId },
    });

    await tx.passwordResetToken.updateMany({
      data: { usedAt },
      where: { userId: resetToken.userId, usedAt: null },
    });
  });
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

module.exports = {
  forgotPassword,
  getMe,
  requestMagicLink,
  resetPassword,
  signIn,
  signUpStaff,
  signUpOwner,
  updateMe,
  verifyMagicLink,
};
