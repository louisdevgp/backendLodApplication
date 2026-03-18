const express = require("express");
const router = express.Router();
const {
    createAgent,
    getAllAgents,
    getAgentById,
    updateAgent,
    deleteAgent
} = require("../../controllers/Agent/agentController");

router.post("/createAgent", createAgent);
router.get("/getAllAgents", getAllAgents);
router.get("/getAgentById/:id", getAgentById);
router.put("/updateAgent/:id", updateAgent);
router.delete("/deleteAgent/:id", deleteAgent);

module.exports = router;
