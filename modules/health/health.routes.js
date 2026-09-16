const express = require("express");

const healthRouter = express.Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});

module.exports = { healthRouter };