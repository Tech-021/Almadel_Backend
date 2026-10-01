require("dotenv").config();

const bcrypt = require("bcryptjs");
const http = require("http");

const { installFileLogging, logger } = require("./utils/logger");
installFileLogging();

const { createApp } = require("./app");
const { prisma } = require("./db");
const { assertJwtSecretConfigured } = require("./modules/auth/token.service");
const { registerSocketHandlers } = require("./modules/realtime/socket");

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";
const app = createApp();
const httpServer = http.createServer(app);
const BCRYPT_WARMUP_HASH =
  "$2b$10$dd8VjgLGcM5PyVsow0oVkejuRB/FdT80KQV7t240GJDqW1FEsc/Bu";

async function startServer() {
  assertJwtSecretConfigured();

  await prisma.$queryRaw`SELECT 1`;
  await bcrypt.compare("warmup", BCRYPT_WARMUP_HASH);
  await registerSocketHandlers(httpServer);

  httpServer.listen(port, host, () => {
    logger.info(`API server running on http://localhost:${port}`);
    logger.info(`API server listening for LAN/device requests on port ${port}`);
  });
}

startServer().catch((error) => {
  logger.error("Could not start API server:", error);
  process.exit(1);
});

