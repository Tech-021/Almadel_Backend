const express = require("express");

const { requireAuth, requireBusiness } = require("../../middleware/auth");
const { checkout, getInvoice } = require("./sales.controller");

const salesRouter = express.Router();

salesRouter.use(requireAuth, requireBusiness);
salesRouter.post("/checkout", checkout);
salesRouter.get("/:saleId", getInvoice);

module.exports = { salesRouter };