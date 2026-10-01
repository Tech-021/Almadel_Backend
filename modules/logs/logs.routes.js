const express = require("express");
const {
  requireAuth,
  requireBusiness,
  requireBusinessOwnerOrAdmin,
} = require("../../middleware/auth");
const { createLog, getLogs, clearLogs } = require("./logs.controller");

const router = express.Router();

// All log routes require an authenticated member of the active business.
// Never use optionalBusiness here — an unset businessId would dump/wipe all tenants.
router.use(requireAuth, requireBusiness);

router.post("/", createLog);
router.get("/", requireBusinessOwnerOrAdmin, getLogs);
router.delete("/", requireBusinessOwnerOrAdmin, clearLogs);

module.exports = router;
