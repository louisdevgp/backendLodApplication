const express = require("express");
const multer = require("multer");
const {uploads} = require("../../utils/upload")
const { uploadFile } = require("../../controllers/Upload/localUploadController");
const {
    creerDemandePaiement,
    modifierDemandePaiement,
    supprimerDemandePaiement,
    getDemandesPaiement,
    getDemandePaiementById,
    demandesCountByUser,
    demandesCountByResponsableSection,
    demandesCountByRef,
    demandesCountByReg,
    demandesCountByResponsableEntite,
    getAllDemandesPaiement,
    exporterDemandesPaiementExcel,
    viewDocument,
} = require("../../controllers/DemandesPaiement/demandePaiement");
const {
  ajouterProformas,
  listerProformas,
  supprimerProforma,
} = require("../../controllers/Proformas/proformaController");
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });



// Proformas routes
router.post("/demandes/:id/proformas", upload.array("proformas", 100), ajouterProformas);
router.get("/demandes/:id/proformas", listerProformas);
router.delete("/proformas/:proformaId", supprimerProforma);


// routes
router.post(
  "/createDemandePaiement",
  upload.fields([
    { name: "proformas", maxCount: 100 }, // nouveau (Create/Edit)
    { name: "proforma",  maxCount: 100 }, // legacy
  ]),
  creerDemandePaiement
);

router.put(
  "/modifyDemandePaiement/:demande_id",
  upload.fields([
    { name: "proformas", maxCount: 100 },
    { name: "proforma",  maxCount: 100 },
  ]),
  modifierDemandePaiement
);
// ✅ Route pour uploader de fichier
router.post("/upload", upload.single("file"), uploadFile);
router.get("/view-document", viewDocument);

// ✅ Route pour supprimer une demande de paiement (soft delete)
router.delete("/deleteDemandePaiement/:demande_id", supprimerDemandePaiement);

// ✅ Route pour récupérer toutes les demandes de paiement
router.get("/getDemandePaiement", getDemandesPaiement);

// ✅ Route pour récupérer toutes les demandes de paiement
router.get("/getAllDemandePaiement", getAllDemandesPaiement);
router.get("/export/excel", exporterDemandesPaiementExcel);


// ✅ Route pour récupérer une demande spécifique
router.get("/getDemandePaiementById/:demande_id", getDemandePaiementById);

// ✅ Route pour les stats
router.get("/stats/Agent", demandesCountByUser);
router.get("/stats/Section", demandesCountByResponsableSection);
router.get("/stats/Ref", demandesCountByRef);
router.get("/stats/Reg", demandesCountByReg);
router.get("/stats/Re", demandesCountByResponsableEntite);

module.exports = router;
