const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** ✅ Créer une nouvelle section */
const createSection = async (req, res) => {
    try {
        const { nom, entite_id } = req.body;
        if (!nom || !entite_id) {
            return res.status(400).json({ message: "Le nom et l'entité sont requis." });
        }

        const section = await prisma.sections.create({
            data: { nom, entite_id: Number(entite_id) }
        });

        res.status(201).json({ message: "Section créée avec succès.", section });
    } catch (error) {
        console.error("Erreur création section:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Récupérer toutes les sections */
const getAllSections = async (req, res) => {
    try {
        const sections = await prisma.sections.findMany({
            include: { entites: true } // Inclure les infos de l'entité
        });
        res.status(200).json(sections);
    } catch (error) {
        console.error("Erreur récupération sections:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Récupérer une section par ID */
const getSectionById = async (req, res) => {
    try {
        const { id } = req.params;
        const section = await prisma.sections.findUnique({
            where: { id: Number(id) },
            include: { entites: true } // Inclure les infos de l'entité
        });

        if (!section) return res.status(404).json({ message: "Section non trouvée." });

        res.status(200).json(section);
    } catch (error) {
        console.error("Erreur récupération section:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Modifier une section */
const updateSection = async (req, res) => {
    try {
        const { id } = req.params;
        const { nom, entite_id } = req.body;

        const section = await prisma.sections.update({
            where: { id: Number(id) },
            data: { nom, entite_id: Number(entite_id) }
        });

        res.status(200).json({ message: "Section mise à jour avec succès.", section });
    } catch (error) {
        console.error("Erreur modification section:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Supprimer une section */
const deleteSection = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.sections.delete({ where: { id: Number(id) } });
        res.status(200).json({ message: "Section supprimée avec succès." });
    } catch (error) {
        console.error("Erreur suppression section:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

module.exports = {
    createSection,
    getAllSections,
    getSectionById,
    updateSection,
    deleteSection
};
