const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** ✅ Assigner une permission à un rôle */
const assignPermissionToRole = async (req, res) => {
  try {
      const { role_id, permission_id } = req.body;

      // Vérifier si le rôle existe
      const role = await prisma.roles.findUnique({ where: { id: Number(role_id) } });
      if (!role) {
          return res.status(404).json({ message: "Rôle non trouvé" });
      }

      // Vérifier si la permission existe
      const permission = await prisma.permissions.findUnique({ where: { id: Number(permission_id) } });
      if (!permission) {
          return res.status(404).json({ message: "Permission non trouvée" });
      }

      // Vérifier si la permission est déjà attribuée
      const existingPermission = await prisma.role_permissions.findFirst({
          where: { role_id: Number(role_id), permission_id: Number(permission_id) }
      });

      if (existingPermission) {
          return res.status(400).json({ message: "Cette permission est déjà assignée à ce rôle" });
      }

      // Assigner la permission
      await prisma.role_permissions.create({
          data: { role_id: Number(role_id), permission_id: Number(permission_id) }
      });

      res.status(201).json({ message: "Permission assignée au rôle avec succès" });
  } catch (error) {
      console.error("Erreur assignation permission :", error);
      res.status(500).json({ message: "Erreur serveur", error });
  }
};

/** ✅ Modifier une permission d’un rôle */
const updateRolePermission = async (req, res) => {
  try {
      const { role_id, old_permission_id, new_permission_id } = req.body;

      // Vérifier si l'association actuelle existe
      const existingRolePermission = await prisma.role_permissions.findFirst({
          where: { role_id: Number(role_id), permission_id: Number(old_permission_id) }
      });

      if (!existingRolePermission) {
          return res.status(404).json({ message: "Ancienne permission non trouvée pour ce rôle" });
      }

      // Vérifier si la nouvelle permission existe
      const newPermission = await prisma.permissions.findUnique({
          where: { id: Number(new_permission_id) }
      });

      if (!newPermission) {
          return res.status(404).json({ message: "Nouvelle permission non trouvée" });
      }

      // Mettre à jour la permission
      await prisma.role_permissions.update({
          where: { id: existingRolePermission.id },
          data: { permission_id: Number(new_permission_id) }
      });

      res.status(200).json({ message: "Permission mise à jour avec succès" });
  } catch (error) {
      console.error("Erreur modification permission :", error);
      res.status(500).json({ message: "Erreur serveur", error });
  }
};

/** ✅ Obtenir les permissions d’un rôle */
const getPermissionsByRole = async (req, res) => {
  try {
      const { role_id } = req.params;

      // Vérifier si le rôle existe
      const role = await prisma.roles.findUnique({ where: { id: Number(role_id) } });
      if (!role) {
          return res.status(404).json({ message: "Rôle non trouvé" });
      }

      // Récupérer les permissions du rôle
      const permissions = await prisma.role_permissions.findMany({
          where: { role_id: Number(role_id) },
          include: { permissions: true }
      });

      res.status(200).json(permissions);
  } catch (error) {
      console.error("Erreur récupération permissions :", error);
      res.status(500).json({ message: "Erreur serveur", error });
  }
};

/** ✅ Supprimer une permission d’un rôle */
const removePermissionFromRole = async (req, res) => {
  try {
      const { role_id, permission_id } = req.params;

      // Vérifier si la permission est bien attribuée au rôle
      const rolePermission = await prisma.role_permissions.findFirst({
          where: { role_id: Number(role_id), permission_id: Number(permission_id) }
      });

      if (!rolePermission) {
          return res.status(404).json({ message: "Permission non trouvée pour ce rôle" });
      }

      // Supprimer la permission
      await prisma.role_permissions.delete({
          where: { id: rolePermission.id }
      });

      res.status(200).json({ message: "Permission retirée du rôle avec succès" });
  } catch (error) {
      console.error("Erreur suppression permission :", error);
      res.status(500).json({ message: "Erreur serveur", error });
  }
};

module.exports = {
  assignPermissionToRole,
  updateRolePermission,
  getPermissionsByRole,
  removePermissionFromRole
};
