const express = require("express");
const multer = require("multer");
const { 
    validerDemande, 
    getDemandesEnAttente,
    getValidationsByValidateur,
    exporterValidationsExcel,
} = require("../../controllers/Validations/validationController");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Valider ou rejeter une demande de paiement
router.post("/:demande_id/valider", upload.array("pieces_jointes", 10), validerDemande);

// // ✅ Modifier une validation
// router.put("/:validation_id", modifierValidation);

// // ✅ Supprimer une validation (soft delete)
// router.delete("/:validation_id", supprimerValidation);

// // ✅ Récupérer toutes les validations
// // router.get("/", getValidations);

// ✅ Récupérer toutes les validations par validateur
router.get("/getValidationsByValidateur/:validateur_id", getValidationsByValidateur);


// // ✅ Récupérer les validations d’une demande spécifique
// router.get("/:demande_id", getValidationsByDemande);

// ✅ Récupérer les validations en attente

router.get("/en_attente/:validateur_id", getDemandesEnAttente);
router.get("/export/excel", exporterValidationsExcel);

module.exports = router;
