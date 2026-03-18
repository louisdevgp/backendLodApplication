/***************************************************
 * controllers/validationsController.js
 ****************************************************/
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { envoyerEmail } = require("../../config/emailConfig");

/**
 * ✅ Valider ou rejeter une demande
 *   - "statut" = "approuve" ou "rejete"
 *   - Met à jour la table validations ET le champ "statut" dans demandes_paiement
 */
const validerDemande = async (req, res) => {
  const { demande_id } = req.params;
  const { valideur_id, statut, commentaire } = req.body;

  try {
    // 1. Récupérer la demande
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: Number(demande_id) },
      include: { agents: true },
    });
    if (!demande) {
      return res.status(404).json({ message: "Demande non trouvée." });
    }

    // 2. Récupérer le validateur
    const valideur = await prisma.utilisateurs.findUnique({
      where: { id: Number(valideur_id) },
      include: { agents: true },
    });
    if (!valideur) {
      return res
        .status(403)
        .json({ message: "Validateur non autorisé." });
    }

    // 3. Vérifier le statut choisi (approuve, rejete)
    if (!["approuve", "rejete"].includes(statut)) {
      return res.status(400).json({
        message: "Statut invalide. Utilisez 'approuve' ou 'rejete'.",
      });
    }

    // 4. Vérifier si la demande est déjà finalisée
    if (["approuve", "rejete", "paye"].includes(demande.statut)) {
      return res.status(400).json({
        message: "Cette demande est déjà finalisée.",
      });
    }

    // 5. Enregistrer la validation (table validations)
    await prisma.validations.create({
      data: {
        demande_id: Number(demande_id),
        valideur_id: Number(valideur_id),
        statut,      // "approuve" ou "rejete"
        commentaire, // facultatif
      },
    });

    // 6. Déterminer le nouveau statut
    let nouveauStatut = demande.statut;
    if (statut === "rejete") {
      nouveauStatut = "rejete";
    } else {
      // statut === "approuve"
      if (demande.statut === "validation_section") {
        nouveauStatut = "validation_entite";
      } else if (demande.statut === "validation_entite") {
        nouveauStatut = "approuve";
      }
      // Si c'est déjà "approuve", on aurait bloqué plus haut.
    }

    // 7. Mettre à jour la demande
    const demandeMaj = await prisma.demandes_paiement.update({
      where: { id: Number(demande_id) },
      data: { statut: nouveauStatut },
    });

    // 8. (Optionnel) Envoyer un email en cas de rejet, ou pour prévenir le prochain validateur
    if (statut === "rejete") {
      // Notifier le demandeur
      const demandeurUser = await prisma.utilisateurs.findFirst({
        where: { agent_id: demande.agent_id },
        include: { agents: true },
      });
      if (demandeurUser) {
        const sujet = `Votre demande #${demande.id} a été rejetée`;
        const message = `
          <p>Bonjour ${demandeurUser.agents.nom},</p>
          <p>Votre demande de paiement a été rejetée par ${valideur.agents.nom}.</p>
          <p>Motif : ${demande.motif}</p>
          <p>Commentaire : ${commentaire || "Aucun"}</p>
          <p>Cordialement,</p>
          <p>L'équipe</p>`;
        await envoyerEmail(demandeurUser.email, sujet, message);
      }
    }
    // (Si tu veux aussi prévenir le prochain validateur quand on passe de validation_section à validation_entite, etc., tu peux rajouter un envoi de mail.)

    return res.status(200).json({
      message: `Demande ${statut} avec succès. Nouveau statut = ${nouveauStatut}.`,
      demande: demandeMaj,
    });
  } catch (error) {
    console.error("Erreur (validerDemande) :", error);
    return res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/**
 * ✅ Récupérer les demandes en attente de validation pour un validateur donné
 */
const getDemandesEnAttente = async (req, res) => {
  const { validateur_id } = req.params;

  try {
    // 1. Récupérer l'utilisateur validateur
    const utilisateur = await prisma.utilisateurs.findUnique({
      where: { id: Number(validateur_id) },
      include: { agents: true },
    });
    if (!utilisateur) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    let statutRequis = null;
    if (utilisateur.agents.fonction.includes("Responsable de section")) {
      statutRequis = "validation_section";
    } else if (utilisateur.agents.fonction.includes("Responsable d'entité")) {
      statutRequis = "validation_entite";
    } else {
      // cas plus complexes => tu peux adapter
      return res.json({ message: "Aucune demande en attente pour ce rôle." });
    }

    // 2. Chercher les demandes qui correspondent à ce statut
    const demandes = await prisma.demandes_paiement.findMany({
      where: {
        statut: statutRequis,
        deleted_at: null,
      },
      include: { agents: true, validations: true },
      orderBy: { date_creation: "desc" },
    });

    return res.status(200).json({ demandes });
  } catch (error) {
    console.error("Erreur (getDemandesEnAttente) :", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

/**
 * ✅ Récupérer toutes les validations effectuées par un validateur
 */
const getValidationsByValidateur = async (req, res) => {
  const { validateur_id } = req.params;

  try {
    const user = await prisma.utilisateurs.findUnique({
      where: { id: parseInt(validateur_id) },
    });
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    const results = await prisma.validations.findMany({
      where: { valideur_id: parseInt(validateur_id) },
      include: { demandes_paiement: true },
      orderBy: { date_validation: "desc" },
    });

    if (results.length === 0) {
      return res.status(404).json({
        message: "Aucune validation trouvée pour cet utilisateur.",
      });
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error("Erreur (getValidationsByValidateur) :", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

module.exports = {
  validerDemande,
  getDemandesEnAttente,
  getValidationsByValidateur,
};
