const { prisma } = require("../../db");
const { validatePhone, validateEmail, validateText, validateNumber } = require("../../utils/validators");

const idOf = (v) => Number(v);
function where(req, id) {
  return { id: idOf(id), businessId: req.businessId };
}

async function list(req, res) {
  const page = Math.max(1, idOf(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, idOf(req.query.limit) || 25));
  const q = String(req.query.search || "").trim();
  const filter = {
    businessId: req.businessId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { mobile: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.supplier.count({ where: filter }),
  ]);
  res.json({ suppliers, total, page, limit });
}

async function create(req, res) {
  const name = String(req.body.name || "").trim();
  const nameVal = validateText(name, { minLength: 2, maxLength: 60, fieldName: "Supplier name" });
  if (!nameVal.valid) {
    return res.status(400).json({ message: nameVal.error });
  }

  if (req.body.mobile) {
    const phoneVal = validatePhone(req.body.mobile, { required: false, fieldName: "Supplier mobile" });
    if (!phoneVal.valid) return res.status(400).json({ message: phoneVal.error });
  }

  if (req.body.email) {
    const emailVal = validateEmail(req.body.email, { required: false });
    if (!emailVal.valid) return res.status(400).json({ message: emailVal.error });
  }

  const openingBalance = Number(req.body.openingBalance || 0);
  if (isNaN(openingBalance) || openingBalance < 0) {
    return res.status(400).json({ message: "Opening balance must be 0 or greater." });
  }

  try {
    const supplier = await prisma.supplier.create({
      data: {
        businessId: req.businessId,
        name,
        mobile: req.body.mobile ? String(req.body.mobile).trim() : null,
        email: req.body.email ? String(req.body.email).trim().toLowerCase() : null,
        openingBalance,
        currentBalance: openingBalance,
      },
    });
    res.status(201).json({ supplier });
  } catch (error) {
    res.status(400).json({ message: error.message || "Could not create supplier." });
  }
}

async function update(req, res) {
  const existing = await prisma.supplier.findFirst({ where: where(req, req.params.id) });
  if (!existing) return res.status(404).json({ message: "Supplier not found." });

  if (req.body.name !== undefined) {
    const nameVal = validateText(req.body.name, { minLength: 2, maxLength: 60, fieldName: "Supplier name" });
    if (!nameVal.valid) return res.status(400).json({ message: nameVal.error });
  }

  if (req.body.mobile) {
    const phoneVal = validatePhone(req.body.mobile, { required: false, fieldName: "Supplier mobile" });
    if (!phoneVal.valid) return res.status(400).json({ message: phoneVal.error });
  }

  if (req.body.email) {
    const emailVal = validateEmail(req.body.email, { required: false });
    if (!emailVal.valid) return res.status(400).json({ message: emailVal.error });
  }

  const data = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim();
  if (req.body.mobile !== undefined) data.mobile = req.body.mobile ? String(req.body.mobile).trim() : null;
  if (req.body.email !== undefined) data.email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;

  try {
    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data });
    res.json({ supplier });
  } catch (error) {
    res.status(400).json({ message: error.message || "Could not update supplier." });
  }
}

async function remove(req, res) {
  const existing = await prisma.supplier.findFirst({ where: where(req, req.params.id) });
  if (!existing) return res.status(404).json({ message: "Supplier not found." });
  try {
    const payments = await prisma.payment.count({
      where: { supplierId: existing.id, businessId: req.businessId },
    });
    if (payments) return res.status(409).json({ message: "This supplier has payment history and cannot be deleted." });
    await prisma.supplier.delete({ where: { id: existing.id } });
    res.json({ deleted: true });
  } catch {
    res.status(400).json({ message: "Could not delete supplier." });
  }
}

module.exports = { list, create, update, remove };
