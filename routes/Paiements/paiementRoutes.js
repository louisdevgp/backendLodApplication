// routes/Paiements/paiements.routes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ⬇️ Import correct (export par défaut dans generateDemandePaiementPDF.js)
const generateDemandePaiementPDF= require("../../utils/pdf");

const {
  effectuerPaiement,
  getPaiementByDemande,
} = require("../../controllers/Paiements/paiementController");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Effectuer un paiement (avec preuves)
router.post(
  "/effectuerPaiement/:demande_id",
  upload.array("preuvesPaiement"),
  effectuerPaiement
);

/**
 * ✅ Télécharger le PDF de la demande (PLACÉ AVANT /:demande_id)
 *    Important : la route paramétrique sinon capture /download-pdf/...
 */
router.get("/download-pdf/:demande_id", async (req, res) => {
  try {
    const { demande_id } = req.params;
    const idNum = Number(demande_id);

    if (!idNum || Number.isNaN(idNum)) {
      return res.status(400).json({ message: "ID de demande invalide." });
    }

    console.log(`🔍 Récupération demande #${idNum}`);

    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: idNum },
      include: {
        agents: true,
        validations: { include: { utilisateurs: true } },
        paiements: true,
        proformas: true,
      },
    });

    if (!demande) {
      console.error("❌ Demande non trouvée.");
      return res.status(404).json({ message: "Demande introuvable." });
    }

    // Remarque/mention section (facultatif)
    const nbMentionSection = await prisma.validations.findFirst({
      where: {
        demande_id: idNum,
        utilisateurs: { email: "sidoine@greenpayci.com" },
      },
      select: { commentaire: true },
    });
    demande.nbMentionSection = nbMentionSection?.commentaire || "";

    // ✅ S'assure que le dossier existe
    const pdfDir = path.resolve(__dirname, "../../public/pdfs");
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const outputPath = path.join(pdfDir, `demande_paiement_${idNum}.pdf`);
    console.log(`📄 Génération PDF → ${outputPath}`);

    await generateDemandePaiementPDF(demande, outputPath);

    if (!fs.existsSync(outputPath)) {
      console.error("❌ Le PDF n'a pas été généré.");
      return res
        .status(500)
        .json({ message: "Erreur lors de la génération du PDF." });
    }

    // Téléchargement
    res.download(outputPath, `demande_paiement_${idNum}.pdf`, (err) => {
      if (err) {
        console.error("❌ Erreur lors de l'envoi du PDF :", err);
        return res
          .status(500)
          .json({ message: "Erreur lors du téléchargement du fichier." });
      }
    });
  } catch (error) {
    console.error("❌ Erreur serveur :", error);
    res.status(500).json({ message: "Erreur serveur.", error: String(error) });
  }
});

// ✅ Récupérer le paiement d’une demande (la route paramétrique vient APRÈS)
router.get("/:demande_id", getPaiementByDemande);

module.exports = router;
