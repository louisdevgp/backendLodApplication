const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** ✅ Assigner un rôle à un utilisateur */
const assignRoleToUser = async (req, res) => {
    try {
        const { utilisateur_id, role_id } = req.body;

        // Vérifier si l'utilisateur existe
        const utilisateur = await prisma.utilisateurs.findUnique({
            where: { id: Number(utilisateur_id) }
        });
        if (!utilisateur) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        // Vérifier si le rôle existe
        const role = await prisma.roles.findUnique({
            where: { id: Number(role_id) }
        });
        if (!role) {
            return res.status(404).json({ message: "Rôle non trouvé" });
        }

        // Assigner le rôle
        await prisma.utilisateur_roles.create({
            data: { utilisateur_id: Number(utilisateur_id), role_id: Number(role_id) }
        });

        res.status(201).json({ message: "Rôle assigné à l'utilisateur" });
    } catch (error) {
        console.error("Erreur assignation rôle :", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

/** ✅ Modifier le rôle d’un utilisateur */
const updateUserRole = async (req, res) => {
    try {
        const { utilisateur_id, nouveau_role_id } = req.body;

        // Vérifier si l'utilisateur existe
        const utilisateur = await prisma.utilisateurs.findUnique({
            where: { id: Number(utilisateur_id) }
        });
        if (!utilisateur) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        // Vérifier si le nouveau rôle existe
        const role = await prisma.roles.findUnique({
            where: { id: Number(nouveau_role_id) }
        });
        if (!role) {
            return res.status(404).json({ message: "Nouveau rôle non trouvé" });
        }

        // Vérifier si l'utilisateur a déjà un rôle
        const userRole = await prisma.utilisateur_roles.findFirst({
            where: { utilisateur_id: Number(utilisateur_id) }
        });

        if (userRole) {
            // Mettre à jour le rôle existant
            await prisma.utilisateur_roles.update({
                where: { id: userRole.id },
                data: { role_id: Number(nouveau_role_id) }
            });

            res.status(200).json({ message: "Rôle mis à jour avec succès" });
        } else {
            // Si l'utilisateur n'a pas de rôle, lui en assigner un
            await prisma.utilisateur_roles.create({
                data: { utilisateur_id: Number(utilisateur_id), role_id: Number(nouveau_role_id) }
            });

            res.status(201).json({ message: "Rôle attribué avec succès" });
        }
    } catch (error) {
        console.error("Erreur modification rôle :", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

/** ✅ Obtenir les rôles d’un utilisateur */
const getUserRoles = async (req, res) => {
    try {
        const { utilisateur_id } = req.params;

        const roles = await prisma.utilisateur_roles.findMany({
            where: { utilisateur_id: Number(utilisateur_id) },
            include: { roles: true }
        });

        res.status(200).json(roles);
    } catch (error) {
        console.error("Erreur récupération rôles :", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

/** ✅ Supprimer un rôle d’un utilisateur */
const removeRoleFromUser = async (req, res) => {
    try {
        const { utilisateur_id, role_id } = req.params;

        // Vérifier si le rôle existe pour cet utilisateur
        const userRole = await prisma.utilisateur_roles.findFirst({
            where: { utilisateur_id: Number(utilisateur_id), role_id: Number(role_id) }
        });

        if (!userRole) {
            return res.status(404).json({ message: "Rôle non trouvé pour cet utilisateur" });
        }

        // Supprimer le rôle
        await prisma.utilisateur_roles.delete({
            where: { id: userRole.id }
        });

        res.status(200).json({ message: "Rôle retiré de l'utilisateur" });
    } catch (error) {
        console.error("Erreur suppression rôle :", error);
        res.status(500).json({ message: "Erreur serveur", error });
    }
};

module.exports = {
  assignRoleToUser,getUserRoles,updateUserRole,removeRoleFromUser
}
