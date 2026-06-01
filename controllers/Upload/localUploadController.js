const { saveBufferToLocalFile, normalizeFolder } = require("../../utils/localUpload");

const uploadFile = async (req, res) => {
  try {
    const dossier = normalizeFolder(req.body.dossier || "documents");

    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Aucun fichier fourni." });
    }

    const saved = await saveBufferToLocalFile(
      req,
      req.file.buffer,
      req.file.originalname || "document",
      dossier
    );

    return res.status(200).json({
      url: saved.url,
      filename: saved.filename,
      path: saved.relativePath,
    });
  } catch (error) {
    console.error("Erreur upload local :", error);
    return res.status(500).json({ message: "Erreur lors de l'upload", error: error.message || error });
  }
};

module.exports = { uploadFile };
