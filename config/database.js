const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const connectDB = async () => {
    try {
        await prisma.$connect();
        console.log('Connexion réussie à la base de données MySQL');
    } catch (error) {
        console.error('Erreur de connexion à la base de données:', error);
        process.exit(1);
    }
};

const disconnectDB = async () => {
    try {
        await prisma.$disconnect();
        console.log('Déconnexion de la base de données réussie.');
    } catch (error) {
        console.error('Erreur lors de la déconnexion de la base de données:', error);
    }
};

module.exports = { prisma, connectDB, disconnectDB };
