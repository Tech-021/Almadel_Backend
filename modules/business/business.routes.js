const express = require("express");
const { requireAuth } = require("../../middleware/auth");
const {
  setupBusiness,
  completeFinancialSetup,
  getMyBusinesses,
  getBusinessDetails,
  updateBusiness,
} = require("./business.controller");

const businessRouter = express.Router();

businessRouter.post("/setup", requireAuth, setupBusiness);
businessRouter.post("/:id/financial-setup", requireAuth, completeFinancialSetup);
businessRouter.put("/:id/financial-setup", requireAuth, completeFinancialSetup);
businessRouter.get("/my-businesses", requireAuth, getMyBusinesses);
businessRouter.get("/:id", requireAuth, getBusinessDetails);
businessRouter.patch("/:id", requireAuth, updateBusiness);

module.exports = { businessRouter };
