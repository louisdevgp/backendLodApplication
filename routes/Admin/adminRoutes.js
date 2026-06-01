const express = require("express");
const {
  assignRole,
  createRole,
  getRoles,
  getUsers,
  removeRole,
} = require("../../controllers/Admin/adminController");
const { hasRole, verifyToken } = require("../../middlewares/authMiddleware");

const router = express.Router();

router.use(verifyToken, hasRole(["Admin", "Administrateur"]));

router.get("/users", getUsers);
router.get("/roles", getRoles);
router.post("/roles", createRole);
router.post("/users/:userId/roles", assignRole);
router.delete("/users/:userId/roles/:roleId", removeRole);

module.exports = router;
