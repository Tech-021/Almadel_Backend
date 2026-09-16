const { prisma } = require("../../db");
const { customerResponse } = require("../../utils/serializers");
const { randomBytes, createHash } = require("node:crypto");

function hashPassword(password) {
  return createHash("sha256").update(password).digest("hex");
}

async function getCustomers(req, res) {
  const customers = await prisma.customer.findMany({
    where: { businessId: req.businessId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ customers: customers.map(customerResponse) });
}

async function createCustomer(req, res) {
  const { name, mobile, email, password } = req.body;

  if (!name || !mobile) {
    return res.status(400).json({ message: "Name and mobile are required." });
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        businessId: req.businessId,
        name,
        mobile,
        email: email || null,
        passwordHash: password ? hashPassword(password) : null,
      },
    });
    res.status(201).json(customerResponse(customer));
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(400).json({ message: "Customer with this mobile already exists in this business." });
    }
    return res.status(400).json({ message: error.message ?? "Could not create customer." });
  }
}

async function updateCustomer(req, res) {
  const customerId = Number(req.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: "Invalid customer ID." });
  }

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, businessId: req.businessId },
  });
  if (!existing) {
    return res.status(404).json({ message: "Customer not found." });
  }

  const { name, mobile, email, password } = req.body;

  try {
    const data = {};
    if (name) data.name = name;
    if (mobile) data.mobile = mobile;
    if (email !== undefined) data.email = email || null;
    if (password) data.passwordHash = hashPassword(password);

    const customer = await prisma.customer.update({
      where: { id: customerId },
      data,
    });
    res.json(customerResponse(customer));
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(400).json({ message: "Customer with this mobile already exists in this business." });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Customer not found." });
    }
    return res.status(400).json({ message: error.message ?? "Could not update customer." });
  }
}

async function deleteCustomer(req, res) {
  const customerId = Number(req.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: "Invalid customer ID." });
  }

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, businessId: req.businessId },
  });
  if (!existing) {
    return res.status(404).json({ message: "Customer not found." });
  }

  try {
    await prisma.customer.delete({
      where: { id: customerId },
    });
    res.json({ deleted: true });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Customer not found." });
    }
    return res.status(400).json({ message: error.message ?? "Could not delete customer." });
  }
}

module.exports = { getCustomers, createCustomer, updateCustomer, deleteCustomer };