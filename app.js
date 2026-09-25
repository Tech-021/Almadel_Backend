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
const { financeRouter } = require("./modules/finance/finance.routes");
const { suppliersRouter } = require("./modules/suppliers/suppliers.routes");
const { reportsRouter } = require("./modules/reports/reports.routes");

const { billingRouter } = require("./modules/billing/billing.routes");
const { categoriesRouter } = require("./modules/categories/categories.routes");

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const defaultAllowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "https://web-app-allmadal.vercel.app",
  ];
  const customOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...customOrigins])];

  app.use(
    cors({
      origin(origin, callback) {
        if (
          !origin ||
          allowedOrigins.includes(origin) ||
          origin.endsWith(".vercel.app") ||
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:")
        ) {
          callback(null, true);
        } else {
          callback(new Error(`CORS blocked for origin: ${origin}`));
        }
      },
      credentials: true,
    }),
  );
  app.use(
    express.json({
      limit: "5mb",
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
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
  app.use("/billing", billingRouter);
  // Connect it with /admin/logs prefix:
  app.use("/logs", logsRoutes);
  app.use("/finance", financeRouter);
  app.use("/suppliers", suppliersRouter);
  app.use("/reports", reportsRouter);
  app.use("/categories", categoriesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
