const express = require("express");
const { assignPermissionToRole,getPermissionsByRole,removePermissionFromRole } = require("../../controllers/RôlesPermissions/rolePermissionsController");
const router = express.Router()
const {verifyToken,hasRole,hasPermission} = require("../../middlewares/authMiddleware")

// Attribuer une permission à un role

router.post("/attribuerRolePermission",verifyToken,hasRole("Admin"), assignPermissionToRole)
router.get("/getPermissionsByRole/:role_id",verifyToken,hasPermission("voir_permissions"), getPermissionsByRole)
router.put("/updateRolePermission",verifyToken,hasRole("Admin"), removePermissionFromRole);
router.delete("/removePermissionFromRole/:role_id/:permission_id",verifyToken,hasRole("Admin"), removePermissionFromRole)


module.exports = router