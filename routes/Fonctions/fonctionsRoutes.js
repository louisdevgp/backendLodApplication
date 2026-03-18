const express = require("express")
const { getAllfonctions, getOneFonction } = require("../../controllers/Fonctions/fonctionsControllers")
const router = express.Router()

// Get all fonctions
router.get("/getAllfonctions", getAllfonctions)

// Get One fonction
router.get("/getOneFOnction/:id_fonction", getOneFonction)


// Modify fonction


module.exports = router