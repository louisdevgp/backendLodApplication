const express = require("express")
const router = express.Router()

// Controllers
const {
    createEntite,
    getAllEntites,
    getEntiteById,
    updateEntite,
    deleteEntite
} = require("../../controllers/Entite/entiteController");

router.post("/createEntite", createEntite);
router.get("/getAllEntites", getAllEntites);
router.get("/getEntiteById/:id", getEntiteById);
router.put("/updateEntite/:id", updateEntite);
router.delete("/deleteEntite/:id", deleteEntite);

module.exports = router