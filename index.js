require("dotenv").config();

const bcrypt = require("bcryptjs");

const { createApp } = require("./app");
const { prisma } = require("./db");

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";
const app = createApp();
const BCRYPT_WARMUP_HASH =
  "$2b$10$dd8VjgLGcM5PyVsow0oVkejuRB/FdT80KQV7t240GJDqW1FEsc/Bu";

async function startServer() {
  await prisma.$queryRaw`SELECT 1`;
  await bcrypt.compare("warmup", BCRYPT_WARMUP_HASH);

  app.listen(port, host, () => {
    console.log(`API server running on http://localhost:${port}`);
    console.log(`API server listening for LAN/device requests on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("Could not start API server:", error);
  process.exit(1);
});