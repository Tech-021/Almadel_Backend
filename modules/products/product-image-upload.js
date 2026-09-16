const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadsDir = path.join(__dirname, "..", "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const allowedMimeTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const extensionByMimeType = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter(_req, file, callback) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Only JPG, PNG, WEBP, or GIF images are allowed."));
      return;
    }

    callback(null, true);
  },
});

function uploadProductImage(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "No image file provided." });
  }

  const extension =
    extensionByMimeType[req.file.mimetype] ??
    path.extname(req.file.originalname ?? "").toLowerCase() ??
    ".jpg";
  const filename = `product-${Date.now()}-${crypto
    .randomBytes(6)
    .toString("hex")}${extension}`;
  const targetPath = path.join(uploadsDir, filename);

  fs.renameSync(req.file.path, targetPath);

  return res.status(201).json({ url: `/uploads/${filename}` });
}

module.exports = { upload, uploadProductImage };