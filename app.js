// Import des modules nécessaires
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const authRoutes = require('./routes/Auth/authRoutes');
const agentsRoutes = require("./routes/Agents/agentsRoutes")
const validationsRoutes = require("./routes/Validations/validationsRoutes")
const demandeRoutes = require('./routes/Demandes/demandeRoutes');
const fonctionsRoutes = require('./routes/Fonctions/fonctionsRoutes')
const rolesPermissionsRoutes = require('./routes/RolesPermissionsRoutes/rolesPermissionsRoutes')
const rolesUSerRoutes = require('./routes/RolesUtilisateursRoutes/rolesUtilisateursRoutes')
const paiementsRoutes = require('./routes/Paiements/paiementRoutes')

// News routes
const entitesRoutes = require("./routes/Entites/entitesRoutes")
const sectionsRoutes = require("./routes/Sections/sectionsRoutes")
const rolesRoutes = require("./routes/Roles/roleRoutes")
// const multer = require('multer');


// Configuration de l'environnement
dotenv.config();

// Initialisation de l'application Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(
    
));
app.use(morgan('dev'));
app.use(helmet());

// Initialisation de Prisma
const prisma = new PrismaClient();

// Configuration de la base de données Prisma
const setupDatabase = async () => {
    try {
        await prisma.$connect();
        console.log('Connexion à la base de données réussie.');
    } catch (error) {
        console.error('Erreur de connexion à la base de données:', error);
        process.exit(1);
    }
};
setupDatabase();

// Définition des routes
app.use('/api/auth', authRoutes);
app.use('/api/demandes', demandeRoutes);// multer sera appliqué dans demandeRoutes.js
app.use('/api/agents',agentsRoutes)
app.use('/api/validations',validationsRoutes)
app.use('/api/fonctions',fonctionsRoutes)
app.use('/api/rolesPermissions',rolesPermissionsRoutes)
app.use('/api/rolesUsers',rolesUSerRoutes)
app.use('/api/paiements',paiementsRoutes)

// New routes
app.use("/api/entites",entitesRoutes)
app.use("/api/sections",sectionsRoutes)
app.use("/api/roles",rolesRoutes)

// Démarrage du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Serveur en cours d'exécution sur le port ${PORT}`);
});

// Fermeture propre de Prisma
process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});
