const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const jwt = require("jsonwebtoken");

// ✅ Middleware pour vérifier si l'utilisateur est authentifié
const verifyToken = (req, res, next) => {
    const token = req.header("Authorization");
    
    if (!token) {
        return res.status(401).json({ message: "Accès refusé. Token manquant." });
    }

    try {
        const verified = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (error) {
        res.status(400).json({ message: "Token invalide." });
    }
};

// ✅ Middleware pour vérifier si l'utilisateur a un rôle spécifique
const hasRole = (roleName) => {
    return async (req, res, next) => {
        try {
            const utilisateur = await prisma.utilisateurs.findUnique({
                where: { id: req.user.id },
                include: {
                    utilisateur_roles: {
                        include: { roles: true }
                    }
                }
            });

            if (!utilisateur) {
                return res.status(403).json({ message: "Utilisateur non trouvé." });
            }

            const hasRequiredRole = utilisateur.utilisateur_roles.some((role) => role.roles.nom === roleName);

            if (!hasRequiredRole) {
                return res.status(403).json({ message: "Accès refusé. Rôle insuffisant." });
            }

            next();
        } catch (error) {
            res.status(500).json({ message: "Erreur serveur", error });
        }
    };
};

// ✅ Middleware pour vérifier si l'utilisateur a une permission spécifique
const hasPermission = (permissionName) => {
    return async (req, res, next) => {
        try {
            const utilisateur = await prisma.utilisateurs.findUnique({
                where: { id: req.user.id },
                include: {
                    utilisateur_roles: {
                        include: {
                            roles: {
                                include: {
                                    role_permissions: {
                                        include: { permissions: true }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            if (!utilisateur) {
                return res.status(403).json({ message: "Utilisateur non trouvé." });
            }

            const hasRequiredPermission = utilisateur.utilisateur_roles.some((role) =>
                role.roles.role_permissions.some((rp) => rp.permissions.nom === permissionName)
            );

            if (!hasRequiredPermission) {
                return res.status(403).json({ message: "Accès refusé. Permission insuffisante." });
            }

            next();
        } catch (error) {
            res.status(500).json({ message: "Erreur serveur", error });
        }
    };
};

module.exports = { verifyToken, hasRole, hasPermission };
