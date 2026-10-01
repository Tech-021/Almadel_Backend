/**
 * Dedicated ACID suite for all application tables in almadel_stress.
 * Focused integrity checks only — no volume/query benchmarks.
 */

const { WORST_CASE_BUSINESS } = require("../lib/constants");

function prisma() {
  return require("../../db").prisma;
}

function row(principle, test, expected, actual, pass, tables = []) {
  return {
    principle,
    test,
    expected,
    actual,
    result: pass ? "PASS" : "FAIL",
    tables,
  };
}

async function resolveBusiness() {
  const business = await prisma().business.findFirst({
    where: { name: WORST_CASE_BUSINESS },
    select: { id: true, name: true, ownerId: true },
  });
  if (!business) {
    throw new Error(
      `Missing worst-case business '${WORST_CASE_BUSINESS}'. Seed team/products first.`,
    );
  }
  return business;
}

async function ensureAccount(businessId) {
  const existing = await prisma().account.findFirst({
    where: { businessId, isActive: true },
    orderBy: { id: "asc" },
  });
  if (existing) return existing;
  return prisma().account.create({
    data: {
      businessId,
      name: `ACID-CASH-${Date.now()}`,
      type: "cash",
      openingBalance: 0,
    },
  });
}

async function runAtomicity(business) {
  const results = [];
  const stamp = Date.now();
  const account = await ensureAccount(business.id);

  // products + stock_logs
  const product = await prisma().product.findFirst({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
    orderBy: { id: "asc" },
  });
  if (!product) throw new Error("Need STRESS-P-* products for ACID suite.");
  const stockBefore = product.stock;
  const logsBefore = await prisma().stockLog.count({ where: { productId: product.id } });
  let aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: { stock: { increment: 3 } },
      });
      await tx.stockLog.create({
        data: {
          businessId: business.id,
          productId: product.id,
          barcode: product.barcode,
          quantity: 3,
          previousStock: stockBefore,
          newStock: stockBefore + 3,
          note: `acid-stock-${stamp}`,
          userId: business.ownerId,
        },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  const stockAfter = await prisma().product.findUnique({ where: { id: product.id } });
  const logsAfter = await prisma().stockLog.count({ where: { productId: product.id } });
  results.push(
    row(
      "Atomicity",
      "products + stock_logs rollback",
      "No stock change and no stock_log row",
      `stock ${stockBefore}->${stockAfter.stock}, logs ${logsBefore}->${logsAfter}`,
      aborted && stockAfter.stock === stockBefore && logsAfter === logsBefore,
      ["products", "stock_logs"],
    ),
  );

  // sales + sale_items + products
  const saleProduct = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `ACID-SALE-${stamp}`,
      name: "ACID sale product",
      price: 10,
      sellingPrice: 10,
      stock: 15,
      createdByUserId: business.ownerId,
    },
  });
  aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          businessId: business.id,
          invoiceNumber: `ACID-SALE-INV-${stamp}`,
          subtotal: 10,
          totalAmount: 10,
          totalItems: 1,
          paymentMethod: "cash",
          userId: business.ownerId,
        },
      });
      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId: saleProduct.id,
          barcode: saleProduct.barcode,
          name: saleProduct.name,
          price: 10,
          quantity: 1,
          total: 10,
        },
      });
      await tx.product.update({
        where: { id: saleProduct.id },
        data: { stock: { decrement: 1 } },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  const saleOrphan = await prisma().sale.findFirst({
    where: { businessId: business.id, invoiceNumber: `ACID-SALE-INV-${stamp}` },
  });
  const saleProductAfter = await prisma().product.findUnique({ where: { id: saleProduct.id } });
  results.push(
    row(
      "Atomicity",
      "sales + sale_items + products rollback",
      "No sale/item; stock unchanged",
      `orphanSale=${Boolean(saleOrphan)}, stock ${saleProduct.stock}->${saleProductAfter.stock}`,
      aborted && !saleOrphan && saleProductAfter.stock === saleProduct.stock,
      ["sales", "sale_items", "products"],
    ),
  );
  await prisma().product.delete({ where: { id: saleProduct.id } }).catch(() => {});

  // expenses + ledger_transactions
  aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          businessId: business.id,
          accountId: account.id,
          amount: 12,
          category: "ACID",
          description: `acid-exp-${stamp}`,
          createdById: business.ownerId,
        },
      });
      await tx.ledgerTransaction.create({
        data: {
          businessId: business.id,
          accountId: account.id,
          expenseId: expense.id,
          type: "expense",
          direction: "debit",
          amount: 12,
          note: `acid-exp-led-${stamp}`,
          createdById: business.ownerId,
        },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  const expOrphan = await prisma().expense.findFirst({
    where: { businessId: business.id, description: `acid-exp-${stamp}` },
  });
  const ledOrphan = await prisma().ledgerTransaction.findFirst({
    where: { businessId: business.id, note: `acid-exp-led-${stamp}` },
  });
  results.push(
    row(
      "Atomicity",
      "expenses + ledger_transactions (expenseId) rollback",
      "Neither expense nor ledger survives",
      `orphanExpense=${Boolean(expOrphan)}, orphanLedger=${Boolean(ledOrphan)}`,
      aborted && !expOrphan && !ledOrphan,
      ["expenses", "ledger_transactions"],
    ),
  );

  // payments + ledger_transactions
  let createdPayCustomer = false;
  let customer = await prisma().customer.findFirst({ where: { businessId: business.id } });
  if (!customer) {
    customer = await prisma().customer.create({
      data: {
        businessId: business.id,
        name: "ACID pay customer",
        mobile: `0398${String(stamp).slice(-7)}`,
      },
    });
    createdPayCustomer = true;
  }
  aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          businessId: business.id,
          accountId: account.id,
          customerId: customer.id,
          amount: 8,
          type: "customer",
          method: "cash",
          reference: `acid-pay-${stamp}`,
          createdById: business.ownerId,
        },
      });
      await tx.ledgerTransaction.create({
        data: {
          businessId: business.id,
          accountId: account.id,
          paymentId: payment.id,
          type: "payment",
          direction: "credit",
          amount: 8,
          note: `acid-pay-led-${stamp}`,
          createdById: business.ownerId,
        },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  const payOrphan = await prisma().payment.findFirst({
    where: { businessId: business.id, reference: `acid-pay-${stamp}` },
  });
  results.push(
    row(
      "Atomicity",
      "payments + ledger_transactions (paymentId) rollback",
      "Neither payment nor ledger survives",
      `orphanPayment=${Boolean(payOrphan)}`,
      aborted && !payOrphan,
      ["payments", "ledger_transactions"],
    ),
  );

  // business_onboarding_drafts + User
  const draftUser = await prisma().user.create({
    data: {
      email: `acid_draft_${stamp}@example.test`,
      fullName: "ACID Draft",
      passwordHash: "x",
      role: "pending",
    },
  });
  aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      await tx.businessOnboardingDraft.create({
        data: {
          userId: draftUser.id,
          payload: { name: "ACID Shop" },
          workspaceMode: "pos",
        },
      });
      await tx.user.update({
        where: { id: draftUser.id },
        data: { fullName: "ACID Draft Mutated" },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  const drafts = await prisma().businessOnboardingDraft.count({ where: { userId: draftUser.id } });
  const draftUserAfter = await prisma().user.findUnique({ where: { id: draftUser.id } });
  results.push(
    row(
      "Atomicity",
      "business_onboarding_drafts + User rollback",
      "No draft; user name unchanged",
      `drafts=${drafts}, name=${draftUserAfter?.fullName}`,
      aborted && drafts === 0 && draftUserAfter?.fullName === "ACID Draft",
      ["business_onboarding_drafts", "User"],
    ),
  );

  // categories + activity_logs (multi-write rollback)
  aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      await tx.category.create({
        data: {
          businessId: business.id,
          name: `ACID-CAT-${stamp}`,
          description: "rollback me",
        },
      });
      await tx.activityLog.create({
        data: {
          businessId: business.id,
          userId: business.ownerId,
          userName: "ACID",
          userEmail: "acid@example.test",
          userRole: "owner",
          action: "acid.category",
          category: "Product",
          details: `acid-cat-${stamp}`,
          target: `ACID-CAT-${stamp}`,
        },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  const catOrphan = await prisma().category.findFirst({
    where: { businessId: business.id, name: `ACID-CAT-${stamp}` },
  });
  const logOrphan = await prisma().activityLog.findFirst({
    where: { businessId: business.id, details: `acid-cat-${stamp}` },
  });
  results.push(
    row(
      "Atomicity",
      "categories + activity_logs rollback",
      "Neither category nor activity log survives",
      `orphanCategory=${Boolean(catOrphan)}, orphanLog=${Boolean(logOrphan)}`,
      aborted && !catOrphan && !logOrphan,
      ["categories", "activity_logs"],
    ),
  );

  // branches + suppliers rollback
  aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      await tx.branch.create({
        data: {
          businessId: business.id,
          name: `ACID-BR-${stamp}`,
        },
      });
      await tx.supplier.create({
        data: {
          businessId: business.id,
          name: `ACID-SUP-${stamp}`,
          mobile: `0397${String(stamp).slice(-7)}`,
        },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  const brOrphan = await prisma().branch.findFirst({
    where: { businessId: business.id, name: `ACID-BR-${stamp}` },
  });
  const supOrphan = await prisma().supplier.findFirst({
    where: { businessId: business.id, name: `ACID-SUP-${stamp}` },
  });
  results.push(
    row(
      "Atomicity",
      "branches + suppliers rollback",
      "Neither branch nor supplier survives",
      `orphanBranch=${Boolean(brOrphan)}, orphanSupplier=${Boolean(supOrphan)}`,
      aborted && !brOrphan && !supOrphan,
      ["branches", "suppliers"],
    ),
  );

  // business_members + PasswordResetToken rollback on temp user
  const memberUser = await prisma().user.create({
    data: {
      email: `acid_member_${stamp}@example.test`,
      fullName: "ACID Member",
      passwordHash: "x",
      role: "staff",
    },
  });
  aborted = false;
  try {
    await prisma().$transaction(async (tx) => {
      await tx.businessMember.create({
        data: {
          businessId: business.id,
          userId: memberUser.id,
          role: "staff",
        },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: memberUser.id,
          tokenHash: `acid-hash-${stamp}`,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  // Note: userId is unique on business_members globally — may conflict if prior junk.
  // We use a fresh user so it should be fine.
  const memberOrphan = await prisma().businessMember.findFirst({
    where: { businessId: business.id, userId: memberUser.id },
  });
  const tokenOrphan = await prisma().passwordResetToken.findFirst({
    where: { tokenHash: `acid-hash-${stamp}` },
  });
  results.push(
    row(
      "Atomicity",
      "business_members + PasswordResetToken rollback",
      "Neither membership nor reset token survives",
      `orphanMember=${Boolean(memberOrphan)}, orphanToken=${Boolean(tokenOrphan)}`,
      aborted && !memberOrphan && !tokenOrphan,
      ["business_members", "PasswordResetToken"],
    ),
  );

  // daily_closings + accounts opening tweak rollback
  // avoid unique collision: use a far future date marker day
  const acidDate = new Date("2099-01-01T00:00:00.000Z");
  aborted = false;
  const accountBefore = await prisma().account.findUnique({ where: { id: account.id } });
  try {
    await prisma().$transaction(async (tx) => {
      await tx.dailyClosing.create({
        data: {
          businessId: business.id,
          businessDate: acidDate,
          status: "open",
          openingCash: 100,
          expectedCash: 100,
        },
      });
      await tx.account.update({
        where: { id: account.id },
        data: { openingBalance: { increment: 1 } },
      });
      throw new Error("forced rollback");
    });
  } catch (e) {
    aborted = /forced rollback/.test(e.message);
  }
  const closingOrphan = await prisma().dailyClosing.findFirst({
    where: { businessId: business.id, businessDate: acidDate },
  });
  const accountAfter = await prisma().account.findUnique({ where: { id: account.id } });
  results.push(
    row(
      "Atomicity",
      "daily_closings + accounts rollback",
      "No closing row; account openingBalance unchanged",
      `orphanClosing=${Boolean(closingOrphan)}, opening ${accountBefore.openingBalance}->${accountAfter.openingBalance}`,
      aborted &&
        !closingOrphan &&
        Number(accountAfter.openingBalance) === Number(accountBefore.openingBalance),
      ["daily_closings", "accounts"],
    ),
  );

  // cleanup temp users/customers created only for this suite
  await prisma().user.delete({ where: { id: draftUser.id } }).catch(() => {});
  await prisma().user.delete({ where: { id: memberUser.id } }).catch(() => {});
  if (createdPayCustomer) {
    await prisma().customer.delete({ where: { id: customer.id } }).catch(() => {});
  }

  return results;
}

async function runConsistency(business) {
  const results = [];
  const stamp = Date.now();
  const account = await ensureAccount(business.id);

  // User.email unique
  const existingUser =
    (await prisma().user.findFirst({ where: { email: { startsWith: "stress_" } } })) ||
    (await prisma().user.findUnique({ where: { id: business.ownerId } }));
  let blocked = false;
  try {
    await prisma().user.create({
      data: {
        email: existingUser.email,
        fullName: "dup",
        passwordHash: "x",
        role: "staff",
      },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row("Consistency", "User.email unique", "Reject duplicate", blocked ? "rejected" : "accepted", blocked, [
      "User",
    ]),
  );

  // products (businessId, barcode)
  const p = await prisma().product.findFirst({
    where: { businessId: business.id, barcode: { startsWith: "STRESS-P-" } },
  });
  blocked = false;
  try {
    await prisma().product.create({
      data: {
        businessId: business.id,
        barcode: p.barcode,
        name: "dup",
        price: 1,
        sellingPrice: 1,
        stock: 0,
      },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "products unique(businessId, barcode)",
      "Reject duplicate",
      blocked ? "rejected" : "accepted",
      blocked,
      ["products"],
    ),
  );

  // customers unique(businessId, mobile)
  const c =
    (await prisma().customer.findFirst({ where: { businessId: business.id } })) ||
    (await prisma().customer.create({
      data: { businessId: business.id, name: "ACID C", mobile: `0396${String(stamp).slice(-7)}` },
    }));
  blocked = false;
  try {
    await prisma().customer.create({
      data: { businessId: business.id, name: "dup", mobile: c.mobile },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "customers unique(businessId, mobile)",
      "Reject duplicate",
      blocked ? "rejected" : "accepted",
      blocked,
      ["customers"],
    ),
  );

  // categories unique(businessId, name)
  const cat = await prisma().category.create({
    data: { businessId: business.id, name: `ACID-UCAT-${stamp}` },
  });
  blocked = false;
  try {
    await prisma().category.create({
      data: { businessId: business.id, name: cat.name },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "categories unique(businessId, name)",
      "Reject duplicate",
      blocked ? "rejected" : "accepted",
      blocked,
      ["categories"],
    ),
  );
  await prisma().category.delete({ where: { id: cat.id } }).catch(() => {});

  // accounts unique(businessId, name)
  const acc = await prisma().account.create({
    data: { businessId: business.id, name: `ACID-UACC-${stamp}`, type: "cash" },
  });
  blocked = false;
  try {
    await prisma().account.create({
      data: { businessId: business.id, name: acc.name, type: "cash" },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "accounts unique(businessId, name)",
      "Reject duplicate",
      blocked ? "rejected" : "accepted",
      blocked,
      ["accounts"],
    ),
  );
  await prisma().account.delete({ where: { id: acc.id } }).catch(() => {});

  // branches unique(businessId, name)
  const br = await prisma().branch.create({
    data: { businessId: business.id, name: `ACID-UBR-${stamp}` },
  });
  blocked = false;
  try {
    await prisma().branch.create({
      data: { businessId: business.id, name: br.name },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "branches unique(businessId, name)",
      "Reject duplicate",
      blocked ? "rejected" : "accepted",
      blocked,
      ["branches"],
    ),
  );
  await prisma().branch.delete({ where: { id: br.id } }).catch(() => {});

  // sales unique(businessId, invoiceNumber)
  const inv = `ACID-UINV-${stamp}`;
  await prisma().sale.create({
    data: {
      businessId: business.id,
      invoiceNumber: inv,
      subtotal: 1,
      totalAmount: 1,
      totalItems: 1,
      paymentMethod: "cash",
      userId: business.ownerId,
    },
  });
  blocked = false;
  try {
    await prisma().sale.create({
      data: {
        businessId: business.id,
        invoiceNumber: inv,
        subtotal: 2,
        totalAmount: 2,
        totalItems: 1,
        paymentMethod: "cash",
        userId: business.ownerId,
      },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "sales unique(businessId, invoiceNumber)",
      "Reject duplicate",
      blocked ? "rejected" : "accepted",
      blocked,
      ["sales"],
    ),
  );
  await prisma().sale.deleteMany({ where: { businessId: business.id, invoiceNumber: inv } });

  // daily_closings unique(businessId, businessDate)
  const d = new Date("2099-06-01T00:00:00.000Z");
  await prisma().dailyClosing.create({
    data: {
      businessId: business.id,
      businessDate: d,
      status: "open",
    },
  });
  blocked = false;
  try {
    await prisma().dailyClosing.create({
      data: {
        businessId: business.id,
        businessDate: d,
        status: "open",
      },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "daily_closings unique(businessId, businessDate)",
      "Reject duplicate",
      blocked ? "rejected" : "accepted",
      blocked,
      ["daily_closings"],
    ),
  );
  await prisma().dailyClosing.deleteMany({
    where: { businessId: business.id, businessDate: d },
  });

  // business_onboarding_drafts.userId unique
  const du = await prisma().user.create({
    data: {
      email: `acid_udraft_${stamp}@example.test`,
      fullName: "u",
      passwordHash: "x",
      role: "pending",
    },
  });
  await prisma().businessOnboardingDraft.create({
    data: { userId: du.id, payload: { a: 1 }, workspaceMode: "pos" },
  });
  blocked = false;
  try {
    await prisma().businessOnboardingDraft.create({
      data: { userId: du.id, payload: { a: 2 }, workspaceMode: "pos" },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "business_onboarding_drafts.userId unique",
      "Reject second draft",
      blocked ? "rejected" : "accepted",
      blocked,
      ["business_onboarding_drafts"],
    ),
  );
  await prisma().businessOnboardingDraft.deleteMany({ where: { userId: du.id } });
  await prisma().user.delete({ where: { id: du.id } }).catch(() => {});

  // ledger_transactions.expenseId unique
  const expense = await prisma().expense.create({
    data: {
      businessId: business.id,
      accountId: account.id,
      amount: 3,
      category: "ACID",
      description: `u-exp-${stamp}`,
      createdById: business.ownerId,
    },
  });
  await prisma().ledgerTransaction.create({
    data: {
      businessId: business.id,
      accountId: account.id,
      expenseId: expense.id,
      type: "expense",
      direction: "debit",
      amount: 3,
      createdById: business.ownerId,
    },
  });
  blocked = false;
  try {
    await prisma().ledgerTransaction.create({
      data: {
        businessId: business.id,
        accountId: account.id,
        expenseId: expense.id,
        type: "expense",
        direction: "debit",
        amount: 3,
        createdById: business.ownerId,
      },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "ledger_transactions.expenseId unique",
      "Reject second ledger for same expense",
      blocked ? "rejected" : "accepted",
      blocked,
      ["ledger_transactions", "expenses"],
    ),
  );
  await prisma().ledgerTransaction.deleteMany({ where: { expenseId: expense.id } });
  await prisma().expense.delete({ where: { id: expense.id } }).catch(() => {});

  // PasswordResetToken.tokenHash unique
  const tokenUser = await prisma().user.create({
    data: {
      email: `acid_token_${stamp}@example.test`,
      fullName: "t",
      passwordHash: "x",
      role: "staff",
    },
  });
  await prisma().passwordResetToken.create({
    data: {
      userId: tokenUser.id,
      tokenHash: `acid-th-${stamp}`,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  blocked = false;
  try {
    await prisma().passwordResetToken.create({
      data: {
        userId: tokenUser.id,
        tokenHash: `acid-th-${stamp}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "PasswordResetToken.tokenHash unique",
      "Reject duplicate hash",
      blocked ? "rejected" : "accepted",
      blocked,
      ["PasswordResetToken"],
    ),
  );
  await prisma().passwordResetToken.deleteMany({ where: { userId: tokenUser.id } });
  await prisma().user.delete({ where: { id: tokenUser.id } }).catch(() => {});

  // business_members.userId unique (one business per user)
  const mu = await prisma().user.create({
    data: {
      email: `acid_bm_${stamp}@example.test`,
      fullName: "bm",
      passwordHash: "x",
      role: "staff",
    },
  });
  await prisma().businessMember.create({
    data: { businessId: business.id, userId: mu.id, role: "staff" },
  });
  // Create a second business owned by worst-case owner? ownerId is unique — need another owner
  const otherOwner = await prisma().user.create({
    data: {
      email: `acid_owner2_${stamp}@example.test`,
      fullName: "o2",
      passwordHash: "x",
      role: "owner",
    },
  });
  const otherBiz = await prisma().business.create({
    data: {
      name: `acid_other_biz_${stamp}`,
      mobileNumber: "03001112222",
      ownerId: otherOwner.id,
    },
  });
  blocked = false;
  try {
    await prisma().businessMember.create({
      data: { businessId: otherBiz.id, userId: mu.id, role: "staff" },
    });
  } catch (e) {
    blocked = e.code === "P2002";
  }
  results.push(
    row(
      "Consistency",
      "business_members.userId unique (one membership)",
      "Reject second membership for same user",
      blocked ? "rejected" : "accepted",
      blocked,
      ["business_members"],
    ),
  );
  await prisma().businessMember.deleteMany({ where: { userId: mu.id } });
  await prisma().business.delete({ where: { id: otherBiz.id } }).catch(() => {});
  await prisma().user.delete({ where: { id: mu.id } }).catch(() => {});
  await prisma().user.delete({ where: { id: otherOwner.id } }).catch(() => {});

  // businesses.ownerId ON DELETE RESTRICT
  blocked = false;
  try {
    await prisma().user.delete({ where: { id: business.ownerId } });
  } catch (e) {
    blocked = e.code === "P2003" || /foreign key|restrict/i.test(e.message || "");
  }
  const ownerAlive = await prisma().user.findUnique({
    where: { id: business.ownerId },
    select: { id: true },
  });
  results.push(
    row(
      "Consistency",
      "businesses.ownerId ON DELETE RESTRICT",
      "Cannot delete owning user",
      blocked && ownerAlive ? "rejected" : "accepted/missing",
      Boolean(blocked && ownerAlive),
      ["businesses", "User"],
    ),
  );

  // stock oversell guard (application-level consistency pattern)
  const guard = await prisma().product.create({
    data: {
      businessId: business.id,
      barcode: `ACID-GUARD-${stamp}`,
      name: "guard",
      price: 1,
      sellingPrice: 1,
      stock: 2,
      createdByUserId: business.ownerId,
    },
  });
  const first = await prisma().product.updateMany({
    where: { id: guard.id, stock: { gte: 2 } },
    data: { stock: { decrement: 2 } },
  });
  const second = await prisma().product.updateMany({
    where: { id: guard.id, stock: { gte: 2 } },
    data: { stock: { decrement: 2 } },
  });
  const final = await prisma().product.findUnique({ where: { id: guard.id } });
  const guardOk = first.count === 1 && second.count === 0 && final.stock === 0;
  results.push(
    row(
      "Consistency",
      "products conditional stock decrement",
      "Second oversell update affects 0 rows",
      `first=${first.count}, second=${second.count}, stock=${final.stock}`,
      guardOk,
      ["products"],
    ),
  );
  await prisma().product.delete({ where: { id: guard.id } }).catch(() => {});

  // suppliers: no unique mobile required — durability-style insert constraint via business FK
  blocked = false;
  try {
    await prisma().supplier.create({
      data: { businessId: 999999991, name: "bad", mobile: "0300" },
    });
  } catch (e) {
    blocked = e.code === "P2003" || /foreign key/i.test(e.message || "");
  }
  results.push(
    row(
      "Consistency",
      "suppliers.businessId foreign key",
      "Reject missing business",
      blocked ? "rejected" : "accepted",
      blocked,
      ["suppliers", "businesses"],
    ),
  );

  // activity_logs FK to business
  blocked = false;
  try {
    await prisma().activityLog.create({
      data: {
        businessId: 999999991,
        userName: "x",
        userEmail: "x@t.com",
        action: "x",
        category: "Auth",
        details: "x",
      },
    });
  } catch (e) {
    blocked = e.code === "P2003" || /foreign key/i.test(e.message || "");
  }
  results.push(
    row(
      "Consistency",
      "activity_logs.businessId foreign key",
      "Reject missing business",
      blocked ? "rejected" : "accepted",
      blocked,
      ["activity_logs", "businesses"],
    ),
  );

  return results;
}

async function runIsolation(business, levels) {
  const results = [];
  const integrity = [];
  for (const concurrency of levels) {
    const product = await prisma().product.create({
      data: {
        businessId: business.id,
        barcode: `ACID-ISO-${Date.now()}-${concurrency}`,
        name: "iso",
        price: 1,
        sellingPrice: 1,
        stock: 1000,
        createdByUserId: business.ownerId,
      },
    });
    const outcomes = await Promise.all(
      Array.from({ length: concurrency }, () =>
        prisma().product.updateMany({
          where: { id: product.id, stock: { gte: 1 } },
          data: { stock: { decrement: 1 } },
        }),
      ),
    );
    const successful = outcomes.filter((o) => o.count === 1).length;
    const after = await prisma().product.findUnique({ where: { id: product.id } });
    const expected = 1000 - successful;
    const pass = after.stock === expected;
    results.push(
      row(
        "Isolation",
        `${concurrency} concurrent stock decrements`,
        `stock = ${expected}`,
        `successful=${successful}, stock=${after.stock}`,
        pass,
        ["products"],
      ),
    );
    integrity.push({
      test: `${concurrency} concurrent DB decrements`,
      initial: 1000,
      successful,
      failed: concurrency - successful,
      expected,
      actual: after.stock,
      result: pass ? "PASS" : "DATA INTEGRITY FAILURE",
    });
    await prisma().product.delete({ where: { id: product.id } }).catch(() => {});
  }
  return { results, integrity };
}

async function runDurability(business) {
  const results = [];
  const stamp = Date.now();
  const account = await ensureAccount(business.id);

  const cases = [
    {
      tables: ["products"],
      write: () =>
        prisma().product.create({
          data: {
            businessId: business.id,
            barcode: `ACID-DUR-P-${stamp}`,
            name: "dur product",
            price: 5,
            sellingPrice: 5,
            stock: 7,
            createdByUserId: business.ownerId,
          },
        }),
      read: (id) => prisma().$queryRaw`SELECT id, stock FROM products WHERE id = ${id}`,
      check: (rows) => rows[0] && Number(rows[0].stock) === 7,
      cleanup: (id) => prisma().product.delete({ where: { id } }),
    },
    {
      tables: ["customers"],
      write: () =>
        prisma().customer.create({
          data: {
            businessId: business.id,
            name: "dur customer",
            mobile: `0395${String(stamp).slice(-7)}`,
          },
        }),
      read: (id) => prisma().$queryRaw`SELECT id, name FROM customers WHERE id = ${id}`,
      check: (rows) => rows[0] && rows[0].name === "dur customer",
      cleanup: (id) => prisma().customer.delete({ where: { id } }),
    },
    {
      tables: ["expenses"],
      write: () =>
        prisma().expense.create({
          data: {
            businessId: business.id,
            accountId: account.id,
            amount: 4.5,
            category: "ACID-DUR",
            description: `dur-${stamp}`,
            createdById: business.ownerId,
          },
        }),
      read: (id) =>
        prisma().$queryRaw`SELECT id, amount FROM expenses WHERE id = ${id}`,
      check: (rows) => rows[0] && Number(rows[0].amount) === 4.5,
      cleanup: (id) => prisma().expense.delete({ where: { id } }),
    },
    {
      tables: ["business_onboarding_drafts", "User"],
      write: async () => {
        const u = await prisma().user.create({
          data: {
            email: `acid_dur_draft_${stamp}@example.test`,
            fullName: "dur",
            passwordHash: "x",
            role: "pending",
          },
        });
        const d = await prisma().businessOnboardingDraft.create({
          data: { userId: u.id, payload: { ok: true }, workspaceMode: "pos" },
        });
        return { id: d.id, userId: u.id };
      },
      read: (created) =>
        prisma().$queryRaw`SELECT id FROM business_onboarding_drafts WHERE id = ${created.id}`,
      check: (rows) => Boolean(rows[0]),
      cleanup: async (created) => {
        await prisma().businessOnboardingDraft.deleteMany({ where: { id: created.id } });
        await prisma().user.delete({ where: { id: created.userId } }).catch(() => {});
      },
    },
  ];

  for (const c of cases) {
    const created = await c.write();
    const id = created.id ?? created;
    const rows = await c.read(typeof created === "object" && created.userId ? created : id);
    const pass = c.check(rows);
    results.push(
      row(
        "Durability",
        `Commit + re-read ${c.tables.join("+")}`,
        "Committed row visible via SQL",
        pass ? "visible" : "missing/mismatch",
        pass,
        c.tables,
      ),
    );
    await c.cleanup(typeof created === "object" && created.userId ? created : id).catch(() => {});
  }

  return results;
}

function coverageSummary(acidRows) {
  const allTables = [
    "User",
    "PasswordResetToken",
    "business_onboarding_drafts",
    "businesses",
    "business_members",
    "categories",
    "products",
    "sale_items",
    "stock_logs",
    "customers",
    "suppliers",
    "sales",
    "activity_logs",
    "accounts",
    "ledger_transactions",
    "expenses",
    "payments",
    "daily_closings",
    "branches",
  ];
  const touched = new Set();
  for (const r of acidRows) {
    for (const t of r.tables || []) touched.add(t);
  }
  return {
    tables: allTables.map((table) => ({
      table,
      covered: touched.has(table),
    })),
    coveredCount: allTables.filter((t) => touched.has(t)).length,
    totalTables: allTables.length,
  };
}

async function runAcidSuite(config) {
  const business = await resolveBusiness();
  const isolationLevels =
    config.profileName === "smoke" ? [10, 50] : [10, 50, 100, 250];

  const acid = [];
  acid.push(...(await runAtomicity(business)));
  acid.push(...(await runConsistency(business)));
  const iso = await runIsolation(business, isolationLevels);
  acid.push(...iso.results);
  acid.push(...(await runDurability(business)));

  const failed = acid.filter((r) => r.result !== "PASS").length;
  const byPrinciple = ["Atomicity", "Consistency", "Isolation", "Durability"].map((p) => {
    const rows = acid.filter((r) => r.principle === p);
    return {
      principle: p,
      total: rows.length,
      pass: rows.filter((r) => r.result === "PASS").length,
      fail: rows.filter((r) => r.result !== "PASS").length,
    };
  });

  return {
    scenario: "DEDICATED ACID (all tables)",
    kind: "database-acid",
    businessId: business.id,
    acid,
    integrity: iso.integrity,
    coverage: coverageSummary(acid),
    byPrinciple,
    summary: {
      acidTotal: acid.length,
      acidPass: acid.length - failed,
      acidFail: failed,
    },
  };
}

module.exports = { runAcidSuite };
