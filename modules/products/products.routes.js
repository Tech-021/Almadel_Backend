const express = require("express");

const { requireAdmin, requireAuth, requireBusiness } = require("../../middleware/auth");
const {
  createProduct,
  deleteProduct,
  exportProductsCsv,
  findProductByBarcode,
  importProducts,
  listProducts,
  searchProducts,
  updateProduct,
} = require("./products.controller");
const {
  upload,
  uploadProductImage,
} = require("./product-image-upload");

const productsRouter = express.Router();

productsRouter.use(requireAuth, requireBusiness);
productsRouter.get("/", listProducts);
productsRouter.get("/export", exportProductsCsv);
productsRouter.get("/search", searchProducts);
productsRouter.get("/barcode/:barcode", findProductByBarcode);
productsRouter.post("/", requireAdmin, createProduct);
productsRouter.post("/images", requireAdmin, upload.single("image"), uploadProductImage);
productsRouter.post("/import", requireAdmin, importProducts);
productsRouter.patch("/:id", requireAdmin, updateProduct);
productsRouter.delete("/:id", requireAdmin, deleteProduct);

module.exports = { productsRouter };