const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * ✅ Créer un agent
 */
const createAgent = async (req, res) => {
    const { nom, fonction_id, departement_id, service_id, superieur_id } = req.body;

    try {
        // Vérification : si l’agent a une fonction de responsable ou directeur, il ne peut pas être dans un service
        const fonction = await prisma.fonctions.findUnique({ where: { id: parseInt(fonction_id) } });
        if (!fonction) {
            return res.status(400).json({ message: "Fonction invalide." });
        }

        const isResponsable = ["Responsable", "Directeur", "DG", "DAF"].includes(fonction.nom);
        if (isResponsable && service_id) {
            return res.status(400).json({ message: "Un responsable ou directeur ne peut pas être affecté à un service." });
        }

        const agent = await prisma.agents.create({
            data: {
                nom : nom,
                fonction_id : parseInt(fonction_id),
                service_id: isResponsable ? null : parseInt(service_id),
                superieur_id : parseInt(superieur_id),
                departement_id : parseInt(departement_id)
            }
        });

        res.status(201).json({ message: "Agent créé avec succès.", agent });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur.", error });
    }
};

/**
 * ✅ Modifier un agent
 */
const updateAgent = async (req, res) => {
    const { agent_id } = req.params;
    const { nom, fonction_id, departement_id, service_id, superieur_id } = req.body;

    try {
        const fonction = await prisma.fonctions.findUnique({ where: { id: fonction_id } });
        if (!fonction) {
            return res.status(400).json({ message: "Fonction invalide." });
        }

        const isResponsable = ["Responsable", "Directeur", "DG", "DAF"].includes(fonction.nom);
        if (isResponsable && service_id) {
            return res.status(400).json({ message: "Un responsable ou directeur ne peut pas être affecté à un service." });
        }

        const agent = await prisma.agents.update({
            where: { id: parseInt(agent_id) },
            data: { nom, fonction_id, departement_id, service_id: isResponsable ? null : service_id, superieur_id }
        });

        res.status(200).json({ message: "Agent mis à jour avec succès.", agent });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur.", error });
    }
};

/**
 * ✅ Supprimer un agent (soft delete)
 */
const deleteAgent = async (req, res) => {
    const { agent_id } = req.params;

    try {
        await prisma.agents.update({
            where: { id: parseInt(agent_id) },
            data: { deleted_at: new Date() }
        });

        res.status(200).json({ message: "Agent supprimé avec succès (soft delete)." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur.", error });
    }
};

/**
 * ✅ Récupérer tous les agents avec leurs relations
 */
const getAgents = async (req, res) => {
    try {
        const agents = await prisma.agents.findMany({
            where: { deleted_at: null },
            include: {
                fonctions: true,
                departements: true,
                services: true,
                agents: { select: { nom: true } } // Supérieur hiérarchique
            }
        });

        res.status(200).json(agents);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur.", error });
    }
};

module.exports = { createAgent, updateAgent, deleteAgent, getAgents };
