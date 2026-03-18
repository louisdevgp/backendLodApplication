/***************************************************
 * routes/validationsRoutes.js
 ****************************************************/
const express = require("express");
const {
  validerDemande,
  getDemandesEnAttente,
  getValidationsByValidateur,
} = require("../../controllers/Validations/validationControllerv1");

const router = express.Router();

// ✅ Valider ou rejeter une demande
router.post("/:demande_id/valider", validerDemande);

// ✅ Récupérer les validations passées d’un validateur
router.get("/getValidationsByValidateur/:validateur_id", getValidationsByValidateur);

// ✅ Récupérer les demandes en attente de validation pour un validateur
router.get("/en_attente/:validateur_id", getDemandesEnAttente);

module.exports = router;
