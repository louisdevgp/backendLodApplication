const express = require("express");
const { creerPermission, modifierPermission, supprimerPermission, getPermissions } = require("../controllers/permissionController");

const router = express.Router();

// ✅ CRUD Permissions
router.post("/permissions", creerPermission);
router.put("/permissions/:permission_id", modifierPermission);
router.delete("/permissions/:permission_id", supprimerPermission);
router.get("/permissions", getPermissions);

module.exports = router;
