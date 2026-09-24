const express = require("express");
const { requireAuth, requireBusiness } = require("../../middleware/auth");
const {
  getSalesReport,
  getProductReport,
  getStockReport,
} = require("./reports.controller");

const router = express.Router();

router.use(requireAuth, requireBusiness);

router.get("/sales", getSalesReport);
router.get("/products", getProductReport);
router.get("/stock", getStockReport);

module.exports = { reportsRouter: router };
