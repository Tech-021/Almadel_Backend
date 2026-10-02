const express = require("express");

const { requireAuth, requireBusiness } = require("../../middleware/auth");
const { postRefund, listRefunds, getRefund } = require("./refund.controller");

const refundsRouter = express.Router();

refundsRouter.use(requireAuth, requireBusiness);
refundsRouter.post("/", postRefund);
refundsRouter.get("/", listRefunds);
refundsRouter.get("/:refundId", getRefund);

module.exports = { refundsRouter };
