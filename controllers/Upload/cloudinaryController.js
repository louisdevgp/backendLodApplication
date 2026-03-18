// controllers/cloudinaryController.js
const cloudinary = require("../../config/cloudinaryConfig");

const uploadFile = async (req, res) => {
  try {
    const { dossier = "documents" } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier fourni." });
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `greenpay/${dossier}` },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });
    console.log("Fichier uploadé avec succès :", result.secure_url);
    res.status(200).json({ url: result.secure_url });
  } catch (error) {
    console.error("Erreur Cloudinary :", error);
    res.status(500).json({ message: "Erreur lors de l'upload", error });
  }
};


module.exports = { uploadFile };
