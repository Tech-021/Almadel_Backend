const express = require("express");

const { requireFinanceAccess, requireAuth, requireBusiness } = require("../../middleware/auth");
const {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("./customers.controller");

const customersRouter = express.Router();

customersRouter.use(requireAuth, requireBusiness);
customersRouter.get("/", requireFinanceAccess, getCustomers);
customersRouter.post("/", requireFinanceAccess, createCustomer);
customersRouter.patch("/:customerId", requireFinanceAccess, updateCustomer);
customersRouter.delete("/:customerId", requireFinanceAccess, deleteCustomer);

module.exports = { customersRouter };