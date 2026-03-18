const express = require("express");
const router = express.Router();
const {
    createSection,
    getAllSections,
    getSectionById,
    updateSection,
    deleteSection
} = require("../../controllers/Section/sectionsController");

router.post("/createSection", createSection);
router.get("/getAllSections", getAllSections);
router.get("/getSectionById/:id", getSectionById);
router.put("/updateSection/:id", updateSection);
router.delete("/deleteSection/:id", deleteSection);

module.exports = router;
