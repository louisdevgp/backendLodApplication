const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const { envoyerEmail } = require("../../config/emailConfig");
const { saveBufferToLocalFile } = require("../../utils/localUpload");

const uploadProformaLocal = async (req, file) => {
  const saved = await saveBufferToLocalFile(req, file.buffer, file.originalname || "proforma", "proformas");
  return saved.url;
};
function determinerStatutInitial(agent) {
  let statutInitial = "validation_section";
  if (agent.fonction.includes("Responsable de section")) {
    statutInitial = "validation_entite";
  } else if (agent.fonction.includes("Responsable d'entité")) {
    statutInitial = "validation_entite_generale";
  }
  return statutInitial;
}

const creerDemandePaiement = async (req, res) => {
  const { agent_id, montant, motif, requiert_proforma, beneficiaire } = req.body;

  try {
    const agent = await prisma.agents.findUnique({
      where: { id: parseInt(agent_id) },
      include: { utilisateurs: true },
    });
    if (!agent) return res.status(404).json({ message: "Agent non trouvé." });

    const statutInitial = determinerStatutInitial(agent);

    let proformaUrl = null;
    if (requiert_proforma === "true" && req.file) {
      proformaUrl = await uploadProformaLocal(req, req.file);
    }

    const demande = await prisma.$transaction(async (tx) => {
      const created = await tx.demandes_paiement.create({
        data: {
          agent_id: parseInt(agent_id),
          montant: parseFloat(montant),
          motif,
          beneficiaire,
          statut: statutInitial,
          requiert_proforma: requiert_proforma === "true",
        },
      });

      if (proformaUrl) {
        await tx.proformas.create({
          data: { demande_id: created.id, fichier: proformaUrl },
        });
      }

      return created;
    });

    if (statutInitial === "validation_section" || statutInitial === "validation_entite") {
      const prochainValidateur = await prisma.agents.findFirst({
        where: {
          id: agent.superieur_id,
          fonction: {
            notIn: ["Responsable Entité Générale", "Responsable Entité Financière"],
          },
        },
        include: { utilisateurs: true },
      });

      if (prochainValidateur && prochainValidateur.utilisateurs?.email) {
        const validationURL = `https://app.greenpayci.com/valider/${demande.id}`;
        const sujet = `🔔 Nouvelle demande de paiement à valider`;
        const message = `
          <p>Bonjour ${prochainValidateur.nom},</p>
          <p>Une nouvelle demande de paiement est en attente de votre validation.</p>
          <p><strong>Montant :</strong> ${montant} FCFA</p>
          <p><strong>Motif :</strong> ${motif}</p>
          <p><a href="${validationURL}">✅ Accéder à la demande</a></p>
          <p>Merci,</p>
          <p>GreenPay CI</p>`;

        await envoyerEmail(prochainValidateur.utilisateurs.email, sujet, message);
      }
    }

    res.status(201).json({ message: "Demande créée avec succès.", demande });
  } catch (error) {
    console.error("Erreur création:", error);
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

const modifierDemandePaiement = async (req, res) => {
  const { demande_id } = req.params;
  const { montant, motif, requiert_proforma, beneficiaire, statut } = req.body;

  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: parseInt(demande_id) },
      include: { proformas: true, agents: { include: { utilisateurs: true } } },
    });
    if (!demande) return res.status(404).json({ message: "Demande non trouvée." });

    const statutInitialsAutorisantModifContenu = ["validation_section", "validation_entite"];

    if (!statutInitialsAutorisantModifContenu.includes(demande.statut)) {
      if (!statut || typeof statut !== "string") {
        return res.status(400).json({
          message: "Cette demande n'est plus modifiable. Seul le champ 'statut' peut être mis à jour.",
        });
      }

      const demandeUpdated = await prisma.demandes_paiement.update({
        where: { id: parseInt(demande_id) },
        data: { statut },
      });

      if (statut === "validation_entite_generale") {
        const utilisateur = demande.agents.utilisateurs;
        if (utilisateur?.email) {
          const sujet = `📄 À imprimer : demande de paiement #${demande.id}`;
          const message = `
            <p>Bonjour ${demande.agents.nom},</p>
            <p>Veuillez imprimer la demande #${demande.id} pour la validation manuelle par votre responsable d'entité générale.</p>
            <p>Merci.</p>
            <p>GreenPay CI</p>`;
          await envoyerEmail(utilisateur.email, sujet, message);
        }
      }

      return res.status(200).json({ message: "Statut mis à jour.", demande: demandeUpdated });
    }

    let proformaUrl = null;
    if (requiert_proforma === "true" && req.file) {
      proformaUrl = await uploadProformaLocal(req, req.file);
      if (demande.proformas.length > 0) {
        await prisma.proformas.deleteMany({ where: { demande_id: parseInt(demande_id) } });
      }
      await prisma.proformas.create({ data: { demande_id: parseInt(demande_id), fichier: proformaUrl } });
    }

    const demandeModifiee = await prisma.demandes_paiement.update({
      where: { id: parseInt(demande_id) },
      data: {
        montant: parseFloat(montant),
        motif,
        beneficiaire,
        requiert_proforma: requiert_proforma === "true",
        statut: statut || demande.statut,
      },
    });

    res.status(200).json({ message: "Demande modifiée avec succès.", demande: demandeModifiee });
  } catch (error) {
    console.error("Erreur modification:", error);
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/**
 * ✅ Supprimer une demande (soft delete)
 */
const supprimerDemandePaiement = async (req, res) => {
  const { demande_id } = req.params;

  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: parseInt(demande_id) },
    });

    if (!demande) {
      return res.status(404).json({ message: "Demande non trouvée." });
    }

    // soft delete => on met par ex. deleted_at
    await prisma.demandes_paiement.update({
      where: { id: parseInt(demande_id) },
      data: { deleted_at: new Date() },
    });

    res.status(200).json({
      message: "Demande supprimée avec succès (soft delete).",
    });
  } catch (error) {
    console.error("Erreur (supprimer demande) :", error);
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/**
 * ✅ Récupérer les demandes de paiement (liste) pour un utilisateur
 *    (avec éventuelle pagination)
 */
const getDemandesPaiement = async (req, res) => {
  const { page = 1, limit = 5, utilisateur_id } = req.query;
  const offset = (page - 1) * limit;

  try {
    // 1. Récupérer l'utilisateur
    const utilisateur = await prisma.utilisateurs.findUnique({
      where: { id: Number(utilisateur_id) },
      include: { agents: true },
    });

    if (!utilisateur) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    // 2. Récupérer les demandes (pour l’agent associé)
    const demandes = await prisma.demandes_paiement.findMany({
      skip: Number(offset),
      take: Number(limit),
      orderBy: { date_creation: "desc" },
      where: {
        agent_id: parseInt(utilisateur.agents.id),
        deleted_at: null, // si tu gères soft-delete
      },
      include: {
        agents: true,
        proformas: true,
        validations: true,
      },
    });

    // 3. Calculer le total pour la pagination
    const totalDemandes = await prisma.demandes_paiement.count({
      where: {
        agent_id: parseInt(utilisateur.agents.id),
        deleted_at: null,
      },
    });
    const totalPages = Math.ceil(totalDemandes / limit);

    res.json({ demandes, totalPages });
  } catch (error) {
    console.error("Erreur (getDemandesPaiement) :", error);
    res.status(500).json({ message: "Erreur serveur", error });
  }
};

/**
 * ✅ Récupérer le détail d'une demande par ID
 */
const getDemandePaiementById = async (req, res) => {
  const { demande_id } = req.params;
  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: parseInt(demande_id) },
      include: {
        agents: true,
        proformas: true,
        validations: {
          include: {
            utilisateurs: { include: { agents: true } },
          },
        },
      },
    });

    if (!demande) {
      return res.status(404).json({ message: "Demande non trouvée." });
    }
    res.status(200).json({ demande });
  } catch (error) {
    console.error("Erreur (getDemandePaiementById) :", error);
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

/********************************************************
 * PARTIE : STATS (demandesCountByUser, etc.)
 * Tu peux laisser ces fonctions ici si tu en as besoin
 ********************************************************/
const demandesCountByUser = async (req, res) => {
  try {
    const word = req.headers.authorization;
    if (!word) {
      return res.status(401).json({ error: "Token manquant" });
    }
    const token = word.split(" ")[1];
    const utilisateurs = jwt.decode(token);

    if (!utilisateurs || !utilisateurs.userId) {
      return res.status(401).json({ error: "Token invalide" });
    }

    const user = await prisma.utilisateurs.findUnique({
      where: { id: utilisateurs.userId },
      include: { agents: true },
    });
    if (!user || !user.agents) {
      return res.status(404).json({ error: "Agent non trouvé" });
    }
    const agentId = parseInt(user.agents.id);

    // Exemples d'aggregations
    const [
      nbDemandes,
      montantTotalDemandes,
    ] = await Promise.all([
      prisma.demandes_paiement.count({ where: { agent_id: agentId } }),
      prisma.demandes_paiement.aggregate({
        _sum: { montant: true },
        where: { agent_id: agentId },
      }),
    ]);

    const statsAgent = {
      nbDemandes,
      montantTotalDemandes: montantTotalDemandes._sum.montant || 0,
    };

    return res.json(statsAgent);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};

// Pareil pour demandesCountByResponsableSection, demandesCountByRef, etc.
// ... (Tu colles ou conserves ici tes fonctions de stats si besoin)

module.exports = {
  creerDemandePaiement,
  modifierDemandePaiement,
  supprimerDemandePaiement,
  getDemandesPaiement,
  getDemandePaiementById,
  demandesCountByUser,
  // demandesCountByResponsableSection,
  // demandesCountByRef,
  // demandesCountByReg,
  // demandesCountByResponsableEntite,
};

