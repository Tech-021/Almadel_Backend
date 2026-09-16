const logsRoutes = require("../logs/logs.routes");
const express = require("express");

const { requireAdmin, requireAuth } = require("../../middleware/auth");
const {
  createStaff,
  deleteStaff,
  listStaff,
  updateStaff,
} = require("./admin.controller");

const adminRouter = express.Router();

adminRouter.get("/staff", requireAuth, requireAdmin, listStaff);
adminRouter.post("/staff", requireAuth, requireAdmin, createStaff);
adminRouter.patch("/staff/:id", requireAuth, requireAdmin, updateStaff);
adminRouter.delete("/staff/:id", requireAuth, requireAdmin, deleteStaff);

adminRouter.use("/logs", requireAuth, requireAdmin, logsRoutes);

module.exports = { adminRouter };