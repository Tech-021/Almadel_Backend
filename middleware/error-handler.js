function notFoundHandler(req, res) {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

function errorHandler(error, _req, res, _next) {
  console.error("Unhandled API error:", error);
  res.status(500).json({ message: "Unexpected server error." });
}

module.exports = { errorHandler, notFoundHandler };