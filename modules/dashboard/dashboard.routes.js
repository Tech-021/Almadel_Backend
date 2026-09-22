const express = require("express");

const { requireFinanceAccess, requireAuth, requireBusiness } = require("../../middleware/auth");
const {
  getAdminDashboard,
  getMyDashboard,
} = require("./dashboard.controller");

const dashboardRouter = express.Router();

dashboardRouter.use(requireAuth, requireBusiness);
dashboardRouter.get("/", requireFinanceAccess, getAdminDashboard);
dashboardRouter.get("/me", getMyDashboard);

module.exports = { dashboardRouter };