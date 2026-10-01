module.exports = {
  apps: [
    {
      name: "almadel-backend",
      script: "index.js",
      cwd: __dirname,
      exec_mode: "cluster",
      instances: Number(process.env.PM2_INSTANCES || 2),
      max_memory_restart: process.env.PM2_MAX_MEMORY || "750M",
      env: {
        NODE_ENV: "production",
      },
      listen_timeout: 10_000,
      kill_timeout: 8_000,
    },
  ],
};
