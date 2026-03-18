const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * ✅ Créer une permission
 */
const creerPermission = async (req, res) => {
    const { nom } = req.body;
    try {
        const permission = await prisma.permissions.create({ data: { nom } });
        res.status(201).json({ message: "Permission créée avec succès.", permission });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur.", error });
    }
};

/**
 * ✅ Modifier une permission
 */
const modifierPermission = async (req, res) => {
    const { permission_id } = req.params;
    const { nom } = req.body;
    try {
        const permission = await prisma.permissions.update({
            where: { id: parseInt(permission_id) },
            data: { nom }
        });
        res.status(200).json({ message: "Permission mise à jour avec succès.", permission });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur.", error });
    }
};

/**
 * ✅ Supprimer une permission (soft delete)
 */
const supprimerPermission = async (req, res) => {
    const { permission_id } = req.params;
    try {
        await prisma.permissions.update({ where: { id: parseInt(permission_id) }, data: { deleted_at: new Date() } });
        res.status(200).json({ message: "Permission supprimée avec succès (soft delete)." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur.", error });
    }
};

/**
 * ✅ Récupérer toutes les permissions
 */
const getPermissions = async (req, res) => {
    try {
        const permissions = await prisma.permissions.findMany({ where: { deleted_at: null } });
        res.status(200).json(permissions);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur.", error });
    }
};

module.exports = { creerPermission, modifierPermission, supprimerPermission, getPermissions };
