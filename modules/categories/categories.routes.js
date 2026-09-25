const express = require("express");
const { requireAuth, requireBusiness } = require("../../middleware/auth");
const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("./categories.controller");

const categoriesRouter = express.Router();

categoriesRouter.get("/", requireAuth, requireBusiness, listCategories);
categoriesRouter.post("/", requireAuth, requireBusiness, createCategory);
categoriesRouter.patch("/:id", requireAuth, requireBusiness, updateCategory);
categoriesRouter.delete("/:id", requireAuth, requireBusiness, deleteCategory);

module.exports = { categoriesRouter };
