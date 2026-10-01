const db = require("../../db");
const prisma = db.prisma || db;
const {
  validatePhone,
  validateEmail,
  validateText,
  validateNumber,
  validateOpeningBalanceRows,
} = require("../../utils/validators");
const {
  assertBusinessManagementAccess,
  assertBusinessMemberAccess,
} = require("./business-access");
const {
  getOnboardingDraft,
  saveOnboardingDraft,
  updateOnboardingWorkspaceMode,
} = require("./onboarding.service");

/** PATCH: undefined = omit field; null = clear; string = trim (blank -> null). */
function patchNullableString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function patchTrimmedString(value) {
  if (value === undefined) return undefined;
  return String(value ?? "").trim();
}

function buildOnboardingPayload(body) {
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
  } = body;

  const nameVal = validateText(name, { minLength: 2, maxLength: 100, fieldName: "Business name" });
  if (!nameVal.valid) {
    return { error: nameVal.error };
  }

  const phoneVal = validatePhone(mobileNumber, { required: true, fieldName: "Primary mobile number" });
  if (!phoneVal.valid) {
    return { error: phoneVal.error };
  }

  if (whatsappNumber) {
    const whatsappVal = validatePhone(whatsappNumber, { required: false, fieldName: "WhatsApp number" });
    if (!whatsappVal.valid) {
      return { error: whatsappVal.error };
    }
  }

  if (email) {
    const emailVal = validateEmail(email, { required: false, fieldName: "Business email" });
    if (!emailVal.valid) {
      return { error: emailVal.error };
    }
  }

  const openingBalanceNum = Number(openingCashBalance) || 0;
  const startDate = accountingStartDate ? new Date(accountingStartDate) : new Date();

  return {
    payload: {
      name: String(name).trim(),
      businessType: businessType?.trim() || "Mobile Shop",
      businessCategory: businessCategory?.trim() || null,
      mobileNumber: String(mobileNumber).trim(),
      whatsappNumber: whatsappNumber?.trim() || null,
      email: email?.trim() || null,
      address: address?.trim() || null,
      city: city?.trim() || null,
      area: area?.trim() || null,
      province: province?.trim() || null,
      accountingStartDate: startDate.toISOString(),
      openingCashBalance: openingBalanceNum,
    },
  };
}

// POST /business/setup — save onboarding draft (business created after Stripe checkout)
async function setupBusiness(req, res) {
  try {
    const built = buildOnboardingPayload(req.body);
    if (built.error) {
      return res.status(400).json({ message: built.error });
    }

    const userId = Number(req.user?.id);
    const workspaceMode =
      req.body.workspaceMode === "financial" || req.body.workspaceMode === "pos"
        ? req.body.workspaceMode
        : undefined;

    const draft = await saveOnboardingDraft(userId, built.payload, workspaceMode);

    return res.status(201).json({
      success: true,
      message: "Business details saved. Complete Stripe checkout to activate your store.",
      requiresStripe: true,
      draft: {
        workspaceMode: draft.workspaceMode,
        businessName: built.payload.name,
      },
    });
  } catch (error) {
    if (error.status === 400 && error.business) {
      return res.status(400).json({
        message: error.message,
        business: formatBusinessSubscription(error.business),
      });
    }
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("Setup business error:", error);
    return res.status(500).json({ message: "Failed to save business setup.", error: error.message });
  }
}

// PATCH /business/onboarding/workspace-mode
async function patchOnboardingWorkspaceMode(req, res) {
  try {
    const userId = Number(req.user?.id);
    const { workspaceMode } = req.body;
    const draft = await updateOnboardingWorkspaceMode(userId, workspaceMode);
    return res.json({
      success: true,
      workspaceMode: draft.workspaceMode,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("Patch onboarding workspace error:", error);
    return res.status(500).json({ message: "Failed to update workspace preference." });
  }
}

// GET /business/onboarding/status
async function getOnboardingStatus(req, res) {
  try {
    const userId = Number(req.user?.id);
    const [draft, membership] = await Promise.all([
      getOnboardingDraft(userId),
      prisma.businessMember.findUnique({ where: { userId } }),
    ]);

    return res.json({
      success: true,
      hasBusiness: Boolean(membership),
      hasDraft: Boolean(draft),
      draft: draft
        ? {
            workspaceMode: draft.workspaceMode,
            businessName: draft.payload?.name ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("Onboarding status error:", error);
    return res.status(500).json({ message: "Failed to read onboarding status." });
  }
}

function formatBusinessSubscription(biz, { slim = false } = {}) {
  if (!biz) return biz;
  const hasStripeSub = Boolean(biz.stripeSubscriptionId);
  const isSubscribed = biz.subscriptionStatus === "active" || (hasStripeSub && biz.subscriptionStatus !== "canceled");
  const isTrial = !isSubscribed;
  const trialExpired = Boolean(
    !isSubscribed &&
    biz.trialEndsAt &&
    new Date(biz.trialEndsAt).getTime() < Date.now()
  );
  let daysRemaining = 0;
  if (biz.trialEndsAt) {
    daysRemaining = Math.max(0, Math.ceil((new Date(biz.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }
  if (slim) {
    return {
      id: biz.id,
      name: biz.name,
      businessType: biz.businessType,
      mobileNumber: biz.mobileNumber,
      whatsappNumber: biz.whatsappNumber,
      email: biz.email,
      address: biz.address,
      city: biz.city,
      logoUrl: biz.logoUrl,
      allowDiscounts: biz.allowDiscounts,
      workspaceMode: biz.workspaceMode,
      subscriptionStatus: biz.subscriptionStatus,
      trialEndsAt: biz.trialEndsAt,
      ownerId: biz.ownerId,
      isTrial,
      isSubscribed,
      isTrialExpired: trialExpired,
      trialDaysRemaining: daysRemaining,
    };
  }
  return {
    ...biz,
    isTrial,
    isSubscribed,
    isTrialExpired: trialExpired,
    trialDaysRemaining: daysRemaining,
  };
}


// GET /business/my-businesses
async function getMyBusinesses(req, res) {
  try {
    const userId = Number(req.user?.id);
    const memberModel = prisma.businessMember || prisma.BusinessMember;

    if (!memberModel) {
      return res.json({ success: true, businesses: [] });
    }

    // One-business-per-user: return at most one slim membership (no nested collections).
    const memberships = await memberModel.findMany({
      where: { userId },
      select: {
        role: true,
        business: {
          select: {
            id: true,
            name: true,
            businessType: true,
            mobileNumber: true,
            whatsappNumber: true,
            email: true,
            address: true,
            city: true,
            logoUrl: true,
            allowDiscounts: true,
            workspaceMode: true,
            subscriptionStatus: true,
            trialEndsAt: true,
            ownerId: true,
            stripeSubscriptionId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    if (!memberships.length) {
      return res.json({ success: true, businesses: [] });
    }

    // Prioritize owned business first, then primary membership
    const primary = memberships.find((m) => m.business && m.business.ownerId === userId) || memberships[0];
    if (!primary || !primary.business) {
      return res.json({ success: true, businesses: [] });
    }

    const businesses = [
      {
        ...formatBusinessSubscription(primary.business, { slim: true }),
        membershipRole: primary.role,
      },
    ];

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

    const access = await assertBusinessMemberAccess(userId, businessId);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    const membership = memberModel
      ? await memberModel.findUnique({
          where: { businessId_userId: { businessId, userId } },
          include: { business: true },
        })
      : null;

    const rawBiz = membership
      ? { ...membership.business, membershipRole: membership.role }
      : null;

    if (!rawBiz) {
      return res.status(404).json({ message: "Business not found." });
    }

    const business = formatBusinessSubscription(rawBiz);
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

    const manageAccess = await assertBusinessManagementAccess(userId, businessId);
    if (!manageAccess.ok) {
      return res.status(manageAccess.status).json({ message: manageAccess.message });
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
      logoUrl,
      allowDiscounts,
      workspaceMode,
    } = req.body;

    const normalizedWorkspaceMode =
      workspaceMode === "pos" || workspaceMode === "financial" ? workspaceMode : undefined;

    const updated = await bizModel.update({
      where: { id: businessId },
      data: {
        name: patchTrimmedString(name),
        businessType: patchNullableString(businessType),
        businessCategory: patchNullableString(businessCategory),
        mobileNumber: patchNullableString(mobileNumber),
        whatsappNumber: patchNullableString(whatsappNumber),
        email: patchNullableString(email),
        address: patchNullableString(address),
        city: patchNullableString(city),
        area: patchNullableString(area),
        province: patchNullableString(province),
        logoUrl: patchNullableString(logoUrl),
        allowDiscounts: allowDiscounts !== undefined ? Boolean(allowDiscounts) : undefined,
        workspaceMode: normalizedWorkspaceMode,
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

// POST /business/:id/financial-setup
async function completeFinancialSetup(req, res) {
  try {
    const businessId = Number(req.params.id);
    const userId = Number(req.user?.id);
    const memberModel = prisma.businessMember || prisma.BusinessMember;
    const bizModel = prisma.business || prisma.Business;
    const custModel = prisma.customer || prisma.Customer;
    const suppModel = prisma.supplier || prisma.Supplier;
    const prodModel = prisma.product || prisma.Product;
    const logModel = prisma.activityLog || prisma.ActivityLog;
    const stockLogModel = prisma.stockLog || prisma.StockLog;

    if (!bizModel) {
      return res.status(500).json({ message: "Business model not available." });
    }

    const manageAccess = await assertBusinessManagementAccess(userId, businessId);
    if (!manageAccess.ok) {
      return res.status(manageAccess.status).json({ message: manageAccess.message });
    }
    const setupMembership = manageAccess.membership;

    const {
      accountingStartDate,
      openingCashBalance,
      openingBankBalance,
      bankAccounts,
      hasCustomerUdhaar,
      customerReceivable,
      customers,
      hasSupplierUdhaar,
      supplierPayable,
      suppliers,
      manageStock,
      currentStockValue,
      products,
      taxRegistered,
      ntn,
      strn,
      taxBusinessName,
      logoUrl,
    } = req.body;

    let startDate = undefined;
    if (accountingStartDate) {
      const parsedDate = new Date(accountingStartDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Please provide a valid accounting start date." });
      }
      startDate = parsedDate;
    }

    const cashNum = Number(openingCashBalance);
    if (isNaN(cashNum) || cashNum < 0) {
      return res.status(400).json({ message: "Opening cash balance must be a non-negative number." });
    }

    const bankNum = Number(openingBankBalance);
    if (isNaN(bankNum) || bankNum < 0) {
      return res.status(400).json({ message: "Opening bank balance must be a non-negative number." });
    }

    const custRecNum = Number(customerReceivable);
    if (isNaN(custRecNum) || custRecNum < 0) {
      return res.status(400).json({ message: "Customer receivable amount must be a non-negative number." });
    }

    const suppPayNum = Number(supplierPayable);
    if (isNaN(suppPayNum) || suppPayNum < 0) {
      return res.status(400).json({ message: "Supplier payable amount must be a non-negative number." });
    }

    const stockValNum = Number(currentStockValue);
    if (isNaN(stockValNum) || stockValNum < 0) {
      return res.status(400).json({ message: "Current stock value must be a non-negative number." });
    }

    if (taxRegistered === "yes") {
      const cleanNtn = String(ntn || "").trim();
      if (!cleanNtn || cleanNtn.length < 5) {
        return res.status(400).json({ message: "Please enter a valid National Tax Number (NTN)." });
      }
    }

    const customerRows = validateOpeningBalanceRows(customers, "Customer");
    if (!customerRows.ok) {
      return res.status(400).json({ message: customerRows.error });
    }

    const supplierRows = validateOpeningBalanceRows(suppliers, "Supplier");
    if (!supplierRows.ok) {
      return res.status(400).json({ message: supplierRows.error });
    }

    await prisma.$transaction(async (tx) => {
      const txBiz = tx.business || tx.Business;
      const txCust = tx.customer || tx.Customer;
      const txSupp = tx.supplier || tx.Supplier;
      const txProd = tx.product || tx.Product;
      const txStockLog = tx.stockLog || tx.StockLog;
      const txLog = tx.activityLog || tx.ActivityLog;

      // 1. Update Business entity with Sections 4-8 settings
      await txBiz.update({
        where: { id: businessId },
        data: {
          accountingStartDate: startDate,
          openingCashBalance: cashNum,
          openingBankBalance: bankNum,
          bankAccounts: Array.isArray(bankAccounts) ? bankAccounts : [],
          hasCustomerUdhaar: Boolean(hasCustomerUdhaar),
          customerReceivable: custRecNum,
          hasSupplierUdhaar: Boolean(hasSupplierUdhaar),
          supplierPayable: suppPayNum,
          manageStock: manageStock !== undefined ? Boolean(manageStock) : true,
          currentStockValue: stockValNum,
          taxRegistered: taxRegistered || "no",
          ntn: ntn ? String(ntn).trim() : null,
          strn: strn ? String(strn).trim() : null,
          taxBusinessName: taxBusinessName ? String(taxBusinessName).trim() : null,
          logoUrl: logoUrl ? String(logoUrl).trim() : null,
          workspaceMode: "financial",
        },
      });

      // Keep operational cash account openingBalance coherent with business config
      // only when the account has no ledger history yet (do not rewrite historical openings).
      const cashAccount = await tx.account.findUnique({
        where: { businessId_name: { businessId, name: "Cash in hand" } },
      });
      if (!cashAccount) {
        await tx.account.create({
          data: {
            businessId,
            name: "Cash in hand",
            type: "cash",
            openingBalance: cashNum,
          },
        });
      } else {
        const ledgerCount = await tx.ledgerTransaction.count({
          where: { businessId, accountId: cashAccount.id },
        });
        if (ledgerCount === 0) {
          await tx.account.update({
            where: { id: cashAccount.id },
            data: { openingBalance: cashNum },
          });
        }
      }

      // 2. Section 5: Add initial customers if provided
      if (customerRows.parsed.length > 0 && txCust) {
        for (const { row: c, openingBalance: cBal } of customerRows.parsed) {
          const cName = String(c.name || "").trim();
          const cMobile = String(c.mobile || "").trim();
          if (cName && cMobile) {
            const existing = await txCust.findUnique({
              where: { businessId_mobile: { businessId, mobile: cMobile } },
            });
            if (!existing) {
              await txCust.create({
                data: {
                  businessId,
                  name: cName,
                  mobile: cMobile,
                  openingBalance: cBal,
                  currentBalance: cBal,
                },
              });
            }
          }
        }
      }

      // 3. Section 5: Add initial suppliers if provided
      if (supplierRows.parsed.length > 0 && txSupp) {
        for (const { row: s, openingBalance: sBal } of supplierRows.parsed) {
          const sName = String(s.name || "").trim();
          const sMobile = String(s.mobile || "").trim() || null;
          const sEmail = String(s.email || "").trim() || null;
          if (sName) {
            await txSupp.create({
              data: {
                businessId,
                name: sName,
                mobile: sMobile,
                email: sEmail,
                openingBalance: sBal,
                currentBalance: sBal,
              },
            });
          }
        }
      }

      // 4. Section 6: Add initial products & stock logs if provided
      if (Array.isArray(products) && products.length > 0 && txProd) {
        for (const p of products) {
          const pName = String(p.name || "").trim();
          const pBarcode = String(p.barcode || "").trim() || `AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
          const pSellingPrice = Number(p.sellingPrice ?? p.price ?? 0);
          const pCostPrice = Number(p.costPrice ?? 0);
          const pStock = Math.max(0, Math.floor(Number(p.stock ?? 0)));
          const pLowStock = Math.max(1, Math.floor(Number(p.lowStockThreshold ?? 5)));
          const pCategory = p.category ? String(p.category).trim() : "General";

          if (pName) {
            const createdProd = await txProd.upsert({
              where: { businessId_barcode: { businessId, barcode: pBarcode } },
              update: {
                name: pName,
                sellingPrice: pSellingPrice,
                price: pSellingPrice,
                costPrice: pCostPrice,
                stock: pStock,
                lowStockThreshold: pLowStock,
                category: pCategory,
              },
              create: {
                businessId,
                name: pName,
                barcode: pBarcode,
                sellingPrice: pSellingPrice,
                price: pSellingPrice,
                costPrice: pCostPrice,
                stock: pStock,
                lowStockThreshold: pLowStock,
                category: pCategory,
                createdByUserId: userId,
              },
            });

            if (pStock > 0 && txStockLog) {
              await txStockLog.create({
                data: {
                  businessId,
                  productId: createdProd.id,
                  barcode: pBarcode,
                  quantity: pStock,
                  previousStock: 0,
                  newStock: pStock,
                  note: "Initial stock setup (Financial Onboarding)",
                  userId,
                },
              });
            }
          }
        }
      }

      // 5. Activity log
      if (txLog) {
        try {
          await txLog.create({
            data: {
              businessId,
              action: "FINANCIAL_SETUP",
              category: "Business",
              details: `Financial setup completed (Cash: ₨ ${cashNum.toLocaleString()}, Bank: ₨ ${bankNum.toLocaleString()}, Tax: ${taxRegistered})`,
              target: `Business #${businessId}`,
              meta: {
                openingCashBalance: cashNum,
                openingBankBalance: bankNum,
                customerReceivable: custRecNum,
                supplierPayable: suppPayNum,
                taxRegistered,
              },
              userId,
              userName: req.user?.fullName || req.user?.name || "Owner",
              userEmail: req.user?.email || "admin@almadel.com",
              userRole: setupMembership?.role || req.user?.role || "owner",
            },
          });
        } catch (e) {
          console.warn("Log notice:", e.message);
        }
      }
    });

    const updatedBiz = await bizModel.findUnique({
      where: { id: businessId },
      include: {
        customers: true,
        suppliers: true,
        products: { take: 50 },
      },
    });

    return res.json({
      success: true,
      message: "Financial setup completed successfully.",
      business: updatedBiz,
    });
  } catch (error) {
    console.error("Financial setup error:", error);
    return res.status(500).json({ message: "Failed to save financial setup.", error: error.message });
  }
}

module.exports = {
  setupBusiness,
  patchOnboardingWorkspaceMode,
  getOnboardingStatus,
  completeFinancialSetup,
  getMyBusinesses,
  getBusinessDetails,
  updateBusiness,
  formatBusinessSubscription,
};

