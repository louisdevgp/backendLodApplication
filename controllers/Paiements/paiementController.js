const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const cloudinary = require("../../config/cloudinaryConfig");
const { envoyerEmail } = require("../../config/emailConfig");

const { generateDemandePaiementPDF } = require("../../utils/pdf");
const path = require("path");
const jwt = require("jsonwebtoken");
const { telechargerFichier } = require("../../config/telechargerFiles");

/**
 * ✅ Upload multiple fichiers sur Cloudinary
 */
const uploadToCloudinary = async (files) => {
  const uploadPromises = files.map((file) => {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "paiements" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result.secure_url);
        }
      );
      stream.end(file.buffer);
    });
  });
  return await Promise.all(uploadPromises);
};

/**
 * ✅ Effectuer un paiement par le DEMANDEUR lui-même
 */
// const effectuerPaiement = async (req, res) => {
//   const { demande_id } = req.params;
//   const { moyen_paiement } = req.body;
//   const word = req.headers.authorization;
//   const token = word.slice(7, -1);
//   const utilisateur = jwt.decode(token);

//   console.log(req.body)
//   console.log(req.files)

//   try {
//     const user = await prisma.utilisateurs.findUnique({
//       where: { id: parseInt(utilisateur.userId) },
//       include: { agents: true },
//     });

//     if (!user) {
//       return res.status(403).json({ message: "Utilisateur non trouvé." });
//     }

//     const demande = await prisma.demandes_paiement.findUnique({
//       where: { id: parseInt(demande_id) },
//     });

//     if (!demande) {
//       return res.status(404).json({ message: "Demande introuvable." });
//     }

//     if (demande.agent_id !== user.agent_id) {
//       return res.status(403).json({ message: "Vous ne pouvez payer que vos propres demandes." });
//     }

//     if (demande.statut !== "validation_entite_generale") {
//       return res.status(400).json({ message: "La demande n'est pas prête pour le paiement." });
//     }

//     let fichiersPreuve = [];
//     if (req.files && req.files.length > 0) {
//       fichiersPreuve = await uploadToCloudinary(req.files);
//     }

//     const paiement = await prisma.paiements.create({
//       data: {
//         demande_id: parseInt(demande_id),
//         moyen_paiement,
//         fichiers_paiement: fichiersPreuve.length > 0 ? JSON.stringify(fichiersPreuve) : null,
//       },
//     });

//     await prisma.demandes_paiement.update({
//       where: { id: parseInt(demande_id) },
//       data: { statut: "paye" },
//     });

//     // Génération automatique du PDF
//     const outputPath = path.join(__dirname, `../../public/pdfs/demande_paiement_${demande_id}.pdf`);
//     await generateDemandePaiementPDF(demande, outputPath);

//     // Email automatique au demandeur (optionnel si tu veux)
//     const agent = await prisma.agents.findUnique({
//       where: { id: demande.agent_id },
//       include: { utilisateurs: true },
//     });

//     if (agent?.utilisateurs?.email) {
//       const sujet = `💰 Confirmation de votre paiement - Demande #${demande.id}`;
//       const message = `
//         <p>Bonjour ${agent.nom},</p>
//         <p>Votre demande de paiement a été enregistrée comme payée avec succès.</p>
//         <p><strong>Moyen utilisé :</strong> ${moyen_paiement}</p>
//         <p>Cordialement,</p>
//         <p>GreenPay CI</p>`;

//       await envoyerEmail(agent.utilisateurs.email, sujet, message);
//     }

//     res.status(201).json({ message: "✅ Paiement effectué avec succès.", paiement });

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "❌ Erreur serveur.", error });
//   }
// };

const effectuerPaiement = async (req, res) => {
  const { demande_id } = req.params;
  const { moyen_paiement } = req.body;
  const word = req.headers.authorization;
  const token = word.slice(7, -1);
  const utilisateur = jwt.decode(token);

  try {
    const user = await prisma.utilisateurs.findUnique({
      where: { id: parseInt(utilisateur.userId) },
      include: { agents: true },
    });

    if (!user) {
      return res.status(403).json({ message: "Utilisateur non trouvé." });
    }

    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: parseInt(demande_id) },
    });

    if (!demande) {
      return res.status(404).json({ message: "Demande introuvable." });
    }

    if (demande.agent_id !== user.agent_id) {
      return res.status(403).json({ message: "Vous ne pouvez payer que vos propres demandes." });
    }

    if (demande.statut !== "validation_entite_generale") {
      return res.status(400).json({ message: "La demande n'est pas prête pour le paiement." });
    }

    let fichiersPreuve = [];
    if (req.files && req.files.length > 0) {
      fichiersPreuve = await uploadToCloudinary(req.files);
    }

    const paiement = await prisma.paiements.create({
      data: {
        demande_id: parseInt(demande_id),
        moyen_paiement,
        fichiers_paiement: fichiersPreuve.length > 0 ? JSON.stringify(fichiersPreuve) : null,
      },
    });

    await prisma.demandes_paiement.update({
      where: { id: parseInt(demande_id) },
      data: { statut: "paye" },
    });

    // 📄 Générer PDF de la demande
    const outputPath = path.join(__dirname, `../../public/pdfs/demande_paiement_${demande_id}.pdf`);
    await generateDemandePaiementPDF(demande, outputPath);

    // 📧 Préparer email au demandeur + responsables
    const agent = await prisma.agents.findUnique({
      where: { id: demande.agent_id },
      include: {
        utilisateurs: true,
        agents: { include: { utilisateurs: true } }, // supérieur direct
        sections: { include: { agents: { include: { utilisateurs: true } } } }, // responsable de section
        entites: { include: { agents: { include: { utilisateurs: true } } } } // responsable d'entité
      },
    });

    if (!agent || !agent.utilisateurs?.email) {
      return res.status(404).json({ message: "Demandeur ou email non trouvé." });
    }

    // 📩 Construire la liste des CC
    const ccEmails = [];
    if (agent.agents?.utilisateurs?.email) ccEmails.push(agent.agents.utilisateurs.email);
    if (agent.sections?.agents?.[0]?.utilisateurs?.email) ccEmails.push(agent.sections.agents[0].utilisateurs.email);
    if (agent.entites?.agents?.[0]?.utilisateurs?.email) ccEmails.push(agent.entites.agents[0].utilisateurs.email);

    // 📎 Préparer les pièces jointes
    const fichiersAttaches = [
      { filename: `Demande_Paiement_${demande_id}.pdf`, path: outputPath }
    ];

    if (paiement?.fichiers_paiement) {
      const preuves = JSON.parse(paiement.fichiers_paiement);
      for (let i = 0; i < preuves.length; i++) {
        const filePath = await telechargerFichier(preuves[i]);
        fichiersAttaches.push({ filename: `Preuve_Paiement_${i + 1}.jpg`, path: filePath });
      }
    }

    const proforma = await prisma.proformas.findFirst({
      where: { demande_id: parseInt(demande_id) },
    });

    if (proforma) {
      const proformaPath = await telechargerFichier(proforma.fichier);
      fichiersAttaches.push({ filename: `Proforma_${demande_id}.jpg`, path: proformaPath });
    }

    // 📝 Message
    const sujet = `💰 Paiement confirmé - Demande #${demande.id}`;
    const message = `
      <p>Bonjour ${agent.nom},</p>
      <p>Votre demande de paiement a été enregistrée comme <strong>payée</strong>.</p>
      <p><strong>Moyen utilisé :</strong> ${moyen_paiement}</p>
      <p>Veuillez trouver en pièces jointes :</p>
      <ul>
        <li>PDF de la demande</li>
        ${paiement?.fichiers_paiement ? "<li>Preuves de paiement</li>" : ""}
        ${proforma ? "<li>Proforma</li>" : ""}
      </ul>
      <p>Cordialement,<br/>GreenPay CI</p>`;

    await envoyerEmail(agent.utilisateurs.email, sujet, message, fichiersAttaches);

    res.status(201).json({ message: "✅ Paiement effectué et email envoyé avec succès.", paiement });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "❌ Erreur serveur.", error });
  }
};



/**
 * ✅ Voir un paiement spécifique
 */
const getPaiementByDemande = async (req, res) => {
  const { demande_id } = req.params;

  try {
    const paiement = await prisma.paiements.findFirst({
      where: { demande_id: parseInt(demande_id) },
    });

    if (!paiement)
      return res.status(404).json({ message: "Aucun paiement trouvé pour cette demande." });

    paiement.fichiers_paiement = paiement.fichiers_paiement
      ? JSON.parse(paiement.fichiers_paiement)
      : [];

    res.status(200).json(paiement);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

module.exports = {
  effectuerPaiement,
  getPaiementByDemande,
};
