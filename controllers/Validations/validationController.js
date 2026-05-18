// controllers/validations.controller.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient(); // Option: { log: ['query','warn','error'] }
const { envoyerEmail } = require("../../config/emailConfig");
const { extname } = require("path");
const cloudinary = require("../../config/cloudinaryConfig");

/**
 * 🔗 Lien vers la page de la demande (front)
 */
const appLienDemande = (id) => `https://achats.greenpayci.com/demandes/${id}`;
const achatDemandeRef = (id) => `ACHAT - DEMANDE #${id}`;
const achatMailSubject = (id, action = "") =>
  action ? `${achatDemandeRef(id)} - ${action}` : achatDemandeRef(id);
const achatMailTitleHtml = (id) =>
  `<p style="margin:0 0 12px;font-weight:700;text-transform:uppercase;">${achatDemandeRef(id)}</p>`;

/**
 * 🔎 Infère un attachment nodemailer correct depuis une URL
 * - respecte l'extension réelle (png, jpg, pdf, docx, etc.)
 * - ajoute contentType quand connu
 */
function inferAttachmentFromUrl(url, base = "fichier") {
  let ext = "";
  try {
    const u = new URL(url);
    ext = extname(u.pathname).toLowerCase();
  } catch {
    // URL invalide : on laisse ext vide
  }
  const filename = ext ? `${base}${ext}` : base;

  const mimeMap = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".7z": "application/x-7z-compressed",
  };

  const contentType = mimeMap[ext] || undefined;
  return { filename, path: url, ...(contentType ? { contentType } : {}) };
}

/**
 * ✅ Déterminer le prochain statut (compat rétro)
 * (Garde la logique existante, mais l'envoi email utilise désormais le mode multi‑validateurs)
 */
const determinerProchainValidateur = async (demande) => {
  let prochainStatut = demande.statut;
  let prochainValidateur = null;

  switch (demande.statut) {
    case "validation_section": {
      prochainStatut = "validation_entite";
      prochainValidateur = await prisma.agents.findFirst({
        where: {
          entite_id: demande.agents.entite_id,
          fonction: { contains: "Responsable Entité" },
        },
      });
      break;
    }

    case "validation_entite": {
      // Étape suivante = REG (physique) => validation_entite_generale
      // Pas d’e-mail pour REG/REF
      prochainStatut = "validation_entite_generale";
      prochainValidateur = null;
      break;
    }

    default:
      return { prochainStatut: null, prochainValidateur: null };
  }

  return { prochainStatut, prochainValidateur };
};

/**
 * 🧭 Trouve TOUS les validateurs pour l’étape courante (afin de notifier la prochaine étape)
 * - si la demande est à "validation_section" et qu’on l’approuve → on notifie les "Responsable Entité"
 * - si la demande est à "validation_entite" et qu’on l’approuve → on passe à REG (papier) → pas d’email aux validateurs
 */
async function findNextValidatorsUsers(demandeFull) {
  console.log("LA VARIABLE "+JSON.stringify(demandeFull))
  const { statut } = demandeFull;
  const ag = demandeFull.agents;
  if (!ag) return [];

  if (statut === "validation_entite") {
    const agentsCandidats = await prisma.agents.findMany({
      where: {
        entite_id: ag.entite_id,
        fonction: { contains: "Responsable d'entité" },
      },
    });
    if (!agentsCandidats.length) return [];
    const ids = agentsCandidats.map((a) => a.id);

    const users = await prisma.utilisateurs.findMany({
      where: { agent_id: { in: ids } },
      include: { agents: true },
    });

    // Filtre e-mails valides + dédoublonnage
    const uniq = new Map();
    for (const u of users) {
      const em = (u.email || "").trim().toLowerCase();
      if (em) uniq.set(em, u);
    }
    return Array.from(uniq.values());
  }

  // Pour validation_entite → prochain = REG (papier), pas d'envoi aux validateurs
  return [];
}

/**
 * ✉️ Notifie tous les validateurs de l’étape suivante (1 mail par personne)
 * - joint toutes les proformas (si présentes)
 */
/** ✉️ Envoie un mail à tous les validateurs de l’étape suivante */
async function notifyAllNextValidators(demandeId, options = {}) {
  const { commentaire = "" } = options;

  const demandeFull = await prisma.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    include: { agents: true, proformas: true },
  });
  if (!demandeFull) {
    console.warn("[MAIL] Demande introuvable pour notif:", demandeId);
    return;
  }

  console.log("[MAIL] Recherche validateurs pour demande", demandeId);
  const nextValidators = await findNextValidatorsUsers(demandeFull);

  if (!nextValidators.length) {
    console.warn("[MAIL] Aucun validateur trouvé pour demande", demandeId);
    return;
  }

  console.log("[MAIL] Liste des validateurs trouvés:");
  nextValidators.forEach((v, idx) => {
    console.log(`   👉 Validateur ${idx + 1}: ${v.email} (agent_id=${v.agent_id})`);
  });

  // ⚠️ Désactive PJ si besoin de test
  const DISABLE_ATTACHMENTS_FOR_TEST = false;
  const attachments = DISABLE_ATTACHMENTS_FOR_TEST
    ? []
    : (demandeFull.proformas || []).map((p, i) => {
        try { return inferAttachmentFromUrl(p.fichier, `proforma_${i + 1}`); }
        catch { return null; }
      }).filter(Boolean);

  console.log("[MAIL] Nombre de pièces jointes:", attachments.length);

  const lien = appLienDemande(demandeFull.id);
  const sujet = achatMailSubject(demandeFull.id, "VALIDATION REQUISE");
  const message = `
    <p>Bonjour,</p>
    ${achatMailTitleHtml(demandeFull.id)}
    <p>La demande #${demandeFull.id} est en attente de votre validation.</p>
    <p><strong>Montant :</strong> ${demandeFull.montant} FCFA</p>
    <p><strong>Motif :</strong> ${demandeFull.motif}</p>
    ${commentaire ? `<p><strong>Commentaire :</strong> ${commentaire}</p>` : ""}
    <p><a href="${lien}">✅ Ouvrir la demande</a></p>
  `;

  for (const u of nextValidators) {
    console.log("📧 [MAIL] Préparation envoi à:", u.email);
    try {
      const info = await envoyerEmail(u.email, sujet, message, attachments);
      console.log("✅ [MAIL] Envoyé à:", u.email, "messageId:", info?.messageId, "response:", info?.response);
    } catch (e) {
      console.error("❌ [MAIL] Échec envoi à:", u.email, e);
    }
  }
}


/**
 * 🔒 Vérifie que le valideur peut valider la demande au statut courant
 * - Responsable de section → valide "validation_section" dans sa section
 * - Responsable d'entité → valide "validation_entite" dans son entité
 */
async function verifierDroitDeValider(demande, valideurUser) {
  const f = (valideurUser.agents?.fonction || "").toLowerCase();
  const estRespSection = f.includes("responsable de section");
  const estRespEntite = f.includes("responsable entité") || f.includes("responsable d'entité");

  if (demande.statut === "validation_section") {
    if (!estRespSection) return false;
    return (
      demande.agents?.section_id &&
      demande.agents.section_id === valideurUser.agents?.section_id
    );
  }

  if (demande.statut === "validation_entite") {
    if (!estRespEntite) return false;
    return (
      demande.agents?.entite_id &&
      demande.agents.entite_id === valideurUser.agents?.entite_id
    );
  }

  // autres statuts : non autorisé via ce contrôleur
  return false;
}

async function verifierDroitDeRejeter(demande, valideurUser) {
  const f = (valideurUser.agents?.fonction || "").toLowerCase();
  const statut = String(demande.statut || "").toLowerCase();

  const isRespSection = f.includes("responsable de section");
  const isRespEntite =
    f.includes("responsable entité") || f.includes("responsable d'entité");
  const isReg =
    f.includes("responsable entité générale") || f.includes("reg");
  const isRef =
    f.includes("responsable entité financière") ||
    f.includes("ref") ||
    f.includes("directeur administratif et financier");

  if (statut === "validation_section") {
    return (
      isRespSection &&
      demande.agents?.section_id === valideurUser.agents?.section_id
    );
  }

  if (statut === "validation_entite") {
    return (
      isRespEntite &&
      demande.agents?.entite_id === valideurUser.agents?.entite_id
    );
  }

  if (statut === "validation_entite_generale") return !!isReg;

  if (statut === "validation_entite_finance" || statut === "en_attente_paiement") {
    return !!isRef;
  }

  // Tolérance : pour les autres statuts non terminaux, REF/REG peuvent rejeter
  if (statut !== "rejete") return !!(isRef || isReg);

  return false;
}

const uploadRejectFileToCloudinary = (fileBuffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "rejets", resource_type: "auto" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });

/**
 * ✅ Valider une demande de paiement et notifier les prochains validateurs (multi)
 *    + informer le demandeur quand on arrive à l'étape REG (papier)
 */
const validerDemande = async (req, res) => {
  const { demande_id } = req.params;
  let { valideur_id, statut, commentaire } = req.body;

  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: Number(demande_id) },
      include: {
        agents: { include: { utilisateurs: true } },
        proformas: true, // pour joindre les fichiers si rejet
      },
    });

    if (!demande)
      return res.status(404).json({ message: "Demande non trouvée." });

    const valideur = await prisma.utilisateurs.findUnique({
      where: { id: Number(valideur_id) },
      include: { agents: true },
    });

    if (!valideur)
      return res.status(403).json({ message: "Validateur non autorisé." });

    if (!["approuve", "rejete"].includes(String(statut))) {
      return res
        .status(400)
        .json({ message: "Statut invalide. Utilisez 'approuve' ou 'rejete'." });
    }

    if (String(demande.statut || "").toLowerCase() === "rejete") {
      return res.status(409).json({ message: "Cette demande est déjà rejetée." });
    }

    // 🔒 Autorisation forte (rejets autorisés sur tous statuts selon rôle)
    const autorise =
      String(statut) === "rejete"
        ? await verifierDroitDeRejeter(demande, valideur)
        : await verifierDroitDeValider(demande, valideur);
    if (!autorise) {
      return res
        .status(403)
        .json({
          message:
            "Vous n'êtes pas autorisé à valider cette demande à ce stade.",
        });
    }

    // ⛔ Empêcher double approbation immédiate par la même personne
    if (statut === "approuve") {
      const dejaValideeParUser = await prisma.validations.findFirst({
        where: {
          demande_id: Number(demande_id),
          valideur_id: Number(valideur_id),
          statut: "approuve",
        },
      });
      if (dejaValideeParUser) {
        return res
          .status(409)
          .json({ message: "Vous avez déjà approuvé cette demande." });
      }
    }

    // Détermination du prochain statut (compat)
    let { prochainStatut } = await determinerProchainValidateur(demande);
    if (statut === "rejete") {
      prochainStatut = "rejete";
    }

    // Rejet: commentaire obligatoire + pièces jointes optionnelles
    const rejectFiles = Array.isArray(req.files) ? req.files : [];
    let rejectFileUrls = [];

    if (statut === "rejete") {
      if (!String(commentaire || "").trim()) {
        return res.status(400).json({ message: "Le motif de rejet est obligatoire." });
      }
      if (
        String(demande.statut || "").toLowerCase() === "en_attente_paiement" &&
        rejectFiles.length === 0
      ) {
        return res.status(400).json({
          message:
            "Au moins une pièce justificative est obligatoire pour rejeter une demande en attente de paiement.",
        });
      }
      for (const f of rejectFiles) {
        if (!f?.buffer) continue;
        const url = await uploadRejectFileToCloudinary(f.buffer);
        rejectFileUrls.push(url);
      }
      if (rejectFileUrls.length > 0) {
        const urlsText = rejectFileUrls.map((u) => `- ${u}`).join("\n");
        commentaire = `${commentaire}\n\nPièces jointes rejet:\n${urlsText}`;
      }
    }

    // ⚙️ Transaction rapide en forme array (sans include) + timeouts augmentés
    await prisma.$transaction(
      [
        prisma.validations.create({
          data: {
            demande_id: Number(demande_id),
            valideur_id: Number(valideur_id),
            statut,
            commentaire,
          },
        }),
        prisma.demandes_paiement.update({
          where: { id: Number(demande_id) },
          data: { statut: prochainStatut },
        }),
      ],
      { timeout: 20000, maxWait: 10000 }
    );

    // 🔁 Re-fetch HORS transaction avec les includes (plus lourd, safe)
    const demandeMaj = await prisma.demandes_paiement.findUnique({
      where: { id: Number(demande_id) },
      include: { agents: { include: { utilisateurs: true } } },
    });

    // -----------------------------------------
    // 📧 NOTIFICATIONS E-MAILS (hors transaction)
    // -----------------------------------------
    const lien = appLienDemande(demande.id);

    // a) Si approuvé → notifier TOUS les validateurs de la prochaine étape applicative
    if (statut === "approuve") {
      try {
        await notifyAllNextValidators(demande.id, { commentaire });
      } catch (e) {
        console.warn("Notif multi-validateurs (non bloquant):", e?.message || e);
      }
    }

    // b) Si approuvé ET qu'on passe à REG (papier) → mail au demandeur
    if (statut === "approuve" && prochainStatut === "validation_entite_generale") {
      const emailDemandeur = demandeMaj?.agents?.utilisateurs?.email;
      if (emailDemandeur) {
        const sujetReg = achatMailSubject(demande.id, "ETAPE PAPIER REG");
        const messageReg = `
          <p>Bonjour ${demandeMaj.agents?.nom || "Demandeur"},</p>
          ${achatMailTitleHtml(demande.id)}
          <p>Votre demande a atteint l'étape <strong>validation_entite_generale</strong>.</p>
          <p>Veuillez <strong>imprimer la fiche</strong> et la faire signer par le <strong>Responsable d'entité générale (REG)</strong>.</p>
          <p>Après signature, importez le document signé dans l'application afin de passer la demande à <strong>en_attente_paiement</strong>.</p>
          <p><a href="${lien}">📝 Ouvrir la demande</a></p>
          <p>Merci,</p>
          <p>GreenPay CI</p>`;
        try {
          await envoyerEmail(emailDemandeur, sujetReg, messageReg);
        } catch (e) {
          console.warn("Email REG au demandeur (non bloquant):", emailDemandeur, e?.message || e);
        }
      }
    }

    // c) Si rejet → mail au demandeur (avec proformas en PJ pour contexte)
    if (statut === "rejete" && demande.agents?.utilisateurs?.email) {
      const sujetRejet = achatMailSubject(demande.id, "REJETEE");
      const messageRejet = `
        <p>Bonjour ${demande.agents?.nom || "Demandeur"},</p>
        ${achatMailTitleHtml(demande.id)}
        <p>Votre demande de paiement a été <strong>rejetée</strong> par <strong>${valideur.agents?.nom || "le validateur"}</strong>.</p>
        <p><strong>Montant :</strong> ${demande.montant} FCFA</p>
        <p><strong>Motif :</strong> ${demande.motif}</p>
        <p><strong>Commentaire :</strong> ${commentaire || "—"}</p>
        <p><a href="${lien}">🔎 Voir la demande</a></p>
        <p>Merci,</p>
        <p>GreenPay CI</p>`;

      const attachments = (demande.proformas || [])
        .map((p, i) => {
          try {
            return inferAttachmentFromUrl(p.fichier, `proforma_${i + 1}`);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      for (let i = 0; i < rejectFileUrls.length; i++) {
        try {
          attachments.push(inferAttachmentFromUrl(rejectFileUrls[i], `rejet_${i + 1}`));
        } catch {}
      }

      try {
        await envoyerEmail(
          demande.agents.utilisateurs.email,
          sujetRejet,
          messageRejet,
          attachments
        );
      } catch (e) {
        console.warn(
          "Email rejet au demandeur (non bloquant):",
          demande.agents.utilisateurs.email,
          e?.message || e
        );
      }
    }

    return res.status(200).json({
      message: `Demande ${statut} avec succès.`,
      prochainStatut,
      reject_attachments: rejectFileUrls,
    });
  } catch (error) {
    console.error("❌ ERREUR validerDemande:", error);
    res
      .status(500)
      .json({ message: "Erreur serveur.", error: error.message || String(error) });
  }
};

/**
 * ✅ Récupérer les demandes en attente de validation pour un validateur donné
 */
const getDemandesEnAttente = async (req, res) => {
  const { validateur_id } = req.params;

  try {
    const utilisateur = await prisma.utilisateurs.findUnique({
      where: { id: Number(validateur_id) },
      include: { agents: true },
    });

    if (!utilisateur) return res.status(404).json({ message: "Utilisateur non trouvé." });

    const fonction = utilisateur.agents?.fonction || "";
    let statutRequis = null;

    if (fonction.includes("Responsable de section")) statutRequis = "validation_section";
    else if (fonction.includes("Responsable d'entité") || fonction.includes("Responsable Entité"))
      statutRequis = "validation_entite";
    else return res.status(403).json({ message: "Non autorisé." });

    const demandes = await prisma.demandes_paiement.findMany({
      where: {
        statut: statutRequis,
        agents: {
          OR: [
            { entite_id: utilisateur.agents.entite_id },
            { section_id: utilisateur.agents.section_id },
          ],
        },
      },
      include: { agents: true, validations: true },
      orderBy: { date_creation: "desc" },
    });

    return res.status(200).json({ demandes });
  } catch (error) {
    console.error("❌ Erreur getDemandesEnAttente:", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

/**
 * ✅ Liste des validations faites par un validateur
 */
const getValidationsByValidateur = async (req, res) => {
  const { validateur_id } = req.params;

  try {
    const user = await prisma.utilisateurs.findUnique({
      where: { id: Number(validateur_id) },
    });
    if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });

    const results = await prisma.validations.findMany({
      where: { valideur_id: Number(user.id) },
      include: { demandes_paiement: true },
      orderBy: { date_validation: "desc" },
    });

    if (results.length) return res.status(200).json(results);
    else return res.status(404).json({ message: "Aucune validation trouvée." });
  } catch (err) {
    console.error("❌ Erreur getValidationsByValidateur:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

const exporterValidationsExcel = async (req, res) => {
  const { type = "done", validateur_id, statut, date_debut, date_fin } = req.query;

  try {
    const toDate = (d, endOfDay = false) => {
      if (!d) return null;
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return null;
      if (endOfDay) dt.setHours(23, 59, 59, 999);
      else dt.setHours(0, 0, 0, 0);
      return dt;
    };

    const start = toDate(date_debut, false);
    const end = toDate(date_fin, true);

    const escapeCsv = (value) => {
      const str = value == null ? "" : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    let headers = [];
    let rows = [];

    if (type === "pending") {
      const id = Number(validateur_id);
      if (!id) {
        return res.status(400).json({ message: "validateur_id est requis pour type=pending." });
      }

      const utilisateur = await prisma.utilisateurs.findUnique({
        where: { id },
        include: { agents: true },
      });
      if (!utilisateur) {
        return res.status(404).json({ message: "Utilisateur non trouvé." });
      }

      const fonction = utilisateur.agents?.fonction || "";
      let statutRequis = null;

      if (fonction.includes("Responsable de section")) statutRequis = "validation_section";
      else if (fonction.includes("Responsable d'entité") || fonction.includes("Responsable Entité")) {
        statutRequis = "validation_entite";
      } else {
        return res.status(403).json({ message: "Non autorisé." });
      }

      const where = {
        statut: statut || statutRequis,
        agents: {
          OR: [
            { entite_id: utilisateur.agents.entite_id },
            { section_id: utilisateur.agents.section_id },
          ],
        },
      };

      if (start || end) {
        where.date_creation = {};
        if (start) where.date_creation.gte = start;
        if (end) where.date_creation.lte = end;
      }

      const demandes = await prisma.demandes_paiement.findMany({
        where,
        include: { agents: { include: { entites: true, sections: true } } },
        orderBy: { date_creation: "desc" },
      });

      headers = [
        "ID Demande",
        "Date creation",
        "Demandeur",
        "Fonction",
        "Entite",
        "Section",
        "Beneficiaire",
        "Montant",
        "Motif",
        "Statut",
      ];

      rows = demandes.map((d) =>
        [
          d.id,
          d.date_creation ? new Date(d.date_creation).toISOString().replace("T", " ").slice(0, 19) : "",
          d.agents?.nom || "",
          d.agents?.fonction || "",
          d.agents?.entites?.nom || "",
          d.agents?.sections?.nom || "",
          d.beneficiaire || "",
          Number(d.montant || 0),
          d.motif || "",
          d.statut || "",
        ].map(escapeCsv).join(";")
      );
    } else {
      const id = Number(validateur_id);
      if (!id) {
        return res.status(400).json({ message: "validateur_id est requis pour type=done." });
      }

      const where = { valideur_id: id };
      if (statut) where.statut = statut;
      if (start || end) {
        where.date_validation = {};
        if (start) where.date_validation.gte = start;
        if (end) where.date_validation.lte = end;
      }

      const validations = await prisma.validations.findMany({
        where,
        include: {
          utilisateurs: { include: { agents: true } },
          demandes_paiement: { include: { agents: true } },
        },
        orderBy: { date_validation: "desc" },
      });

      headers = [
        "ID Validation",
        "Date validation",
        "Statut validation",
        "Commentaire",
        "Valideur",
        "ID Demande",
        "Demandeur",
        "Beneficiaire",
        "Montant",
        "Motif",
      ];

      rows = validations.map((v) =>
        [
          v.id,
          v.date_validation ? new Date(v.date_validation).toISOString().replace("T", " ").slice(0, 19) : "",
          v.statut || "",
          v.commentaire || "",
          v.utilisateurs?.agents?.nom || "",
          v.demandes_paiement?.id || "",
          v.demandes_paiement?.agents?.nom || "",
          v.demandes_paiement?.beneficiaire || "",
          Number(v.demandes_paiement?.montant || 0),
          v.demandes_paiement?.motif || "",
        ].map(escapeCsv).join(";")
      );
    }

    const csv = [headers.map(escapeCsv).join(";"), ...rows].join("\n");
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(
      2,
      "0"
    )}${String(now.getSeconds()).padStart(2, "0")}`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"validations_${type}_${stamp}.csv\"`);
    return res.status(200).send("\uFEFF" + csv);
  } catch (error) {
    console.error("❌ Erreur export validations:", error);
    return res.status(500).json({ message: "Erreur serveur lors de l'export des validations." });
  }
};

module.exports = {
  validerDemande,
  getDemandesEnAttente,
  getValidationsByValidateur,
  exporterValidationsExcel,
  // Exports utiles (tests/unitaires)
  determinerProchainValidateur,
  notifyAllNextValidators,
  findNextValidatorsUsers,
  verifierDroitDeValider,
  verifierDroitDeRejeter,
  inferAttachmentFromUrl,
};

