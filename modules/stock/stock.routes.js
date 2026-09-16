const express = require("express");

const { requireAdmin, requireAuth } = require("../../middleware/auth");
const { addStock, receiveOne } = require("./stock.controller");

const stockRouter = express.Router();

stockRouter.use(requireAuth);
stockRouter.use(requireAdmin);
stockRouter.post("/receive-one", receiveOne);
stockRouter.post("/add", addStock);

module.exports = { stockRouter };