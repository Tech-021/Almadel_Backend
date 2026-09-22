const express = require("express");
const { requireAuth, requireBusiness, requireFinanceAccess } = require("../../middleware/auth");
const c = require("./finance.controller");
const router = express.Router();

router.use(requireAuth, requireBusiness);

router.get("/accounts", requireFinanceAccess, c.listAccounts);
router.post("/accounts", requireFinanceAccess, c.createAccount);
router.patch("/accounts/:id", requireFinanceAccess, c.updateAccount);
router.delete("/accounts/:id", requireFinanceAccess, c.deleteAccount);

router.get("/transactions", requireFinanceAccess, c.listTransactions);
router.post("/transactions", requireFinanceAccess, c.createTransaction);

router.get("/expenses", requireFinanceAccess, c.listExpenses);
router.post("/expenses", requireFinanceAccess, c.createExpense);
router.patch("/expenses/:id", requireFinanceAccess, c.updateExpense);
router.delete("/expenses/:id", requireFinanceAccess, c.deleteExpense);

router.get("/payments", requireFinanceAccess, c.listPayments);
router.post("/payments", requireFinanceAccess, c.createPayment);

router.get("/daily-closings", requireFinanceAccess, c.getDailyClosing);
router.post("/daily-closings/close", requireFinanceAccess, c.closeDaily);
router.post("/daily-closings/reopen", requireFinanceAccess, c.reopenDaily);

router.get("/reports/summary", requireFinanceAccess, c.reportSummary);

module.exports = { financeRouter: router };
