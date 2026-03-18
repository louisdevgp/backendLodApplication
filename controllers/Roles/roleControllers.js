const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** ✅ Créer un rôle */
const createRole = async (req, res) => {
  try {
    const { nom } = req.body;
    const role = await prisma.roles.create({ data: { nom } });
    res.status(201).json(role);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error });
  }
};

/** ✅ Obtenir tous les rôles */
const getAllRoles = async (req, res) => {
  try {
    const roles = await prisma.roles.findMany();
    res.status(200).json(roles);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error });
  }
};

/** ✅ Mettre à jour un rôle */
const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { nom } = req.body;
    const role = await prisma.roles.update({
      where: { id: Number(id) },
      data: { nom },
    });
    res.status(200).json(role);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error });
  }
};

/** ✅ Supprimer un rôle */
const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.roles.delete({ where: { id: Number(id) } });
    res.status(200).json({ message: "Rôle supprimé" });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error });
  }
};

module.exports = { createRole, getAllRoles, deleteRole, updateRole };
