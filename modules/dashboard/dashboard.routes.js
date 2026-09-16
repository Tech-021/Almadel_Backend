const express = require("express");

const { requireAdmin, requireAuth } = require("../../middleware/auth");
const {
  getAdminDashboard,
  getMyDashboard,
} = require("./dashboard.controller");

const dashboardRouter = express.Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get("/", requireAdmin, getAdminDashboard);
dashboardRouter.get("/me", getMyDashboard);

module.exports = { dashboardRouter };
