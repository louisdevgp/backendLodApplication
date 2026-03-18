const express = require("express")
const router = express.Router();
const multer = require("multer")
const upload = multer({ storage: multer.memoryStorage() });
const {register,login,forgotPassword,resetPassword,updateUser,uploadSignature,deleteUser,changePassword} = require("../../controllers/Auth/authController")

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
router.put("/update/:id", updateUser);
router.put("/upload-signature/:id", upload.single("signature"), uploadSignature);
router.delete("/delete/:id", deleteUser);
router.patch("/update-password", changePassword); // Assuming you want to use the same updateUser function for changing password

module.exports = router
