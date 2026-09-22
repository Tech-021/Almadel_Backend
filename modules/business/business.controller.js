const db = require("../../db");
const prisma = db.prisma || db;
const { validatePhone, validateEmail, validateText, validateNumber } = require("../../utils/validators");

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

    const nameVal = validateText(name, { minLength: 2, maxLength: 100, fieldName: "Business name" });
    if (!nameVal.valid) {
      return res.status(400).json({ message: nameVal.error });
    }

    const phoneVal = validatePhone(mobileNumber, { required: true, fieldName: "Primary mobile number" });
    if (!phoneVal.valid) {
      return res.status(400).json({ message: phoneVal.error });
    }

    if (whatsappNumber) {
      const whatsappVal = validatePhone(whatsappNumber, { required: false, fieldName: "WhatsApp number" });
      if (!whatsappVal.valid) {
        return res.status(400).json({ message: whatsappVal.error });
      }
    }

    if (email) {
      const emailVal = validateEmail(email, { required: false, fieldName: "Business email" });
      if (!emailVal.valid) {
        return res.status(400).json({ message: emailVal.error });
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
          subscriptionStatus: "trialing",
          trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

    // Verify ownership / membership
    if (memberModel) {
      const membership = await memberModel.findUnique({
        where: { businessId_userId: { businessId, userId } },
      });
      if (!membership && req.user.role !== "admin") {
        return res.status(403).json({ message: "You do not have access to manage this business." });
      }
    }

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

      // 2. Section 5: Add initial customers if provided
      if (Array.isArray(customers) && customers.length > 0 && txCust) {
        for (const c of customers) {
          const cName = String(c.name || "").trim();
          const cMobile = String(c.mobile || "").trim();
          const cBal = Number(c.openingBalance) || 0;
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
      if (Array.isArray(suppliers) && suppliers.length > 0 && txSupp) {
        for (const s of suppliers) {
          const sName = String(s.name || "").trim();
          const sMobile = String(s.mobile || "").trim() || null;
          const sEmail = String(s.email || "").trim() || null;
          const sBal = Number(s.openingBalance) || 0;
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
              userRole: req.user?.role || "admin",
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
  completeFinancialSetup,
  getMyBusinesses,
  getBusinessDetails,
  updateBusiness,
};
