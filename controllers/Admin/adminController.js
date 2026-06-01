const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const cleanName = (value) => String(value || "").trim();

const formatUser = (user) => ({
  id: user.id,
  email: user.email,
  agent_id: user.agent_id,
  signature: user.signature,
  agents: user.agents,
  roles: (user.utilisateur_roles || [])
    .map((ur) => ur.roles)
    .filter(Boolean)
    .map((role) => ({ id: role.id, nom: cleanName(role.nom) })),
});

const getUsers = async (req, res) => {
  try {
    const users = await prisma.utilisateurs.findMany({
      orderBy: { id: "asc" },
      include: {
        agents: {
          include: {
            entites: true,
            sections: true,
          },
        },
        utilisateur_roles: {
          include: { roles: true },
        },
      },
    });

    return res.status(200).json({ users: users.map(formatUser) });
  } catch (error) {
    console.error("Erreur getUsers:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const getRoles = async (req, res) => {
  try {
    const roles = await prisma.roles.findMany({ orderBy: { nom: "asc" } });
    return res.status(200).json({
      roles: roles.map((role) => ({ ...role, nom: cleanName(role.nom) })),
    });
  } catch (error) {
    console.error("Erreur getRoles:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const createRole = async (req, res) => {
  try {
    const nom = cleanName(req.body.nom);
    if (!nom) return res.status(400).json({ message: "Le nom du role est requis." });

    const role = await prisma.roles.upsert({
      where: { nom },
      update: {},
      create: { nom },
    });

    return res.status(201).json({ role: { ...role, nom: cleanName(role.nom) } });
  } catch (error) {
    console.error("Erreur createRole:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const assignRole = async (req, res) => {
  try {
    const utilisateurId = Number(req.params.userId);
    const roleId = Number(req.body.role_id);

    if (!utilisateurId || !roleId) {
      return res.status(400).json({ message: "Utilisateur ou role invalide." });
    }

    const [user, role] = await Promise.all([
      prisma.utilisateurs.findUnique({ where: { id: utilisateurId } }),
      prisma.roles.findUnique({ where: { id: roleId } }),
    ]);

    if (!user) return res.status(404).json({ message: "Utilisateur non trouve." });
    if (!role) return res.status(404).json({ message: "Role non trouve." });

    await prisma.utilisateur_roles.upsert({
      where: {
        utilisateur_id_role_id: {
          utilisateur_id: utilisateurId,
          role_id: roleId,
        },
      },
      update: {},
      create: {
        utilisateur_id: utilisateurId,
        role_id: roleId,
      },
    });

    return res.status(201).json({ message: "Role attribue." });
  } catch (error) {
    console.error("Erreur assignRole:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const removeRole = async (req, res) => {
  try {
    const utilisateurId = Number(req.params.userId);
    const roleId = Number(req.params.roleId);

    if (!utilisateurId || !roleId) {
      return res.status(400).json({ message: "Utilisateur ou role invalide." });
    }

    await prisma.utilisateur_roles.delete({
      where: {
        utilisateur_id_role_id: {
          utilisateur_id: utilisateurId,
          role_id: roleId,
        },
      },
    });

    return res.status(200).json({ message: "Role retire." });
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "Role non attribue a cet utilisateur." });
    }
    console.error("Erreur removeRole:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

module.exports = {
  getUsers,
  getRoles,
  createRole,
  assignRole,
  removeRole,
};
