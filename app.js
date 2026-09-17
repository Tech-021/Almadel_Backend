const { businessRouter } = require("./modules/business/business.routes");
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

  if (process.env.API_REQUEST_LOGS === "true") {
    app.use((req, res, next) => {
      const startedAt = process.hrtime.bigint();

      res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(
          `[HTTP] ${req.method} ${req.path} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
        );
      });

      next();
    });
  }

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
  app.use("/business", businessRouter);
  // Connect it with /admin/logs prefix:
  app.use("/logs", logsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
