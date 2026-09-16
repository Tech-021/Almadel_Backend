const db = require("../../db");
const prisma = db.prisma || db;

// POST /business/setup - Create new business & link owner
async function setupBusiness(req, res) {
  try {
    const {
      name,
      businessType,
      businessCategory,
      mobileNumber,
      whatsappNumber,
      email,
      address,
      city,
      area,
      province,
      accountingStartDate,
      openingCashBalance,
    } = req.body;

    const rawName = String(name || "").trim();
    const rawMobile = String(mobileNumber || "").trim();
    const rawWhatsapp = String(whatsappNumber || "").trim();
    const rawEmail = String(email || "").trim().toLowerCase();

    if (!rawName || rawName.length < 2) {
      return res.status(400).json({ message: "Business name must be at least 2 characters long." });
    }
    if (rawName.length > 100) {
      return res.status(400).json({ message: "Business name cannot exceed 100 characters." });
    }

    const cleanMobile = rawMobile.replace(/[^0-9+]/g, "");
    if (!cleanMobile || cleanMobile.replace(/[^0-9]/g, "").length < 10) {
      return res.status(400).json({ message: "Please provide a valid primary mobile number (min 10 digits)." });
    }

    if (rawWhatsapp) {
      const cleanWhatsapp = rawWhatsapp.replace(/[^0-9+]/g, "");
      if (cleanWhatsapp.replace(/[^0-9]/g, "").length < 10) {
        return res.status(400).json({ message: "Please provide a valid WhatsApp number." });
      }
    }

    if (rawEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(rawEmail)) {
        return res.status(400).json({ message: "Please enter a valid email address." });
      }
    }

    const userId = Number(req.user?.id);
    const openingBalanceNum = Number(openingCashBalance) || 0;
    const startDate = accountingStartDate ? new Date(accountingStartDate) : new Date();

    const business = await prisma.$transaction(async (tx) => {
      // Safe model references
      const bizClient = tx.business || tx.Business || tx.businesses;
      const memberClient = tx.businessMember || tx.BusinessMember || tx.business_members;
      const logClient = tx.activityLog || tx.ActivityLog || tx.activity_logs;

      if (!bizClient) {
        throw new Error(`Prisma 'business' model not found on tx. Available models: ${Object.keys(tx).join(', ')}`);
      }

      // 1. Create Business
      const newBiz = await bizClient.create({
        data: {
          name: name.trim(),
          businessType: businessType?.trim() || "Mobile Shop",
          businessCategory: businessCategory?.trim() || null,
          mobileNumber: mobileNumber.trim(),
          whatsappNumber: whatsappNumber?.trim() || null,
          email: email?.trim() || null,
          address: address?.trim() || null,
          city: city?.trim() || null,
          area: area?.trim() || null,
          province: province?.trim() || null,
          accountingStartDate: startDate,
          openingCashBalance: openingBalanceNum,
          ownerId: userId,
        },
      });

      // 2. Link User as Owner
      if (memberClient) {
        await memberClient.create({
          data: {
            businessId: newBiz.id,
            userId: userId,
            role: "owner",
          },
        });
      }

      // 3. Initial log
      if (logClient) {
        try {
          await logClient.create({
            data: {
              businessId: newBiz.id,
              action: "BUSINESS_SETUP",
              category: "Business",
              details: `Business '${newBiz.name}' initialized by ${req.user.fullName || req.user.email}`,
              target: newBiz.name,
              meta: {
                businessType: newBiz.businessType,
                businessCategory: newBiz.businessCategory,
                openingCashBalance: openingBalanceNum,
              },
              userId,
              userName: req.user.fullName || req.user.name || "Owner",
              userEmail: req.user.email,
              userRole: "admin",
            },
          });
        } catch (e) {
          console.warn("Log creation notice:", e.message);
        }
      }

      return newBiz;
    });

    return res.status(201).json({
      success: true,
      message: "Business created and configured successfully.",
      business,
    });
  } catch (error) {
    console.error("Setup business error:", error);
    return res.status(500).json({ message: "Failed to setup business.", error: error.message });
  }
}

// GET /business/my-businesses
async function getMyBusinesses(req, res) {
  try {
    const userId = Number(req.user?.id);
    const memberModel = prisma.businessMember || prisma.BusinessMember;

    if (!memberModel) {
      return res.json({ success: true, businesses: [] });
    }

    const memberships = await memberModel.findMany({
      where: { userId },
      include: { business: true },
      orderBy: { createdAt: "desc" },
    });

    const businesses = memberships.map((m) => ({
      ...m.business,
      membershipRole: m.role,
    }));

    return res.json({ success: true, businesses });
  } catch (error) {
    console.error("Get businesses error:", error);
    return res.status(500).json({ message: "Failed to retrieve businesses." });
  }
}

// GET /business/:id
async function getBusinessDetails(req, res) {
  try {
    const businessId = Number(req.params.id);
    const userId = Number(req.user?.id);
    const memberModel = prisma.businessMember || prisma.BusinessMember;
    const bizModel = prisma.business || prisma.Business;

    if (!bizModel) {
      return res.status(500).json({ message: "Business model not available." });
    }

    const membership = memberModel ? await memberModel.findUnique({
      where: { businessId_userId: { businessId, userId } },
      include: { business: true },
    }) : null;

    if (!membership && req.user.role !== "admin") {
      return res.status(403).json({ message: "You do not have access to this business." });
    }

    const business = membership
      ? { ...membership.business, membershipRole: membership.role }
      : await bizModel.findUnique({ where: { id: businessId } });

    if (!business) {
      return res.status(404).json({ message: "Business not found." });
    }

    return res.json({ success: true, business });
  } catch (error) {
    console.error("Get business details error:", error);
    return res.status(500).json({ message: "Failed to retrieve business details." });
  }
}

// PATCH /business/:id
async function updateBusiness(req, res) {
  try {
    const businessId = Number(req.params.id);
    const userId = Number(req.user?.id);
    const memberModel = prisma.businessMember || prisma.BusinessMember;
    const bizModel = prisma.business || prisma.Business;

    if (!bizModel) {
      return res.status(500).json({ message: "Business model not available." });
    }

    if (memberModel) {
      const membership = await memberModel.findUnique({
        where: { businessId_userId: { businessId, userId } },
      });
      if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
        return res.status(403).json({ message: "Only business owners can update business settings." });
      }
    }

    const {
      name,
      businessType,
      businessCategory,
      mobileNumber,
      whatsappNumber,
      email,
      address,
      city,
      area,
      province,
    } = req.body;

    const updated = await bizModel.update({
      where: { id: businessId },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        businessType: businessType !== undefined ? businessType.trim() : undefined,
        businessCategory: businessCategory !== undefined ? businessCategory.trim() : undefined,
        mobileNumber: mobileNumber !== undefined ? mobileNumber.trim() : undefined,
        whatsappNumber: whatsappNumber !== undefined ? whatsappNumber.trim() : undefined,
        email: email !== undefined ? email.trim() : undefined,
        address: address !== undefined ? address.trim() : undefined,
        city: city !== undefined ? city.trim() : undefined,
        area: area !== undefined ? area.trim() : undefined,
        province: province !== undefined ? province.trim() : undefined,
      },
    });

    return res.json({
      success: true,
      message: "Business settings updated.",
      business: updated,
    });
  } catch (error) {
    console.error("Update business error:", error);
    return res.status(500).json({ message: "Failed to update business." });
  }
}

module.exports = {
  setupBusiness,
  getMyBusinesses,
  getBusinessDetails,
  updateBusiness,
};
