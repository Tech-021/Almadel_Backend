const { prisma } = require("../../db");
const { validateText } = require("../../utils/validators");

// GET /categories
async function listCategories(req, res) {
  try {
    const businessId = req.businessId;

    const [categories, products] = await Promise.all([
      prisma.category.findMany({
        where: { businessId },
        orderBy: { name: "asc" },
      }),
      prisma.product.findMany({
        where: { businessId },
        select: { category: true, stock: true, price: true, sellingPrice: true },
      }),
    ]);

    // Build stats map per category
    const statsMap = new Map();
    for (const p of products) {
      if (!p.category || !p.category.trim()) continue;
      const key = p.category.trim().toLowerCase();
      const current = statsMap.get(key) || { count: 0, stock: 0, value: 0 };
      const stock = Number(p.stock || 0);
      const price = Number(p.sellingPrice || p.price || 0);
      current.count += 1;
      current.stock += stock;
      current.value += stock * price;
      statsMap.set(key, current);
    }

    const result = categories.map((c) => {
      const stats = statsMap.get(c.name.trim().toLowerCase()) || { count: 0, stock: 0, value: 0 };
      return {
        id: c.id,
        name: c.name,
        description: c.description || "",
        productCount: stats.count,
        totalStock: stats.stock,
        totalValue: stats.value,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("List categories error:", error);
    return res.status(500).json({ message: "Could not load categories." });
  }
}

// POST /categories
async function createCategory(req, res) {
  try {
    const businessId = req.businessId;
    const { name, description } = req.body;

    const nameVal = validateText(name, { minLength: 1, maxLength: 80, fieldName: "Category name" });
    if (!nameVal.valid) {
      return res.status(400).json({ message: nameVal.error });
    }

    const cleanName = String(name).trim();

    const existing = await prisma.category.findFirst({
      where: {
        businessId,
        name: { equals: cleanName, mode: "insensitive" },
      },
    });

    if (existing) {
      return res.status(409).json({ message: `Category '${cleanName}' already exists.` });
    }

    const category = await prisma.category.create({
      data: {
        businessId,
        name: cleanName,
        description: description ? String(description).trim() : null,
      },
    });

    return res.status(201).json({
      ...category,
      productCount: 0,
      totalStock: 0,
      totalValue: 0,
    });
  } catch (error) {
    console.error("Create category error:", error);
    return res.status(400).json({ message: error.message || "Could not create category." });
  }
}

// PATCH /categories/:id
async function updateCategory(req, res) {
  try {
    const businessId = req.businessId;
    const categoryId = Number(req.params.id);
    const { name, description } = req.body;

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({ message: "Invalid category ID." });
    }

    const existing = await prisma.category.findFirst({
      where: { id: categoryId, businessId },
    });

    if (!existing) {
      return res.status(404).json({ message: "Category not found." });
    }

    const data = {};
    if (description !== undefined) {
      data.description = description ? String(description).trim() : null;
    }

    let cleanName = existing.name;
    if (name !== undefined) {
      const nameVal = validateText(name, { minLength: 1, maxLength: 80, fieldName: "Category name" });
      if (!nameVal.valid) {
        return res.status(400).json({ message: nameVal.error });
      }
      cleanName = String(name).trim();
      data.name = cleanName;
    }

    // If name changed, update all products with this category
    if (cleanName !== existing.name) {
      await prisma.product.updateMany({
        where: { businessId, category: existing.name },
        data: { category: cleanName },
      });
    }

    const updated = await prisma.category.update({
      where: { id: categoryId },
      data,
    });

    return res.json(updated);
  } catch (error) {
    console.error("Update category error:", error);
    return res.status(400).json({ message: error.message || "Could not update category." });
  }
}

// DELETE /categories/:id
async function deleteCategory(req, res) {
  try {
    const businessId = req.businessId;
    const categoryId = Number(req.params.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({ message: "Invalid category ID." });
    }

    const existing = await prisma.category.findFirst({
      where: { id: categoryId, businessId },
    });

    if (!existing) {
      return res.status(404).json({ message: "Category not found." });
    }

    // Unassign category from all products in this business
    await prisma.product.updateMany({
      where: { businessId, category: existing.name },
      data: { category: null },
    });

    // Delete category record
    await prisma.category.delete({
      where: { id: categoryId },
    });

    return res.json({ deleted: true, name: existing.name });
  } catch (error) {
    console.error("Delete category error:", error);
    return res.status(400).json({ message: error.message || "Could not delete category." });
  }
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
