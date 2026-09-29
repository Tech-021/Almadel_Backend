const { prisma } = require("../../db");

const n = (v) => Number(v);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseQueryDate(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { ok: true, value: null };
  }

  const raw = String(value).trim();
  if (!ISO_DATE.test(raw)) {
    return {
      ok: false,
      field: fieldName,
      message: `Invalid ${fieldName} date. Use YYYY-MM-DD.`,
    };
  }

  const [year, month, day] = raw.split("-").map((part) => Number(part));
  const dayStart = new Date(`${raw}T00:00:00.000`);
  if (
    Number.isNaN(dayStart.getTime()) ||
    dayStart.getFullYear() !== year ||
    dayStart.getMonth() + 1 !== month ||
    dayStart.getDate() !== day
  ) {
    return {
      ok: false,
      field: fieldName,
      message: `Invalid ${fieldName} date.`,
    };
  }

  return { ok: true, value: raw };
}

function buildFinanceDateRange(req) {
  const hasTo = req.query.to != null && String(req.query.to).trim() !== "";
  const hasFrom = req.query.from != null && String(req.query.from).trim() !== "";

  let end;
  if (hasTo) {
    const parsedTo = parseQueryDate(req.query.to, "to");
    if (!parsedTo.ok) return parsedTo;
    end = new Date(`${parsedTo.value}T23:59:59.999`);
  } else {
    end = new Date();
  }

  let start;
  if (hasFrom) {
    const parsedFrom = parseQueryDate(req.query.from, "from");
    if (!parsedFrom.ok) return parsedFrom;
    start = new Date(`${parsedFrom.value}T00:00:00.000`);
  } else {
    start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  }

  if (Number.isNaN(end.getTime())) {
    return { ok: false, field: "to", message: "Invalid to date." };
  }

  if (start.getTime() > end.getTime()) {
    return {
      ok: false,
      field: "from",
      message: "from date cannot be after to date.",
    };
  }

  return { ok: true, gte: start, lte: end };
}

/** Returns `{ gte, lte }` or sends 400 and returns null. */
function requireFinanceDateRange(req, res) {
  const built = buildFinanceDateRange(req);
  if (!built.ok) {
    res.status(400).json({ message: built.message, field: built.field });
    return null;
  }
  return { gte: built.gte, lte: built.lte };
}
function validAmount(v) { return Number.isFinite(n(v)) && n(v) > 0; }
async function accountFor(tx, businessId, accountId) {
  const account = await tx.account.findFirst({ where: { id: n(accountId), businessId, isActive: true } });
  if (!account) throw new Error("Account not found for this business.");
  return account;
}
async function addLedger(tx, data) {
  return tx.ledgerTransaction.create({ data: { ...data, amount: n(data.amount) } });
}

async function getCashAccountIds(client, businessId) {
  const accounts = await client.account.findMany({
    where: {
      businessId,
      isActive: true,
      type: { equals: "cash", mode: "insensitive" },
    },
    select: { id: true },
  });
  return accounts.map((a) => a.id);
}

async function sumLedgerNetForDay(client, businessId, day, end, accountFilter) {
  const where = {
    businessId,
    occurredAt: { gte: day, lte: end },
    ...accountFilter,
  };

  const [credits, debits] = await Promise.all([
    client.ledgerTransaction.aggregate({
      where: { ...where, direction: "credit" },
      _sum: { amount: true },
    }),
    client.ledgerTransaction.aggregate({
      where: { ...where, direction: "debit" },
      _sum: { amount: true },
    }),
  ]);

  const creditTotal = credits._sum.amount || 0;
  const debitTotal = debits._sum.amount || 0;
  return {
    credits: creditTotal,
    debits: debitTotal,
    net: creditTotal - debitTotal,
  };
}

async function cashAndNonCashMovementForDay(client, businessId, day, end) {
  const cashAccountIds = await getCashAccountIds(client, businessId);

  const cashFilter =
    cashAccountIds.length > 0 ? { accountId: { in: cashAccountIds } } : { accountId: { in: [] } };

  const nonCashFilter =
    cashAccountIds.length > 0 ? { accountId: { notIn: cashAccountIds } } : {};

  const [cashMovement, nonCashMovement] = await Promise.all([
    sumLedgerNetForDay(client, businessId, day, end, cashFilter),
    sumLedgerNetForDay(client, businessId, day, end, nonCashFilter),
  ]);

  return { cashAccountIds, cashMovement, nonCashMovement };
}

async function listAccounts(req, res) {
  const accounts = await prisma.account.findMany({ where: { businessId: req.businessId }, include: { transactions: { select: { direction: true, amount: true } } }, orderBy: { name: "asc" } });
  const result = accounts.map((a) => ({ ...a, transactions: undefined, balance: a.openingBalance + a.transactions.reduce((x, t) => x + (t.direction === "credit" ? t.amount : -t.amount), 0) }));
  res.json({ accounts: result, totalAvailable: result.reduce((x, a) => x + a.balance, 0) });
}
async function createAccount(req, res) {
  const name = String(req.body.name || "").trim(); const type = String(req.body.type || "cash"); const openingBalance = n(req.body.openingBalance || 0);
  if (name.length < 2 || !Number.isFinite(openingBalance) || openingBalance < 0) return res.status(400).json({ message: "Enter a valid account name and opening balance." });
  try { const account = await prisma.account.create({ data: { businessId: req.businessId, name, type, openingBalance } }); res.status(201).json({ account }); }
  catch (e) { res.status(400).json({ message: e.code === "P2002" ? "An account with this name already exists." : "Could not create account." }); }
}
async function updateAccount(req, res) {
  const id = n(req.params.id); const data = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim();
  if (req.body.type !== undefined) data.type = String(req.body.type);
  if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
  try { const existing = await prisma.account.findFirst({ where: { id, businessId: req.businessId } }); if (!existing) return res.status(404).json({ message: "Account not found." }); const account = await prisma.account.update({ where: { id }, data }); res.json({ account }); }
  catch (e) { res.status(400).json({ message: e.code === "P2002" ? "An account with this name already exists." : "Could not update account." }); }
}
async function deleteAccount(req, res) {
  const id = n(req.params.id);
  try {
    const existing = await prisma.account.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) return res.status(404).json({ message: "Account not found." });
    const [transactions, payments, expenses] = await Promise.all([
      prisma.ledgerTransaction.count({ where: { accountId: id, businessId: req.businessId } }),
      prisma.payment.count({ where: { accountId: id, businessId: req.businessId } }),
      prisma.expense.count({ where: { accountId: id, businessId: req.businessId } }),
    ]);
    if (transactions || payments || expenses) return res.status(409).json({ message: "This account has financial history and cannot be deleted. You can deactivate it instead." });
    await prisma.account.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (e) {
    res.status(400).json({ message: e.message || "Could not delete account." });
  }
}
async function listTransactions(req, res) {
  const occurredAt = requireFinanceDateRange(req, res);
  if (!occurredAt) return;
  const page = Math.max(1, n(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, n(req.query.limit) || 25));
  const where = { businessId: req.businessId, occurredAt };
  const [transactions, total] = await Promise.all([
    prisma.ledgerTransaction.findMany({
      where,
      include: { account: { select: { name: true } }, createdBy: { select: { fullName: true, email: true } } },
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ledgerTransaction.count({ where }),
  ]);
  res.json({ transactions, total, page, limit });
}
async function createTransaction(req, res) {
  const amount = n(req.body.amount); if (!validAmount(amount)) return res.status(400).json({ message: "Amount must be greater than zero." });
  try { await accountFor(prisma, req.businessId, req.body.accountId); const t = await addLedger(prisma, { businessId: req.businessId, accountId: n(req.body.accountId), type: String(req.body.type || "other"), direction: req.body.direction === "debit" ? "debit" : "credit", amount, reference: req.body.reference ? String(req.body.reference) : null, note: req.body.note ? String(req.body.note) : null, createdById: n(req.user.id) }); res.status(201).json({ transaction: t }); }
  catch (e) { res.status(400).json({ message: e.message }); }
}
async function listExpenses(req, res) {
  const occurredAt = requireFinanceDateRange(req, res);
  if (!occurredAt) return;
  const page = Math.max(1, n(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, n(req.query.limit) || 25));
  const where = { businessId: req.businessId, occurredAt };
  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: { account: { select: { name: true } }, createdBy: { select: { fullName: true, email: true } } },
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.expense.count({ where }),
  ]);
  res.json({ expenses, total, page, limit });
}
async function createExpense(req, res) {
  const amount = n(req.body.amount);
  const category = String(req.body.category || "").trim();
  if (!validAmount(amount) || !category) {
    return res.status(400).json({ message: "Category and a valid amount are required." });
  }

  try {
    const expense = await prisma.$transaction(async (tx) => {
      await accountFor(tx, req.businessId, req.body.accountId);
      const occurredAt = req.body.occurredAt ? new Date(req.body.occurredAt) : undefined;
      const e = await tx.expense.create({
        data: {
          businessId: req.businessId,
          accountId: n(req.body.accountId),
          amount,
          category,
          description: req.body.description ? String(req.body.description) : null,
          occurredAt,
          createdById: n(req.user.id),
        },
      });

      await addLedger(tx, {
        businessId: req.businessId,
        accountId: n(req.body.accountId),
        expenseId: e.id,
        type: "expense",
        direction: "debit",
        amount,
        note: category,
        occurredAt: e.occurredAt,
        createdById: n(req.user.id),
      });

      return e;
    });

    res.status(201).json({ expense });
  } catch (e) {
    res.status(400).json({ message: e.message || "Could not create expense." });
  }
}

async function updateExpense(req, res) {
  const id = n(req.params.id);
  const existing = await prisma.expense.findFirst({ where: { id, businessId: req.businessId } });
  if (!existing) return res.status(404).json({ message: "Expense not found." });
  const data = {};
  if (req.body.category !== undefined) data.category = String(req.body.category).trim();
  if (req.body.description !== undefined) data.description = String(req.body.description);
  try {
    const expense = await prisma.expense.update({ where: { id }, data });
    res.json({ expense });
  } catch {
    res.status(400).json({ message: "Could not update expense." });
  }
}

async function deleteLegacyExpenseLedger(tx, businessId, expense) {
  const orphan = await tx.ledgerTransaction.findFirst({
    where: {
      businessId,
      expenseId: null,
      type: "expense",
      direction: "debit",
      accountId: expense.accountId,
      amount: expense.amount,
      note: expense.category,
    },
    orderBy: { createdAt: "desc" },
  });

  if (orphan) {
    await tx.ledgerTransaction.delete({ where: { id: orphan.id } });
  }
}

async function deleteExpense(req, res) {
  const id = n(req.params.id);
  const existing = await prisma.expense.findFirst({ where: { id, businessId: req.businessId } });
  if (!existing) return res.status(404).json({ message: "Expense not found." });

  try {
    await prisma.$transaction(async (tx) => {
      const removed = await tx.ledgerTransaction.deleteMany({
        where: { businessId: req.businessId, expenseId: id },
      });

      if (removed.count === 0) {
        await deleteLegacyExpenseLedger(tx, req.businessId, existing);
      }

      await tx.expense.delete({ where: { id } });
    });

    res.json({ deleted: true });
  } catch {
    res.status(400).json({ message: "Could not delete expense." });
  }
}
async function listPayments(req, res) {
  const occurredAt = requireFinanceDateRange(req, res);
  if (!occurredAt) return;
  const page = Math.max(1, n(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, n(req.query.limit) || 25));
  const where = { businessId: req.businessId, occurredAt };
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        account: { select: { name: true } },
        customer: { select: { name: true, mobile: true } },
        supplier: { select: { name: true, mobile: true } },
        createdBy: { select: { fullName: true, email: true } },
      },
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);
  res.json({ payments, total, page, limit });
}
async function createPayment(req, res) { const amount = n(req.body.amount); const type = req.body.type === "supplier" ? "supplier" : "customer"; if (!validAmount(amount)) return res.status(400).json({ message: "Amount must be greater than zero." }); try { const payment = await prisma.$transaction(async (tx) => { await accountFor(tx, req.businessId, req.body.accountId); const relation = type === "customer" ? { customerId: n(req.body.partyId) } : { supplierId: n(req.body.partyId) }; const party = type === "customer" ? await tx.customer.findFirst({ where: { id: relation.customerId, businessId: req.businessId } }) : await tx.supplier.findFirst({ where: { id: relation.supplierId, businessId: req.businessId } }); if (!party) throw new Error("Party not found for this business."); const p = await tx.payment.create({ data: { businessId: req.businessId, accountId: n(req.body.accountId), ...relation, amount, type, method: String(req.body.method || "cash"), reference: req.body.reference ? String(req.body.reference) : null, createdById: n(req.user.id) } }); await addLedger(tx, { businessId: req.businessId, accountId: n(req.body.accountId), paymentId: p.id, type: `${type}_payment`, direction: type === "customer" ? "credit" : "debit", amount, reference: p.reference, createdById: n(req.user.id) }); if (type === "customer") await tx.customer.update({ where: { id: party.id }, data: { currentBalance: { decrement: amount } } }); else await tx.supplier.update({ where: { id: party.id }, data: { currentBalance: { decrement: amount } } }); return p; }); res.status(201).json({ payment }); } catch (e) { res.status(400).json({ message: e.message || "Could not record payment." }); } }
async function getDailyClosing(req, res) {
  const dateParam = req.query.date;
  const date =
    dateParam != null && String(dateParam).trim() !== ""
      ? String(dateParam).trim()
      : new Date().toISOString().slice(0, 10);

  if (dateParam != null && String(dateParam).trim() !== "") {
    const parsed = parseQueryDate(dateParam, "date");
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message, field: parsed.field });
    }
  }

  const day = new Date(`${date}T00:00:00.000`);
  const end = new Date(`${date}T23:59:59.999`);

  const [closing, sales, business, movements] = await Promise.all([
    prisma.dailyClosing.findUnique({
      where: { businessId_businessDate: { businessId: req.businessId, businessDate: day } },
      include: { closedBy: { select: { fullName: true, email: true } } },
    }),
    prisma.sale.aggregate({
      where: { businessId: req.businessId, createdAt: { gte: day, lte: end } },
      _count: { id: true },
      _sum: { subtotal: true, discountAmount: true, totalAmount: true },
    }),
    prisma.business.findUnique({
      where: { id: req.businessId },
      select: { openingCashBalance: true },
    }),
    cashAndNonCashMovementForDay(prisma, req.businessId, day, end),
  ]);

  const openingCash = closing?.openingCash ?? business?.openingCashBalance ?? 0;
  const cashMovement = movements.cashMovement.net;
  const expectedCash = openingCash + cashMovement;

  res.json({
    date,
    closing,
    summary: {
      bills: sales._count.id,
      grossSales: sales._sum.subtotal || 0,
      discounts: sales._sum.discountAmount || 0,
      netSales: sales._sum.totalAmount || 0,
      openingCash,
      movement: cashMovement,
      cashMovement,
      nonCashMovement: movements.nonCashMovement.net,
      cashAccountIds: movements.cashAccountIds,
      expectedCash,
      difference: closing?.countedCash == null ? null : closing.countedCash - expectedCash,
    },
  });
}

async function closeDaily(req, res) {
  const date = String(req.body.date || new Date().toISOString().slice(0, 10));
  const countedCash = n(req.body.countedCash);
  if (!Number.isFinite(countedCash) || countedCash < 0) {
    return res.status(400).json({ message: "Counted cash must be a valid non-negative amount." });
  }

  const day = new Date(`${date}T00:00:00.000`);
  const end = new Date(`${date}T23:59:59.999`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.dailyClosing.findUnique({
        where: { businessId_businessDate: { businessId: req.businessId, businessDate: day } },
      });
      if (existing?.status === "closed") {
        throw new Error("This day is already closed.");
      }

      const business = await tx.business.findUnique({
        where: { id: req.businessId },
        select: { openingCashBalance: true },
      });

      const { cashMovement } = await cashAndNonCashMovementForDay(tx, req.businessId, day, end);
      const openingCash = existing?.openingCash ?? business?.openingCashBalance ?? 0;
      const expectedCash = openingCash + cashMovement.net;

      return tx.dailyClosing.upsert({
        where: { businessId_businessDate: { businessId: req.businessId, businessDate: day } },
        update: {
          status: "closed",
          expectedCash,
          countedCash,
          difference: countedCash - expectedCash,
          note: req.body.note ? String(req.body.note) : null,
          closedById: n(req.user.id),
          closedAt: new Date(),
        },
        create: {
          businessId: req.businessId,
          businessDate: day,
          openingCash,
          expectedCash,
          countedCash,
          difference: countedCash - expectedCash,
          note: req.body.note ? String(req.body.note) : null,
          closedById: n(req.user.id),
          closedAt: new Date(),
          status: "closed",
        },
      });
    });

    res.json({ closing: result });
  } catch (e) {
    res.status(400).json({ message: e.message || "Could not close day." });
  }
}
async function reopenDaily(req, res) { const date = String(req.body.date || ""); const day = new Date(`${date}T00:00:00.000`); if (!date || Number.isNaN(day.getTime())) return res.status(400).json({ message: "A valid business date is required." }); try { const closing = await prisma.dailyClosing.update({ where: { businessId_businessDate: { businessId: req.businessId, businessDate: day } }, data: { status: "reopened", reopenedAt: new Date() } }); res.json({ closing }); } catch { res.status(404).json({ message: "Daily closing not found." }); } }
async function reportSummary(req, res) {
  const range = requireFinanceDateRange(req, res);
  if (!range) return;
  const businessId = req.businessId;
  const [sales, expenses, customer, supplier] = await Promise.all([
    prisma.sale.aggregate({
      where: { businessId, createdAt: range },
      _count: { id: true },
      _sum: { totalAmount: true, discountAmount: true },
    }),
    prisma.expense.aggregate({ where: { businessId, occurredAt: range }, _sum: { amount: true } }),
    prisma.customer.aggregate({
      where: { businessId },
      _count: { id: true },
      _sum: { currentBalance: true },
    }),
    prisma.supplier.aggregate({
      where: { businessId },
      _count: { id: true },
      _sum: { currentBalance: true },
    }),
  ]);
  res.json({
    sales: {
      count: sales._count.id,
      total: sales._sum.totalAmount || 0,
      discounts: sales._sum.discountAmount || 0,
    },
    expenses: expenses._sum.amount || 0,
    customers: { count: customer._count.id, receivable: customer._sum.currentBalance || 0 },
    suppliers: { count: supplier._count.id, payable: supplier._sum.currentBalance || 0 },
  });
}
module.exports = { listAccounts, createAccount, updateAccount, deleteAccount, listTransactions, createTransaction, listExpenses, createExpense, updateExpense, deleteExpense, listPayments, createPayment, getDailyClosing, closeDaily, reopenDaily, reportSummary };
