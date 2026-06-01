// utils/upload.js
const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 100 },
});

module.exports = { upload };
