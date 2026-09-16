const cors = require("cors");
const express = require("express");
const path = require("path");

const { errorHandler, notFoundHandler } = require("./middleware/error-handler");
const { adminRouter } = require("./modules/admin/admin.routes");
const { authRouter } = require("./modules/auth/auth.routes");
const { customersRouter } = require("./modules/customers/customers.routes");
const { dashboardRouter } = require("./modules/dashboard/dashboard.routes");
const { healthRouter } = require("./modules/health/health.routes");
const { productsRouter } = require("./modules/products/products.routes");
const { salesRouter } = require("./modules/sales/sales.routes");
const { stockRouter } = require("./modules/stock/stock.routes");
const logsRoutes = require("./modules/logs/logs.routes");



function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/uploads",
    express.static(path.join(__dirname, "uploads"), {
      fallthrough: true,
      maxAge: "30d",
    }),
  );

  app.use(healthRouter);
  app.use("/auth", authRouter);
  app.use("/products", productsRouter);
  app.use("/stock", stockRouter);
  app.use("/sales", salesRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/customers", customersRouter);
  app.use("/admin", adminRouter);
  // Connect it with /admin/logs prefix:
  app.use("/logs", logsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };