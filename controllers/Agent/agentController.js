const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** ✅ Créer un nouvel agent */
const createAgent = async (req, res) => {

    try {
        const { nom, fonction, entite_id, section_id, superieur_id } = req.body;

        if (!nom || !fonction || !entite_id) {
            return res.status(400).json({ message: "Nom, fonction et entité sont obligatoires." });
        }

        const agent = await prisma.agents.create({
            data: {
                nom,
                fonction,
                entite_id: Number(entite_id),
                section_id: section_id ? Number(section_id) : null,
                superieur_id: superieur_id ? Number(superieur_id) : null
            }
        });

        res.status(201).json({ message: "Agent créé avec succès.", agent });
    } catch (error) {
        console.error("Erreur création agent:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Récupérer tous les agents */
const getAllAgents = async (req, res) => {
    try {
        const agents = await prisma.agents.findMany();
        res.status(200).json(agents);
    } catch (error) {
        console.error("Erreur récupération agents:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Récupérer un agent par ID */
const getAgentById = async (req, res) => {
    try {
        const { id } = req.params;
        const agent = await prisma.agents.findUnique({
            where: { id: Number(id) }
        });

        if (!agent) return res.status(404).json({ message: "Agent non trouvé." });

        res.status(200).json(agent);
    } catch (error) {
        console.error("Erreur récupération agent:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Modifier un agent */
const updateAgent = async (req, res) => {
    try {
        const { id } = req.params;
        const { nom, fonction, entite_id, section_id, superieur_id } = req.body;

        const agent = await prisma.agents.update({
            where: { id: Number(id) },
            data: {
                nom,
                fonction,
                entite_id: Number(entite_id),
                section_id: section_id ? Number(section_id) : null,
                superieur_id: superieur_id ? Number(superieur_id) : null
            }
        });

        res.status(200).json({ message: "Agent mis à jour avec succès.", agent });
    } catch (error) {
        console.error("Erreur modification agent:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

/** ✅ Supprimer un agent */
const deleteAgent = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.agents.delete({ where: { id: Number(id) } });
        res.status(200).json({ message: "Agent supprimé avec succès." });
    } catch (error) {
        console.error("Erreur suppression agent:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};

module.exports = {
    createAgent,
    getAllAgents,
    getAgentById,
    updateAgent,
    deleteAgent
};
