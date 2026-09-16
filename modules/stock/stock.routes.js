const express = require("express");

const { requireAdmin, requireAuth, requireBusiness } = require("../../middleware/auth");
const { addStock, receiveOne } = require("./stock.controller");

const stockRouter = express.Router();

stockRouter.use(requireAuth, requireBusiness);
stockRouter.use(requireAdmin);
stockRouter.post("/receive-one", receiveOne);
stockRouter.post("/add", addStock);

module.exports = { stockRouter };