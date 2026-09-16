const logsRoutes = require("../logs/logs.routes");
const express = require("express");

const { requireAdmin, requireAuth, requireBusiness } = require("../../middleware/auth");
const {
  createStaff,
  deleteStaff,
  listStaff,
  updateStaff,
} = require("./admin.controller");

const adminRouter = express.Router();

adminRouter.use(requireAuth, requireBusiness, requireAdmin);
adminRouter.get("/staff", listStaff);
adminRouter.post("/staff", createStaff);
adminRouter.patch("/staff/:id", updateStaff);
adminRouter.delete("/staff/:id", deleteStaff);

adminRouter.use("/logs", logsRoutes);

module.exports = { adminRouter };