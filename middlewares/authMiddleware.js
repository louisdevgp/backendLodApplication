const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();

const normalizeName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, " ");

const verifyToken = (req, res, next) => {
  const authorization = req.header("Authorization");

  if (!authorization) {
    return res.status(401).json({ message: "Acces refuse. Token manquant." });
  }

  try {
    const token = authorization.startsWith("Bearer ")
      ? authorization.split(" ")[1]
      : authorization;
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { ...verified, id: verified.userId || verified.id };
    next();
  } catch (error) {
    return res.status(400).json({ message: "Token invalide." });
  }
};

const hasRole = (roleName) => {
  return async (req, res, next) => {
    try {
      const utilisateur = await prisma.utilisateurs.findUnique({
        where: { id: Number(req.user.id) },
        include: {
          utilisateur_roles: {
            include: { roles: true },
          },
        },
      });

      if (!utilisateur) {
        return res.status(403).json({ message: "Utilisateur non trouve." });
      }

      const expectedRoles = Array.isArray(roleName) ? roleName : [roleName];
      const expectedRoleSet = new Set(
        expectedRoles.map((name) => normalizeName(name)).filter(Boolean)
      );
      const hasRequiredRole = utilisateur.utilisateur_roles.some((role) =>
        expectedRoleSet.has(normalizeName(role.roles.nom))
      );

      if (!hasRequiredRole) {
        return res.status(403).json({ message: "Acces refuse. Role insuffisant." });
      }

      next();
    } catch (error) {
      return res.status(500).json({ message: "Erreur serveur", error });
    }
  };
};

const hasPermission = (permissionName) => {
  return async (req, res, next) => {
    try {
      const utilisateur = await prisma.utilisateurs.findUnique({
        where: { id: Number(req.user.id) },
        include: {
          utilisateur_roles: {
            include: {
              roles: {
                include: {
                  role_permissions: {
                    include: { permissions: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!utilisateur) {
        return res.status(403).json({ message: "Utilisateur non trouve." });
      }

      const expectedPermission = normalizeName(permissionName);
      const hasRequiredPermission = utilisateur.utilisateur_roles.some((role) =>
        role.roles.role_permissions.some(
          (rp) => normalizeName(rp.permissions.nom) === expectedPermission
        )
      );

      if (!hasRequiredPermission) {
        return res.status(403).json({ message: "Acces refuse. Permission insuffisante." });
      }

      next();
    } catch (error) {
      return res.status(500).json({ message: "Erreur serveur", error });
    }
  };
};

module.exports = { verifyToken, hasRole, hasPermission, normalizeName };
