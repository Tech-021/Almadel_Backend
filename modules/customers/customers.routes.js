const express = require("express");

const { requireFinanceAccess, requireAuth, requireBusiness } = require("../../middleware/auth");
const {
  getCustomers,
  getCustomerHistory,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("./customers.controller");

const customersRouter = express.Router();

customersRouter.use(requireAuth, requireBusiness);
customersRouter.get("/", getCustomers);
customersRouter.get("/:customerId/history", getCustomerHistory);
customersRouter.post("/", createCustomer);
customersRouter.patch("/:customerId", updateCustomer);
customersRouter.delete("/:customerId", requireFinanceAccess, deleteCustomer);

module.exports = { customersRouter };