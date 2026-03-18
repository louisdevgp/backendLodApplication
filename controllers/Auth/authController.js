const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");
const { envoyerEmail } = require("../../config/emailConfig");
const cloudinary = require("../../config/cloudinaryConfig");
require("crypto");

const prisma = new PrismaClient();

/** ✅ REGISTER (Créer un compte) */
const register = async (req, res) => {
  try {
    const { email, mot_de_passe, agent_id } = req.body;

    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    // Vérifier si l'email existe déjà
    const exist = await prisma.utilisateurs.findUnique({ where: { email } });
    if (exist) return res.status(400).json({ message: "Email déjà utilisé." });

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

    const user = await prisma.utilisateurs.create({
      data: { email, mot_de_passe: hashedPassword, agent_id },
    });

    res.status(201).json({ message: "Utilisateur créé avec succès.", user });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/** ✅ LOGIN (Connexion) */
const login = async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;
    const user = await prisma.utilisateurs.findUnique({
      where: { email },
      include: { agents: true },
    });

    if (!user)
      return res.status(401).json({ message: "Identifiants invalides." });

    const isMatch = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!isMatch)
      return res.status(401).json({ message: "Identifiants invalides." });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(200).json({ message: "Connexion réussie.", token, user });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/** ✅ FORGOT PASSWORD (Demander réinitialisation) */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const users = await prisma.utilisateurs.findMany({ where: { email } });
    const user = users[0];

    if (!user)
      return res.status(404).json({ message: "Utilisateur non trouvé." });

    // 🔹 Génération d’un token sécurisé
    const resetToken = crypto.randomUUID().toString("hex");

    // 🔹 Stockage du token dans la base (expire dans 1h)
    await prisma.utilisateurs.update({
      where: { id: user.id },
      data: {
        reset_token: resetToken,
        reset_expires: new Date(Date.now() + 3600000),
      },
    });

    // 🔹 URL de réinitialisation (frontend)
    const resetURL = `${process.env.FRONTEND_URL}/password/reset-password/${resetToken}`;

    // 🔹 Envoi de l'email
    const html = `
            <h3>Demande de réinitialisation de mot de passe</h3>
            <p>Bonjour ${user.email},</p>
            <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
            <p>👉 <a href="${resetURL}">Cliquez ici pour réinitialiser votre mot de passe</a></p>
            <p>Ce lien expire dans 1 heure.</p>
            <p>Si vous n'avez pas fait cette demande, ignorez cet email.</p>
        `;

    await envoyerEmail(
      user.email,
      "Réinitialisation de votre mot de passe",
      html
    );

    res.status(200).json({ message: "Email de réinitialisation envoyé." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/** ✅ RESET PASSWORD (Réinitialiser avec le token) */
const resetPassword = async (req, res) => {
  // console.table(req.params)
  try {
    const { token } = req.params;
    const { mot_de_passe } = req.body;
    // console.log("ICI")
    // 🔹 Vérifier si le token existe et n'a pas expiré
    const user = await prisma.utilisateurs.findMany({
      where: { reset_token: token, reset_expires: { gt: new Date() } },
    });

    // console.table(user)

    if (!user)
      return res.status(400).json({ message: "Token invalide ou expiré." });

    // 🔹 Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

    // 🔹 Mettre à jour l'utilisateur et supprimer le token
    await prisma.utilisateurs
      .updateMany({
        where: { id: Number(user[0].id) },
        data: {
          mot_de_passe: hashedPassword,
          reset_token: null,
          reset_expires: null,
        },
      })
      .then((ok) => {
        if (ok) {
          console.log(ok);
        } else {
          console.log("NON OK");
        }
      })
      .catch((error) => {
        console.table(error);
      });

    res.status(200).json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/** ✅ UPLOAD SIGNATURE */
const uploadSignature = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file)
      return res.status(400).json({ message: "Aucun fichier envoyé." });

    const result = await cloudinary.uploader.upload(req.file.path);
    await prisma.utilisateurs.update({
      where: { id: Number(id) },
      data: { signature: result.secure_url },
    });

    res
      .status(200)
      .json({ message: "Signature mise à jour.", url: result.secure_url });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/** ✅ UPDATE USER */
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, agent_id } = req.body;

    const user = await prisma.utilisateurs.update({
      where: { id: Number(id) },
      data: { email, agent_id },
    });

    res.status(200).json({ message: "Utilisateur mis à jour.", user });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/** ✅ DELETE USER */
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.utilisateurs.delete({ where: { id: Number(id) } });
    res.status(200).json({ message: "Utilisateur supprimé avec succès." });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/** ✅  CHANGE PASSWORD */
const changePassword = async (req, res) => {
    const {ancien_mot_de_passe, nouveau_mot_de_passe } = req.body;
  try {
    const word = req.headers.authorization;
    const token = word.slice(7, -1);
    const utilisateur = jwt.decode(token);

    try {
      const user = await prisma.utilisateurs.findUnique({
        where: { id: parseInt(utilisateur.userId) },
        include: { agents: true },
      });

      if (!user) {
        return res.status(403).json({ message: "Utilisateur non trouvé." });
      }
      // Vérifier l'ancien mot de passe
      const isMatch = await bcrypt.compare(
        ancien_mot_de_passe,
        user.mot_de_passe
      );
      if (!isMatch)
        return res
          .status(401)
          .json({ message: "Ancien mot de passe incorrect." });

      // Hasher le nouveau mot de passe
      const hashedPassword = await bcrypt.hash(nouveau_mot_de_passe, 10);

      // Mettre à jour le mot de passe
      await prisma.utilisateurs.update({
        where: { id: Number(user.id) },
        data: { mot_de_passe: hashedPassword },
      });

      res.status(200).json({ message: "Mot de passe mis à jour avec succès." });
    } catch (error) {
        console.error(error);
      res.status(500).json({ message: "Erreur serveur.", error });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  updateUser,
  uploadSignature,
  deleteUser,
  changePassword,
};
