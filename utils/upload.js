// utils/upload.js
const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ok =
    /^application\/pdf$/.test(file.mimetype) ||
    /^image\/(png|jpe?g|webp|gif|bmp|tiff)$/.test(file.mimetype);
  if (!ok) return cb(new Error("Type de fichier non supporté (PDF/Images uniquement)"), false);
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024, files: 100 },
});

module.exports = { upload };
