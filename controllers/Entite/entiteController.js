const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** ✅ Créer une nouvelle entité */
const createEntite = async (req, res) => {
    console.log(req.body)
    try {
        const { nom } = req.body;
        if (!nom) return res.status(400).json({ message: "Le nom de l'entité est requis." });

        const entite = await prisma.entites.create({ data: { nom } });
        res.status(201).json({ message: "Entité créée avec succès.", entite });
    } catch (error) {
        console.error("Erreur création entité:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Récupérer toutes les entités */
const getAllEntites = async (req, res) => {
    try {
        const entites = await prisma.entites.findMany();
        res.status(200).json(entites);
    } catch (error) {
        console.error("Erreur récupération entités:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Récupérer une entité par ID */
const getEntiteById = async (req, res) => {
    try {
        const { id } = req.params;
        const entite = await prisma.entites.findUnique({ where: { id: Number(id) } });

        if (!entite) return res.status(404).json({ message: "Entité non trouvée." });

        res.status(200).json(entite);
    } catch (error) {
        console.error("Erreur récupération entité:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Modifier une entité */
const updateEntite = async (req, res) => {
    try {
        const { id } = req.params;
        const { nom } = req.body;
        
        const entite = await prisma.entites.update({
            where: { id: Number(id) },
            data: { nom }
        });

        res.status(200).json({ message: "Entité mise à jour avec succès.", entite });
    } catch (error) {
        console.error("Erreur modification entité:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Supprimer une entité */
const deleteEntite = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.entites.delete({ where: { id: Number(id) } });
        res.status(200).json({ message: "Entité supprimée avec succès." });
    } catch (error) {
        console.error("Erreur suppression entité:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

module.exports = {
    createEntite,
    getAllEntites,
    getEntiteById,
    updateEntite,
    deleteEntite
};
