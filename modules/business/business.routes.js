const express = require("express");
const { requireAuth } = require("../../middleware/auth");
const {
  setupBusiness,
  getMyBusinesses,
  getBusinessDetails,
  updateBusiness,
} = require("./business.controller");

const businessRouter = express.Router();

businessRouter.post("/setup", requireAuth, setupBusiness);
businessRouter.get("/my-businesses", requireAuth, getMyBusinesses);
businessRouter.get("/:id", requireAuth, getBusinessDetails);
businessRouter.patch("/:id", requireAuth, updateBusiness);

module.exports = { businessRouter };
