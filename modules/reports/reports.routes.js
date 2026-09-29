const express = require("express");
const { requireAuth, requireBusiness, requireFinanceAccess } = require("../../middleware/auth");
const {
  getSalesReport,
  getProductReport,
  getStockReport,
} = require("./reports.controller");

const router = express.Router();

router.use(requireAuth, requireBusiness, requireFinanceAccess);

router.get("/sales", getSalesReport);
router.get("/products", getProductReport);
router.get("/stock", getStockReport);

module.exports = { reportsRouter: router };
