/***************************************************
 * routes/demandesRoutes.js
 ****************************************************/
const express = require("express");
const multer = require("multer");

const {
  creerDemandePaiement,
  modifierDemandePaiement,
  supprimerDemandePaiement,
  getDemandesPaiement,
  getDemandePaiementById,
  demandesCountByUser,
  // demandesCountByResponsableSection,
  // demandesCountByRef,
  // demandesCountByReg,
  // demandesCountByResponsableEntite
} = require("../../controllers/DemandesPaiement/demandePaiementv1");

const router = express.Router();

// Configuration multer (stockage en mémoire pour envoi à Cloudinary)
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Créer une demande de paiement
router.post("/createDemandePaiement", upload.single("proforma"), creerDemandePaiement);

// ✅ Modifier une demande de paiement
router.put("/modifyDemandePaiement/:demande_id", upload.single("proforma"), modifierDemandePaiement);

// ✅ Supprimer une demande (soft delete)
router.delete("/deleteDemandePaiement/:demande_id", supprimerDemandePaiement);

// ✅ Récupérer la liste des demandes
router.get("/getDemandePaiement", getDemandesPaiement);

// ✅ Récupérer une demande spécifique par ID
router.get("/getDemandePaiementById/:demande_id", getDemandePaiementById);

// ✅ Routes pour stats (si tu veux les activer)
router.get("/stats/Agent", demandesCountByUser);
// router.get("/stats/Section", demandesCountByResponsableSection);
// router.get("/stats/Ref", demandesCountByRef);
// router.get("/stats/Reg", demandesCountByReg);
// router.get("/stats/Re", demandesCountByResponsableEntite);

module.exports = router;
