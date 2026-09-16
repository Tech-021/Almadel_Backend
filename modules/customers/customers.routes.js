const express = require("express");

const { requireAdmin, requireAuth, requireBusiness } = require("../../middleware/auth");
const {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("./customers.controller");

const customersRouter = express.Router();

customersRouter.use(requireAuth, requireBusiness);
customersRouter.get("/", requireAdmin, getCustomers);
customersRouter.post("/", requireAdmin, createCustomer);
customersRouter.patch("/:customerId", requireAdmin, updateCustomer);
customersRouter.delete("/:customerId", requireAdmin, deleteCustomer);

module.exports = { customersRouter };