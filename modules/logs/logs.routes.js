const express = require("express");
const { requireAuth, optionalBusiness } = require("../../middleware/auth");
const { createLog, getLogs, clearLogs } = require("./logs.controller");

const router = express.Router();

router.use(requireAuth, optionalBusiness);
router.post("/", createLog);
router.get("/", getLogs);
router.delete("/", clearLogs);

module.exports = router;