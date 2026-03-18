const fs = require("fs");
const path = require("path");
const axios = require("axios");

// ✅ Vérifie et crée le dossier temporaire si nécessaire
const tmpDir = path.join(__dirname, "../tmp");
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// ✅ Télécharge un fichier depuis une URL et le stocke temporairement
const telechargerFichier = async (url) => {
    const fileName = path.basename(url);
    const filePath = path.join(tmpDir, fileName); // On stocke le fichier dans le dossier tmp

    try {
        const response = await axios({
            method: "GET",
            url: url,
            responseType: "stream",
        });

        await new Promise((resolve, reject) => {
            const stream = response.data.pipe(fs.createWriteStream(filePath));
            stream.on("finish", resolve);
            stream.on("error", reject);
        });

        return filePath;
    } catch (error) {
        console.error("❌ Erreur lors du téléchargement du fichier :", error);
        return null;
    }
};

module.exports = { telechargerFichier }
