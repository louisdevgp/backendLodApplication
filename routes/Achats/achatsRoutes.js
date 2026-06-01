const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const {
  effectuerAchat,
  getAchatByDemande,
  getAchatsEnAttente,
  getAchatsEffectues,
} = require("../../controllers/Achats/achatsController");
const { verifyToken } = require("../../middlewares/authMiddleware");

const router = express.Router();

const preuvesAchatDir = path.join(process.cwd(), "uploads", "preuves_achat");
fs.mkdirSync(preuvesAchatDir, { recursive: true });

const sanitizeFileName = (filename = "fichier") =>
  String(filename)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_");

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, preuvesAchatDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "");
      const base = path.basename(file.originalname || "preuve_achat", ext);
      const safeBase = sanitizeFileName(base).slice(0, 80) || "preuve_achat";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 100 },
});

router.use(verifyToken);

router.get("/en-attente", getAchatsEnAttente);
router.get("/effectues", getAchatsEffectues);
router.post(
  "/:demande_id/effectuer",
  upload.fields([
    { name: "preuves", maxCount: 100 },
    { name: "preuves[]", maxCount: 100 },
    { name: "preuves_achat", maxCount: 100 },
    { name: "preuves_achat[]", maxCount: 100 },
    { name: "files", maxCount: 100 },
  ]),
  effectuerAchat
);
router.get("/:demande_id", getAchatByDemande);

module.exports = router;
