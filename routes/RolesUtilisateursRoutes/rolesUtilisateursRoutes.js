const express = require("express")
const { assignRoleToUser,getUserRoles,updateUserRole,removeRoleFromUser } = require("../../controllers/UserRoles/utilisateursRolesController")
const router = express.Router()

// 

router.post("/attribuerRoleUser", assignRoleToUser)
router.put("/modifyRoleUser", updateUserRole)
router.put("/getRoleUser", getUserRoles)
router.delete("/deleteRoleUser", removeRoleFromUser)


module.exports = router