const express = require("express");
const { createRole,getAllRoles,deleteRole,updateRole} = require("../../controllers/Roles/roleControllers");

const router = express.Router();

// ✅ CRUD Rôles
router.post("/roles", createRole);
router.put("/roles/:role_id", updateRole);
router.delete("/roles/:role_id", deleteRole);
router.get("/roles", getAllRoles);

module.exports = router;
