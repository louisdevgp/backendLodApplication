// controllers/validations.controller.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient(); // Option: { log: ['query','warn','error'] }
const { envoyerEmail } = require("../../config/emailConfig");
const { extname } = require("path");
const { saveBufferToLocalFile } = require("../../utils/localUpload");
const {
  formatDemandeMailSubject,
  formatDemandeMailTitleHtml,
  formatDemandeInAppMessage,
} = require("../../utils/demandeMailFormat");
const {
  createNotificationForUser,
  createNotificationsForUsers,
} = require("../../utils/inAppNotifications");

/**
 * ðŸ”— Lien vers la page de la demande (front)
 */
const appLienDemande = (id) => `https://achats.greenpayci.com/demandes/${id}`;

const STATUS_LABELS = {
  validation_section: "validation section",
  validation_entite: "validation entité",
  validation_entite_finance: "validation entité finance",
  validation_entite_generale: "validation entité générale",
  approuve: "approuvé",
  paye: "payé",
  achat_effectue: "achat effectué",
  cloture: "clôturé",
  rejete: "rejeté",
  en_attente_paiement: "en attente de paiement",
};

const formatStatutLabel = (statut) => {
  const key = String(statut || "").trim().toLowerCase();
  return STATUS_LABELS[key] || key.replace(/_/g, " ");
};

const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
};

const uniquePositiveIds = (values = []) =>
  Array.from(
    new Set(
      (values || [])
        .map((value) => toPositiveInt(value))
        .filter((value) => value != null)
    )
  );

const notifyInAppUsers = async ({
  utilisateurIds = [],
  demandeId,
  action,
  detail = "",
}) => {
  const ids = uniquePositiveIds(utilisateurIds);
  const id = toPositiveInt(demandeId);
  if (!ids.length || !id) return;

  await createNotificationsForUsers({
    utilisateurIds: ids,
    demandeId: id,
    message: formatDemandeInAppMessage(id, action, detail),
  });
};

const normalizeRoleText = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getRoleFlags = (fonction = "") => {
  const f = normalizeRoleText(fonction);

  const isRespSection = f.includes("responsable de section");
  const isReg =
    f.includes("responsable entite generale") || /(^|\s)reg($|\s)/.test(f);
  const isRef =
    f.includes("responsable entite financiere") ||
    f.includes("directeur administratif et financier") ||
    /(^|\s)ref($|\s)/.test(f);
  const isDg = f.includes("directeur general");
  const isDirecteurLike =
    (f.includes("directeur") || f.includes("directrice")) && !isRef && !isDg;
  const isRespEntite =
    (f.includes("responsable d entite") || f.includes("responsable entite")) &&
    !isReg &&
    !isRef;

  return {
    isRespSection,
    isRespEntite: isRespEntite || isDirecteurLike,
    isDirecteurLike,
    isReg,
    isRef,
    isDg,
  };
};

const getPendingValidationScope = (utilisateur) => {
  const agent = utilisateur?.agents;
  if (!agent) return null;

  const { isRespSection, isRespEntite, isDg } = getRoleFlags(agent.fonction || "");

  if (isRespSection && agent.section_id != null) {
    return {
      statutRequis: "validation_section",
      agentsWhere: { section_id: Number(agent.section_id) },
    };
  }

  if (isDg && agent.id != null) {
    return {
      statutRequis: "validation_entite",
      agentsWhere: { superieur_id: Number(agent.id) },
    };
  }

  if (isRespEntite && agent.entite_id != null) {
    return {
      statutRequis: "validation_entite",
      agentsWhere: { entite_id: Number(agent.entite_id) },
    };
  }

  return null;
};

/**
 * ðŸ”Ž InfÃ¨re un attachment nodemailer correct depuis une URL
 * - respecte l'extension rÃ©elle (png, jpg, pdf, docx, etc.)
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
 * âœ… DÃ©terminer le prochain statut (compat rÃ©tro)
 * (Garde la logique existante, mais l'envoi email utilise dÃ©sormais le mode multiâ€‘validateurs)
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
      // Ã‰tape suivante = REG (physique) => validation_entite_generale
      // Pas dâ€™e-mail pour REG/REF
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
 * ðŸ§­ Trouve TOUS les validateurs pour lâ€™Ã©tape courante (afin de notifier la prochaine Ã©tape)
 * - si la demande est Ã  "validation_section" et quâ€™on lâ€™approuve â†’ on notifie les "Responsable EntitÃ©"
 * - si la demande est Ã  "validation_entite" et quâ€™on lâ€™approuve â†’ on passe Ã  REG (papier) â†’ pas dâ€™email aux validateurs
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

    // Filtre e-mails valides + dÃ©doublonnage
    const uniq = new Map();
    for (const u of users) {
      const em = (u.email || "").trim().toLowerCase();
      if (em) uniq.set(em, u);
    }
    return Array.from(uniq.values());
  }

  // Pour validation_entite â†’ prochain = REG (papier), pas d'envoi aux validateurs
  return [];
}

/**
 * âœ‰ï¸ Notifie tous les validateurs de lâ€™Ã©tape suivante (1 mail par personne)
 * - joint toutes les proformas (si prÃ©sentes)
 */
/** âœ‰ï¸ Envoie un mail Ã  tous les validateurs de lâ€™Ã©tape suivante */
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
    console.warn("[MAIL] Aucun validateur trouvÃ© pour demande", demandeId);
    return;
  }

  try {
    await notifyInAppUsers({
      utilisateurIds: nextValidators.map((u) => u.id),
      demandeId: demandeFull.id,
      action: "VALIDATION REQUISE",
      detail: "Demande en attente de votre validation.",
    });
  } catch (notifyError) {
    console.warn("[NOTIF] Echec notif in-app validateurs:", notifyError?.message || notifyError);
  }

  console.log("[MAIL] Liste des validateurs trouvÃ©s:");
  nextValidators.forEach((v, idx) => {
    console.log(`   ðŸ‘‰ Validateur ${idx + 1}: ${v.email} (agent_id=${v.agent_id})`);
  });

  // âš ï¸ DÃ©sactive PJ si besoin de test
  const DISABLE_ATTACHMENTS_FOR_TEST = false;
  const attachments = DISABLE_ATTACHMENTS_FOR_TEST
    ? []
    : (demandeFull.proformas || []).map((p, i) => {
        try { return inferAttachmentFromUrl(p.fichier, `proforma_${i + 1}`); }
        catch { return null; }
      }).filter(Boolean);

  console.log("[MAIL] Nombre de pieces jointes:", attachments.length);

  const lien = appLienDemande(demandeFull.id);
  const sujet = formatDemandeMailSubject(demandeFull.id, "VALIDATION REQUISE");
  const mailTitle = formatDemandeMailTitleHtml(demandeFull.id);
  const message = `
    <p>Bonjour,</p>
    ${mailTitle}
    <p>La demande #${demandeFull.id} est en attente de votre validation.</p>
    <p><strong>Montant :</strong> ${demandeFull.montant} FCFA</p>
    <p><strong>Motif :</strong> ${demandeFull.motif}</p>
    ${commentaire ? `<p><strong>Commentaire :</strong> ${commentaire}</p>` : ""}
    <p><a href="${lien}">âœ… Ouvrir la demande</a></p>
  `;

  for (const u of nextValidators) {
    console.log("ðŸ“§ [MAIL] PrÃ©paration envoi Ã :", u.email);
    try {
      const info = await envoyerEmail(u.email, sujet, message, attachments);
      console.log("âœ… [MAIL] EnvoyÃ© Ã :", u.email, "messageId:", info?.messageId, "response:", info?.response);
    } catch (e) {
      console.error("âŒ [MAIL] Ã‰chec envoi Ã :", u.email, e);
    }
  }
}


/**
 * ðŸ”’ VÃ©rifie que le valideur peut valider la demande au statut courant
 * - Responsable de section â†’ valide "validation_section" dans sa section
 * - Responsable d'entitÃ© â†’ valide "validation_entite" dans son entitÃ©
 */
async function verifierDroitDeValider(demande, valideurUser) {
  const { isRespSection, isRespEntite, isDg } = getRoleFlags(
    valideurUser.agents?.fonction || ""
  );

  if (demande.statut === "validation_section") {
    if (!isRespSection) return false;
    return (
      demande.agents?.section_id &&
      demande.agents.section_id === valideurUser.agents?.section_id
    );
  }

  if (demande.statut === "validation_entite") {
    const isDirectSuperior =
      Number(demande.agents?.superieur_id || 0) === Number(valideurUser.agents?.id || 0);
    if (isDirectSuperior) return true;

    if (!isRespEntite && !isDg) return false;

    if (isDg) {
      if (
        demande.agents?.entite_id != null &&
        valideurUser.agents?.entite_id != null
      ) {
        return demande.agents.entite_id === valideurUser.agents.entite_id;
      }
      return true;
    }

    return (
      demande.agents?.entite_id &&
      demande.agents.entite_id === valideurUser.agents?.entite_id
    );
  }

  // autres statuts : non autorise via ce controleur
  return false;
}
async function verifierDroitDeRejeter(demande, valideurUser) {
  const { isRespSection, isRespEntite, isReg, isRef, isDg } = getRoleFlags(
    valideurUser.agents?.fonction || ""
  );
  const statut = String(demande.statut || "").toLowerCase();

  if (statut === "validation_section") {
    return (
      isRespSection &&
      demande.agents?.section_id === valideurUser.agents?.section_id
    );
  }

  if (statut === "validation_entite") {
    const isDirectSuperior =
      Number(demande.agents?.superieur_id || 0) === Number(valideurUser.agents?.id || 0);
    if (isDirectSuperior) return true;

    if (isDg) {
      if (
        demande.agents?.entite_id != null &&
        valideurUser.agents?.entite_id != null
      ) {
        return demande.agents.entite_id === valideurUser.agents.entite_id;
      }
      return true;
    }

    return (
      isRespEntite &&
      demande.agents?.entite_id === valideurUser.agents?.entite_id
    );
  }

  if (statut === "validation_entite_generale") return !!isReg;

  if (statut === "validation_entite_finance" || statut === "en_attente_paiement") {
    return !!isRef;
  }

  // Tolerance : pour les autres statuts non terminaux, REF/REG peuvent rejeter
  if (statut !== "rejete") return !!(isRef || isReg);

  return false;
}
const uploadRejectFileLocal = async (req, file) => {
  const saved = await saveBufferToLocalFile(req, file.buffer, file.originalname || "justificatif_rejet", "rejets");
  return saved.url;
};

/**
 * âœ… Valider une demande de paiement et notifier les prochains validateurs (multi)
 *    + informer le demandeur quand on arrive Ã  l'Ã©tape REG (papier)
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

    // ðŸ”’ Autorisation forte (rejets autorisÃ©s sur tous statuts selon rÃ´le)
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

    const commentaireNormalise = String(commentaire || "").trim();
    const valideurFlags = getRoleFlags(valideur.agents?.fonction || "");
    const shouldSetDirectorCommentOnPdf =
      String(statut) === "approuve" &&
      String(demande.statut || "").toLowerCase() === "validation_entite" &&
      valideurFlags.isRespEntite &&
      commentaireNormalise.length > 0;

    // â›” EmpÃªcher double approbation immÃ©diate par la mÃªme personne
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

    // DÃ©termination du prochain statut (compat)
    let { prochainStatut } = await determinerProchainValidateur(demande);
    if (statut === "rejete") {
      prochainStatut = "rejete";
    }

    // Rejet: commentaire obligatoire + piÃ¨ces jointes optionnelles
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
        const url = await uploadRejectFileLocal(req, f);
        rejectFileUrls.push(url);
      }
      if (rejectFileUrls.length > 0) {
        const urlsText = rejectFileUrls.map((u) => `- ${u}`).join("\n");
        commentaire = `${commentaire}\n\nPièces jointes rejet:\n${urlsText}`;
      }
    }

    // âš™ï¸ Transaction rapide en forme array (sans include) + timeouts augmentÃ©s
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

    // ðŸ” Re-fetch HORS transaction avec les includes (plus lourd, safe)
    let demandeMaj = await prisma.demandes_paiement.findUnique({
      where: { id: Number(demande_id) },
      include: { agents: { include: { utilisateurs: true } } },
    });

    if (shouldSetDirectorCommentOnPdf && demandeMaj) {
      const existingNote = String(demandeMaj.note || demande.note || "").trim();
      const mergedNote = existingNote
        ? existingNote.includes(commentaireNormalise)
          ? existingNote
          : `${existingNote}\n${commentaireNormalise}`
        : commentaireNormalise;

      try {
        demandeMaj = await prisma.demandes_paiement.update({
          where: { id: Number(demande_id) },
          data: { note: mergedNote },
          include: { agents: { include: { utilisateurs: true } } },
        });
      } catch (noteError) {
        const msg = String(noteError?.message || "");
        const isMissingNoteColumn =
          noteError?.code === "P2022" && msg.toLowerCase().includes("note");
        const isUnknownNoteArg =
          msg.toLowerCase().includes("unknown argument") &&
          msg.toLowerCase().includes("note");

        if (isMissingNoteColumn || isUnknownNoteArg) {
          console.warn(
            "[WARN] Champ 'note' indisponible, commentaire directeur non copie vers la fiche PDF."
          );
        } else {
          console.warn(
            "Copie commentaire directeur vers note echouee (non bloquant):",
            noteError?.message || noteError
          );
        }
      }
    }

    const demandeurUserId = toPositiveInt(demandeMaj?.agents?.utilisateurs?.id);

    // -----------------------------------------
    // ðŸ“§ NOTIFICATIONS E-MAILS (hors transaction)
    // -----------------------------------------
    const lien = appLienDemande(demande.id);

    // a) Si approuvÃ© â†’ notifier TOUS les validateurs de la prochaine Ã©tape applicative
    if (statut === "approuve") {
      try {
        await notifyAllNextValidators(demande.id, { commentaire });
      } catch (e) {
        console.warn("Notif multi-validateurs (non bloquant):", e?.message || e);
      }

      if (demandeurUserId) {
        try {
          const detailByStatus = {
            validation_entite: "Validation section confirmee. Etape suivante: validation entite.",
            validation_entite_generale: "Validation entite confirmee. Etape papier REG requise.",
          };
          await createNotificationForUser({
            utilisateurId: demandeurUserId,
            demandeId: demande.id,
            message: formatDemandeInAppMessage(
              demande.id,
              "APPROUVEE",
              detailByStatus[prochainStatut] || `Nouveau statut: ${formatStatutLabel(prochainStatut)}.`
            ),
          });
        } catch (notifyError) {
          console.warn("Notif in-app approbation demandeur:", notifyError?.message || notifyError);
        }
      }
    }

    // b) Si approuve ET qu'on passe a REG (papier) => mail au demandeur
    if (statut === "approuve" && prochainStatut === "validation_entite_generale") {
      const emailDemandeur = demandeMaj?.agents?.utilisateurs?.email;
      if (emailDemandeur) {
        const sujetReg = formatDemandeMailSubject(demande.id, "ETAPE PAPIER REG");
        const mailTitleReg = formatDemandeMailTitleHtml(demande.id);
        const messageReg = `
          <p>Bonjour ${demandeMaj.agents?.nom || "Demandeur"},</p>
          ${mailTitleReg}
          <p>Votre demande a atteint l'etape <strong>validation entite generale</strong>.</p>
          <p>Veuillez <strong>imprimer la fiche</strong> et la faire signer par le <strong>Responsable d'entite generale (REG)</strong>.</p>
          <p>Apres signature, importez le document signe dans l'application afin de passer la demande a <strong>en attente de paiement</strong>.</p>
          <p><a href="${lien}">Ouvrir la demande</a></p>
          <p>Merci,</p>
          <p>GreenPay CI</p>`;
        try {
          await envoyerEmail(emailDemandeur, sujetReg, messageReg);
        } catch (e) {
          console.warn("Email REG au demandeur (non bloquant):", emailDemandeur, e?.message || e);
        }
      }
    }

    // c) Si rejet => mail au demandeur (avec proformas en PJ pour contexte)
    if (statut === "rejete" && demande.agents?.utilisateurs?.email) {
      const sujetRejet = formatDemandeMailSubject(demande.id, "REJETEE");
      const mailTitleRejet = formatDemandeMailTitleHtml(demande.id);
      const messageRejet = `
        <p>Bonjour ${demande.agents?.nom || "Demandeur"},</p>
        ${mailTitleRejet}
        <p>Votre demande de paiement a ete <strong>rejetee</strong> par <strong>${valideur.agents?.nom || "le validateur"}</strong>.</p>
        <p><strong>Montant :</strong> ${demande.montant} FCFA</p>
        <p><strong>Motif :</strong> ${demande.motif}</p>
        <p><strong>Commentaire :</strong> ${commentaire || "-"}</p>
        <p><a href="${lien}">Voir la demande</a></p>
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

      if (demandeurUserId) {
        try {
          await createNotificationForUser({
            utilisateurId: demandeurUserId,
            demandeId: demande.id,
            message: formatDemandeInAppMessage(
              demande.id,
              "REJETEE",
              "Votre demande a ete rejetee. Consultez le commentaire du validateur."
            ),
          });
        } catch (notifyError) {
          console.warn("Notif in-app rejet demandeur:", notifyError?.message || notifyError);
        }
      }
    }

    return res.status(200).json({
      message: `Demande ${statut} avec succès.`,
      prochainStatut,
      reject_attachments: rejectFileUrls,
    });
  } catch (error) {
    console.error("âŒ ERREUR validerDemande:", error);
    res
      .status(500)
      .json({ message: "Erreur serveur.", error: error.message || String(error) });
  }
};

/**
 * âœ… RÃ©cupÃ©rer les demandes en attente de validation pour un validateur donnÃ©
 */
const getDemandesEnAttente = async (req, res) => {
  const { validateur_id } = req.params;

  try {
    const utilisateur = await prisma.utilisateurs.findUnique({
      where: { id: Number(validateur_id) },
      include: { agents: true },
    });

    if (!utilisateur) return res.status(404).json({ message: "Utilisateur non trouvé." });

    const scope = getPendingValidationScope(utilisateur);
    if (!scope) return res.status(403).json({ message: "Non autorisé." });

    const demandes = await prisma.demandes_paiement.findMany({
      where: {
        statut: scope.statutRequis,
        agents: scope.agentsWhere,
      },
      include: { agents: true, validations: true },
      orderBy: { date_creation: "desc" },
    });

    return res.status(200).json({ demandes });
  } catch (error) {
    console.error("âŒ Erreur getDemandesEnAttente:", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

/**
 * âœ… Liste des validations faites par un validateur
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
    console.error("âŒ Erreur getValidationsByValidateur:", err);
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

      const scope = getPendingValidationScope(utilisateur);
      if (!scope) {
        return res.status(403).json({ message: "Non autorisé." });
      }

      const where = {
        statut: statut || scope.statutRequis,
        agents: scope.agentsWhere,
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
          formatStatutLabel(d.statut),
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
          formatStatutLabel(v.statut),
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
    console.error("âŒ Erreur export validations:", error);
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


