function notFoundHandler(req, res) {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

function errorHandler(error, _req, res, _next) {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    return res.status(413).json({
      message: "Request body is too large. Please reduce the uploaded image size and try again.",
    });
  }

  console.error("Unhandled API error:", error);
  res.status(500).json({ message: "Unexpected server error." });
}

module.exports = { errorHandler, notFoundHandler };
