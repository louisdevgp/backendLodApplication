// controllers/DemandesPaiement/demandePaiement.js
const { PrismaClient, paiements_moyen_paiement } = require("@prisma/client");
const prisma = new PrismaClient();
const { envoyerEmail } = require("../../config/emailConfig");
const jwt = require("jsonwebtoken");
const { extname } = require("path");
const { saveBufferToLocalFile } = require("../../utils/localUpload");
const { PAYMENT_METHOD_VALUES, formatPaymentMethodLabel } = require("../../utils/paymentLabels");
const { notifyAcheteursDemandeEnAttenteAchat } = require("../../utils/achatWorkflowNotifications");
const {
  formatDemandeMailSubject,
  formatDemandeMailTitleHtml,
  formatDemandeInAppMessage,
} = require("../../utils/demandeMailFormat");
const {
  createNotificationForUser,
  createNotificationsForUsers,
} = require("../../utils/inAppNotifications");

// === Helper e-mail: wrapper direct vers envoyerEmail (avec CC)
async function sendEmail(to, subject, html, attachments = [], ccEmails = []) {
  return envoyerEmail(to, subject, html, attachments, ccEmails);
}

const uploadProformaLocal = async (req, file) => {
  const saved = await saveBufferToLocalFile(req, file.buffer, file.originalname || "proforma", "proformas");
  return saved.url;
};

const uploadPaiementLocal = async (req, file) => {
  const saved = await saveBufferToLocalFile(req, file.buffer, file.originalname || "document_paiement", "paiements");
  return saved.url;
};

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
// === Helpers hiérarchie & destinataires
const ROLES_EXCLUS = [
  "Responsable Entité Générale",
  "Responsable Entité Financière",
  "REG",
  "REF",
];

async function getUtilisateurByAgentId(agentId) {
  if (!agentId) return null;
  return prisma.utilisateurs.findFirst({
    where: { agent_id: agentId },
    include: { agents: true },
  });
}

async function findAgent({ fonctionEquals, fonctionContains, entite_id, section_id }) {
  const where = {};
  if (fonctionEquals) where.fonction = fonctionEquals;
  if (fonctionContains) where.fonction = { contains: fonctionContains };
  if (entite_id != null) where.entite_id = entite_id;
  if (section_id != null) where.section_id = section_id;
  return prisma.agents.findFirst({ where });
}

async function buildRecipientsChain(demande) {
  const agent = demande?.agents;
  if (!agent)
    return { demandeur: null, superieur: null, directeur: null, dg: null, daf: null, chain: [] };

  const demandeurUser = await getUtilisateurByAgentId(agent.id);

  // Supérieur direct selon la fonction
  let superieurAgent = null;
  const f = agent.fonction || "";
  if (f.includes("Agent")) {
    superieurAgent = await findAgent({
      fonctionEquals: "Responsable de section",
      section_id: agent.section_id,
    });
  } else if (f.includes("Responsable de section")) {
    superieurAgent = await findAgent({
      fonctionEquals: "Responsable d'entité",
      entite_id: agent.entite_id,
    });
  } else if (f.includes("Responsable d'entité")) {
    // Chercher le directeur de la même entité (éviter directeur global)
    superieurAgent = await findAgent({ fonctionContains: "Directeur", entite_id: agent.entite_id });
  }

  const [directeurAgent, dgAgent, dafAgent] = await Promise.all([
    findAgent({ fonctionEquals: "Directeur", entite_id: agent.entite_id }),
    findAgent({ fonctionContains: "Directeur Général" }),
    findAgent({ fonctionContains: "Directeur Administratif et Financier" }),
  ]);

  const [superieur, directeur, dg, daf] = await Promise.all([
    superieurAgent ? getUtilisateurByAgentId(superieurAgent.id) : null,
    directeurAgent ? getUtilisateurByAgentId(directeurAgent?.id) : null,
    dgAgent ? getUtilisateurByAgentId(dgAgent?.id) : null,
    dafAgent ? getUtilisateurByAgentId(dafAgent?.id) : null,
  ]);

  const valid = (u) =>
    u?.email && !ROLES_EXCLUS.some((r) => (u.agents?.fonction || "").includes(r));

  const chain = [superieur, directeur, dg, daf].filter(valid);

  return {
    demandeur: demandeurUser?.email ? demandeurUser : null,
    superieur: valid(superieur) ? superieur : null,
    directeur: valid(directeur) ? directeur : null,
    dg: valid(dg) ? dg : null,
    daf: valid(daf) ? daf : null,
    chain,
  };
}

function appLienDemande(id) {
  return `https://achats.greenpayci.com/demandes/${id}`;
}

// === Helper: inférer filename + contentType depuis une URL
function inferAttachmentFromUrl(url, base = "fichier") {
  let ext = "";
  try {
    const u = new URL(url);
    ext = extname(u.pathname).toLowerCase(); // ex: .pdf, .png, .jpg, .docx...
  } catch {
    // URL invalide
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

// === Types de document: normalisation (libre)
function normalizeDocType(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "autre";
  const safe = raw
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 50);
  return safe || "autre";
}

// === Collects
function collectProformaFilesFromReq(req) {
  const out = [];
  const names = new Set(["proformas", "proformas[]", "proforma"]);
  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      if (!f?.fieldname || names.has(f.fieldname)) out.push(f);
    }
  } else if (req.files && typeof req.files === "object") {
    for (const key of Object.keys(req.files)) {
      if (names.has(key)) {
        const arr = Array.isArray(req.files[key]) ? req.files[key] : [req.files[key]];
        out.push(...arr);
      }
    }
  } else if (req.file && (names.has(req.file.fieldname) || !req.file.fieldname)) {
    out.push(req.file);
  }
  return out;
}

function collectPaymentDocFilesFromReq(req) {
  const out = [];
  const proformaNames = new Set(["proformas", "proformas[]", "proforma"]);
  const names = new Set(["documents_paiement", "documents_paiement[]", "documents", "files", "pieces", "justificatifs"]);
  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      if (!f?.fieldname) continue;
      if (proformaNames.has(f.fieldname)) continue;
      if (names.has(f.fieldname)) out.push(f);
    }
  } else if (req.files && typeof req.files === "object") {
    for (const key of Object.keys(req.files)) {
      if (proformaNames.has(key)) continue;
      if (names.has(key)) {
        const arr = Array.isArray(req.files[key]) ? req.files[key] : [req.files[key]];
        out.push(...arr);
      }
    }
  }
  return out;
}

const normalizeFonctionText = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getFonctionFlags = (fonction = "") => {
  const f = normalizeFonctionText(fonction);
  const isReg =
    f.includes("responsable entite generale") || /(^|\s)reg($|\s)/.test(f);
  const isRef =
    f.includes("responsable entite financiere") ||
    f.includes("directeur administratif et financier") ||
    f.includes("directrice administrative et financiere") ||
    /(^|\s)ref($|\s)/.test(f);
  const isDg =
    f.includes("directeur general") || f.includes("directrice generale");
  const isDirecteurLike =
    (f.includes("directeur") || f.includes("directrice")) && !isRef && !isDg;
  const isRespEntite =
    (f.includes("responsable d entite") || f.includes("responsable entite")) &&
    !isReg &&
    !isRef;
  const isRespSection = f.includes("responsable de section");

  return {
    isReg,
    isRef,
    isDg,
    isDirecteurLike,
    isRespEntite,
    isRespSection,
  };
};

const getStatutFromValidatorFonction = (fonction = "") => {
  const {
    isReg,
    isRef,
    isDg,
    isDirecteurLike,
    isRespEntite,
    isRespSection,
  } = getFonctionFlags(fonction);

  if (isRespSection) return "validation_section";
  if (isRespEntite || isDirecteurLike || isDg) return "validation_entite";
  if (isReg) return "validation_entite_generale";
  if (isRef) return "validation_entite_finance";
  return null;
};

// === Détermination du statut/validateur initial
const determinerValidateurInitial = async (agent) => {
  // 1) Priorite au superieur hierarchique reel si renseigne
  const flags = getFonctionFlags(agent.fonction || "");
  const isDirecteurDemandeur = flags.isDirecteurLike;

  // Cas exceptionnel: un Directeur qui initie sa propre demande.
  // Il ne se valide pas lui-meme: passage direct en validation_entite_generale.
  if (isDirecteurDemandeur) {
    return {
      statutInitial: "validation_entite_generale",
      validateurInitial: null,
    };
  }

  if (agent.superieur_id) {
    const superieur = await prisma.agents.findUnique({
      where: { id: Number(agent.superieur_id) },
    });
    if (superieur) {
      const statutViaSuperieur = getStatutFromValidatorFonction(superieur.fonction || "");
      if (statutViaSuperieur) {
        return {
          statutInitial: statutViaSuperieur,
          validateurInitial: superieur,
        };
      }
    }
  }

  // 2) Fallback sur la logique historique si pas de superieur exploitable
  let statutInitial = "validation_section";
  let validateurInitial = null;

  if (flags.isRespSection) {
    statutInitial = "validation_entite";
    validateurInitial = await prisma.agents.findFirst({
      where: {
        entite_id: agent.entite_id,
        fonction: { contains: "Responsable d'entit" },
      },
    });
  } else if (flags.isRespEntite || flags.isDg || flags.isDirecteurLike) {
    statutInitial = "validation_entite_generale";
    validateurInitial = await prisma.agents.findFirst({
      where: { fonction: { contains: "Entit" } },
      orderBy: { id: "asc" },
    });
  } else if (flags.isReg) {
    statutInitial = "validation_entite_finance";
    validateurInitial = await prisma.agents.findFirst({
      where: { fonction: { contains: "Financi" } },
      orderBy: { id: "asc" },
    });
  } else if (flags.isRef) {
    statutInitial = "validation_entite_generale";
    validateurInitial = await prisma.agents.findFirst({
      where: { fonction: { contains: "Generale" } },
      orderBy: { id: "asc" },
    });
  } else {
    validateurInitial = await prisma.agents.findFirst({
      where: { section_id: agent.section_id, fonction: "Responsable de section" },
    });
  }

  if (!validateurInitial && (flags.isDirecteurLike || flags.isRespEntite || flags.isDg)) {
    statutInitial = "validation_entite_generale";
  }

  return { statutInitial, validateurInitial };
};

// === Création d'une demande (avec PJ proformas)
const creerDemandePaiement = async (req, res) => {
  let { agent_id, montant, motif, note, remarque, requiert_proforma, beneficiaire } = req.body;

  const agentIdNum = parseInt(agent_id);
  const montantNum = parseFloat(montant);
  const noteValue = String(note ?? remarque ?? "").trim();
  const requiertProformaBool =
    typeof requiert_proforma === "string"
      ? requiert_proforma.toLowerCase() === "true"
      : Boolean(requiert_proforma);

  const proformaFiles = collectProformaFilesFromReq(req);
  console.log("[INFO] Proformas recues:", proformaFiles.map(f => `${f.fieldname}:${f.originalname}`));

  try {
    const agent = await prisma.agents.findUnique({ where: { id: agentIdNum } });
    if (!agent) return res.status(404).json({ message: "Agent non trouvé." });
    const demandeurFlags = getFonctionFlags(agent.fonction || "");
    const canSetRemark = demandeurFlags.isRespEntite || demandeurFlags.isDirecteurLike;
    const finalNoteValue = canSetRemark ? noteValue : "";

    const { statutInitial, validateurInitial } = await determinerValidateurInitial(agent);
    if (!validateurInitial && statutInitial !== "validation_entite_generale") {
      return res.status(400).json({ message: "Aucun validateur initial trouvé pour cette demande." });
    }

    if (requiertProformaBool && proformaFiles.length === 0) {
      return res.status(400).json({ message: "Au moins une proforma est requise." });
    }

    // Upload Cloudinary hors transaction
    let proformaUrls = [];
    if (proformaFiles.length > 0) {
      for (const f of proformaFiles) {
        const url = await uploadProformaLocal(req, f);
        proformaUrls.push(url);
      }
    }

    // Transaction: création demande + proformas
    const demandeCree = await prisma.$transaction(async (tx) => {
      let demande = null;
      const baseData = {
        agent_id: agentIdNum,
        montant: isNaN(montantNum) ? 0 : montantNum,
        motif,
        beneficiaire,
        statut: statutInitial,
        requiert_proforma: requiertProformaBool,
      };

      try {
        demande = await tx.demandes_paiement.create({
          data: {
            ...baseData,
            note: finalNoteValue || null,
          },
        });
      } catch (createError) {
        const msg = String(createError?.message || "");
        const isMissingNoteColumn =
          createError?.code === "P2022" &&
          (msg.toLowerCase().includes("note") || msg.toLowerCase().includes("column"));
        const isUnknownNoteArg =
          msg.toLowerCase().includes("unknown argument") &&
          msg.toLowerCase().includes("note");

        if (!isMissingNoteColumn && !isUnknownNoteArg) throw createError;

        console.warn(
          "[WARN] Champ 'note' indisponible (colonne absente ou client Prisma non regenere). Création sans remarque."
        );
        demande = await tx.demandes_paiement.create({ data: baseData });
      }

      if (proformaUrls.length > 0) {
        await tx.proformas.createMany({
          data: proformaUrls.map((url) => ({
            demande_id: demande.id,
            fichier: url,
          })),
        });
      }

      return demande;
    });

    // Mail + notification in-app au validateur (si etape applicative)
    const demandeurUser = await prisma.utilisateurs.findFirst({
      where: { agent_id: agentIdNum },
      include: { agents: true },
    });

    const validateur =
      validateurInitial?.id != null
        ? await prisma.utilisateurs.findFirst({
            where: { agent_id: validateurInitial.id },
            include: { agents: true },
          })
        : null;

    if (validateur) {
      const validationURL = `https://achats.greenpayci.com/valider/${demandeCree.id}`;
      const sujet = formatDemandeMailSubject(demandeCree.id, "NOUVELLE DEMANDE");
      const mailTitle = formatDemandeMailTitleHtml(demandeCree.id);
      const message = `
        <p>Bonjour ${validateur.agents.nom},</p>
        ${mailTitle}
        <p>Une nouvelle demande de paiement a été créée par <strong>${agent.nom}</strong>.</p>
        <p><strong>Montant :</strong> ${montantNum || montant} FCFA</p>
        <p><strong>Motif :</strong> ${motif}</p>
        <p style="margin:16px 0">Merci de la valider :</p>
        <p style="text-align: center;">
          <a href="${validationURL}" 
            style="background-color:#1463ff;color:#fff;padding:10px 20px;text-decoration:none;font-weight:bold;border-radius:6px;">
            Ouvrir la demande
          </a>
        </p>
      `;
      const attachments = proformaUrls.map((url, i) =>
        inferAttachmentFromUrl(url, `proforma_${i + 1}`)
      );
      await sendEmail(validateur.email, sujet, message, attachments);

      try {
        await createNotificationForUser({
          utilisateurId: validateur.id,
          demandeId: demandeCree.id,
          message: formatDemandeInAppMessage(
            demandeCree.id,
            "VALIDATION REQUISE",
            `Nouvelle demande de ${agent.nom}`
          ),
        });
      } catch (notifyError) {
        console.warn("Notif in-app validateur (non bloquant):", notifyError?.message || notifyError);
      }
    }

    if (demandeurUser?.id) {
      try {
        await createNotificationForUser({
          utilisateurId: demandeurUser.id,
          demandeId: demandeCree.id,
          message: formatDemandeInAppMessage(
            demandeCree.id,
            "NOUVELLE DEMANDE",
            "Votre demande a ete enregistree."
          ),
        });
      } catch (notifyError) {
        console.warn("Notif in-app demandeur (non bloquant):", notifyError?.message || notifyError);
      }
    }

    if (!validateur && statutInitial === "validation_entite_generale" && demandeurUser?.id) {
      try {
        await createNotificationForUser({
          utilisateurId: demandeurUser.id,
          demandeId: demandeCree.id,
          message: formatDemandeInAppMessage(
            demandeCree.id,
            "ETAPE PAPIER REG",
            "Imprimez puis faites signer la fiche."
          ),
        });
      } catch (notifyError) {
        console.warn("Notif in-app etape REG (non bloquant):", notifyError?.message || notifyError);
      }
    }

    res.status(201).json({ message: "Demande créée avec succès.", demande: demandeCree });
  } catch (error) {
    console.error("[ERREUR] Erreur :", error);
    res.status(500).json({ message: "Erreur serveur.", error: error.message || error });
  }
};

// === Modification d'une demande (REG, paiements, docs libres après paye)
const modifierDemandePaiement = async (req, res) => {
  const { demande_id } = req.params;
  const {
    montant,
    motif,
    note,
    remarque,
    requiert_proforma,
    beneficiaire,
    statut,                   // optionnel
    moyen_paiement,           // legacy si on crée un paiement simple
    paiements: paiementsJson, // JSON string (nouveau)
    motif_rejet,              // obligatoire pour en_attente_paiement -> rejete
  } = req.body;

  const demandeIdNum = parseInt(demande_id, 10);
  const montantNum = montant != null ? parseFloat(montant) : undefined;
  const motifRejet = String(motif_rejet || "").trim();
  const hasNoteInPayload =
    Object.prototype.hasOwnProperty.call(req.body, "note") ||
    Object.prototype.hasOwnProperty.call(req.body, "remarque");
  const noteValue = hasNoteInPayload ? String(note ?? remarque ?? "").trim() : null;

  const requiertProformaBool =
    typeof requiert_proforma === "string"
      ? requiert_proforma.toLowerCase() === "true"
      : typeof requiert_proforma === "boolean"
      ? requiert_proforma
      : undefined;

  // URLs déjà hébergées
  const docsRaw = req.body.documents;
  const typesRaw = req.body.types;
  let docArray = Array.isArray(docsRaw) ? docsRaw : docsRaw ? [docsRaw] : [];
  let typeArray = Array.isArray(typesRaw) ? typesRaw : typesRaw ? [typesRaw] : [];

  // Fichiers uploadés (on push leurs URLs après upload)
  const payDocFiles = collectPaymentDocFilesFromReq(req);

  // Paiements (nouveau JSON)
  let paiementsPayload = [];
  try {
    if (paiementsJson) {
      paiementsPayload = JSON.parse(paiementsJson);
      if (!Array.isArray(paiementsPayload)) paiementsPayload = [];
    }
  } catch {
    paiementsPayload = [];
  }

  // Proformas
  const keepExistingProformas =
    typeof req.body.keep_existing_proformas === "string"
      ? req.body.keep_existing_proformas.toLowerCase() === "true"
      : !!req.body.keep_existing_proformas;

  let removeProformaIds = [];
  try {
    if (req.body.remove_proforma_ids) {
      const parsed = JSON.parse(req.body.remove_proforma_ids);
      if (Array.isArray(parsed)) removeProformaIds = parsed.map((x) => Number(x)).filter(Boolean);
    }
  } catch {
    removeProformaIds = [];
  }

  const proformaFilesReq = collectProformaFilesFromReq(req);

  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: demandeIdNum },
      include: { proformas: true, validations: true, agents: true },
    });
    if (!demande) return res.status(404).json({ message: "Demande non trouvée." });
    const demandeurFlags = getFonctionFlags(demande?.agents?.fonction || "");
    const canUpdateRemark = demandeurFlags.isRespEntite || demandeurFlags.isDirecteurLike;

    const nextStatut = statut ?? demande.statut;
    const fromEnAttenteToRejete =
      String(demande.statut || "").toLowerCase() === "en_attente_paiement" &&
      String(statut || "").toLowerCase() === "rejete";
    const fromAchatEffectueToCloture =
      String(demande.statut || "").toLowerCase() === "achat_effectue" &&
      String(statut || "").toLowerCase() === "cloture";

    // Contrôle transitions si changement explicite
    if (statut && statut !== demande.statut) {
      const transitionsAutorisees = {
        validation_section: ["validation_section"],
        validation_entite: ["validation_entite"],
        validation_entite_generale: ["en_attente_paiement", "paye", "rejete"],
        en_attente_paiement: ["paye", "rejete"],
        achat_effectue: ["cloture"],
      };
      const possibles = transitionsAutorisees[demande.statut] || [];
      if (!possibles.includes(statut)) {
        return res.status(400).json({
          message: `Changement de statut non autorisé : '${demande.statut}' -> '${statut}'.`,
        });
      }
    }

    // Uploader d'abord les nouvelles proformas (hors transaction)
    const proformaNewUploads = [];
    if (proformaFilesReq.length > 0) {
      for (const f of proformaFilesReq) {
        if (!f?.buffer) continue;
        const url = await uploadProformaLocal(req, f);
        proformaNewUploads.push({ url, originalname: f.originalname || null });
      }
    }

    // Uploader d'abord les documents paiement éventuels
    if (payDocFiles.length > 0) {
      for (const f of payDocFiles) {
        if (!f?.buffer) continue;
        const url = await uploadPaiementLocal(req, f);
        docArray.push(url);
        const singleType = req.body.type;
        const t = singleType ?? (Array.isArray(typesRaw) ? typesRaw[typeArray.length] : typesRaw) ?? "autre";
        typeArray.push(t);
      }
    }

    // Règle métier : en_attente_paiement -> rejete => motif + au moins une pièce justificative
    const explicitRejectDocs = docArray.filter((url, i) => {
      if (!url) return false;
      const t = normalizeDocType(typeArray[i] || "");
      return t === "justificatif_rejet";
    });
    const rejectJustifUrls =
      explicitRejectDocs.length > 0 ? explicitRejectDocs : docArray.filter(Boolean);

    if (fromEnAttenteToRejete) {
      if (!motifRejet) {
        return res.status(400).json({
          message:
            "Le motif du rejet est obligatoire pour rejeter une demande en attente de paiement.",
        });
      }
      if (rejectJustifUrls.length === 0) {
        return res.status(400).json({
          message:
            "Au moins une pièce justificative est obligatoire pour rejeter une demande en attente de paiement.",
        });
      }
    }

    const authUser =
      fromEnAttenteToRejete || fromAchatEffectueToCloture
        ? await getAuthUserFromToken(req)
        : null;
    if ((fromEnAttenteToRejete || fromAchatEffectueToCloture) && !authUser?.id) {
      return res.status(401).json({
        message: "Utilisateur authentifie requis pour cette action.",
      });
    }
    if (fromAchatEffectueToCloture && Number(authUser.agent_id) !== Number(demande.agent_id)) {
      return res.status(403).json({
        message: "Seul l'initiateur de la demande peut la cloturer.",
      });
    }

    const rejectComment =
      fromEnAttenteToRejete && rejectJustifUrls.length > 0
        ? `${motifRejet}\n\nPièces justificatives:\n${rejectJustifUrls.map((u) => `- ${u}`).join("\n")}`
        : motifRejet;

    // === Transaction DB
    const result = await prisma.$transaction(async (tx) => {
      // a) REG signé
      if (statut === "en_attente_paiement") {
        const idx = typeArray.findIndex((t) => String(t).toLowerCase() === "signe_reg");
        if (idx !== -1 && docArray[idx]) {
          await tx.demandes_paiement.update({
            where: { id: demandeIdNum },
            data: { demande_physique_signee_url: docArray[idx] },
          });
        }
      }

      // FIX TRIGGER: si on passe en "paye", on met ce statut AVANT de créer paiements/documents
      if (statut === "paye" && demande.statut !== "paye") {
        const earlyUpdate = {};
        if (montant != null) earlyUpdate.montant = isNaN(montantNum) ? demande.montant : montantNum;
        if (motif != null) earlyUpdate.motif = motif;
        if (hasNoteInPayload && canUpdateRemark) earlyUpdate.note = noteValue || null;
        if (beneficiaire != null) earlyUpdate.beneficiaire = beneficiaire;
        if (requiertProformaBool !== undefined) earlyUpdate.requiert_proforma = requiertProformaBool;

        await tx.demandes_paiement.update({
          where: { id: demandeIdNum },
          data: { ...earlyUpdate, statut: "paye" },
        });
      }

      // Helper interne: attacher docs libres à un paiement cible
      async function attachDocsToPaiement(paiementId, urls, types) {
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          const type = normalizeDocType(types[i] ?? "autre"); // fallback sûr
          if (!url) continue;
          await tx.documents_paiements.create({
            data: { paiement_id: paiementId, url, type },
          });
        }
      }

      // b) Création / attache des docs quand PAYE (ou déjà payée)
      const willHandleDocs =
        statut === "paye" ||
        (demande.statut === "paye" && (docArray.length > 0 || (paiementsPayload?.length || 0) > 0));

      if (willHandleDocs) {
        if (paiementsPayload.length > 0) {
          // Nouveau format structuré par paiement
          for (const p of paiementsPayload) {
            if (!p?.moyen_paiement) continue;
            if (!PAYMENT_METHOD_VALUES.includes(p.moyen_paiement)) {
              throw new Error("Moyen de paiement invalide.");
            }
            const paiement = await tx.paiements.create({
              data: { demande_id: demandeIdNum, moyen_paiement: p.moyen_paiement },
            });
            const docs = Array.isArray(p.documents) ? p.documents : [];
            const urls = [];
            const types = [];
            for (const d of docs) {
              if (!d?.url) continue;
              urls.push(d.url);
              types.push(normalizeDocType(d.type || "autre"));
            }
            await attachDocsToPaiement(paiement.id, urls, types);
          }
        } else if (docArray.length > 0) {
          // Legacy/Libre : on attache aux paiements existants (le plus récent)
          const paiementCible =
            (await tx.paiements.findFirst({
              where: { demande_id: demandeIdNum },
              orderBy: { date_paiement: "desc" },
            })) ||
            null;

          if (!paiementCible) {
            if (!moyen_paiement && statut !== "paye") {
              throw new Error(
                "Aucun paiement trouvé pour cette demande. Fournissez 'moyen_paiement' ou passez la demande au statut 'paye'."
              );
            }
            if (moyen_paiement && !PAYMENT_METHOD_VALUES.includes(moyen_paiement)) {
              throw new Error("Moyen de paiement invalide.");
            }
            const created = await tx.paiements.create({
              data: { demande_id: demandeIdNum, moyen_paiement: moyen_paiement || "especes" },
            });
            await attachDocsToPaiement(created.id, docArray, typeArray);
          } else {
            await attachDocsToPaiement(paiementCible.id, docArray, typeArray);
          }
        } else if (moyen_paiement && statut === "paye") {
          // PAYE sans docs: on crée quand même le paiement si demandé
          if (!PAYMENT_METHOD_VALUES.includes(moyen_paiement)) {
            throw new Error("Moyen de paiement invalide.");
          }
          await tx.paiements.create({
            data: { demande_id: demandeIdNum, moyen_paiement },
          });
        }
      }

      // c) Suppression des proformas existantes si demandé
      if (!keepExistingProformas && removeProformaIds.length > 0) {
        await tx.proformas.deleteMany({
          where: { id: { in: removeProformaIds }, demande_id: demandeIdNum },
        });
      }

      // d) Ajout des nouvelles proformas
      if (proformaNewUploads.length > 0) {
        await tx.proformas.createMany({
          data: proformaNewUploads.map((u) => ({
            demande_id: demandeIdNum,
            fichier: u.url,
            date_ajout: new Date(),
          })),
        });
      }

      // e) Historiser le motif/justificatifs de rejet
      if (fromEnAttenteToRejete && authUser?.id) {
        await tx.validations.create({
          data: {
            demande_id: demandeIdNum,
            valideur_id: Number(authUser.id),
            statut: "rejete",
            commentaire: rejectComment,
          },
        });
      }

      // f) Mise à jour des champs simples + statut final
      const dataToUpdate = { statut: nextStatut };
      if (montant != null) dataToUpdate.montant = isNaN(montantNum) ? demande.montant : montantNum;
      if (motif != null) dataToUpdate.motif = motif;
      if (hasNoteInPayload && canUpdateRemark) dataToUpdate.note = noteValue || null;
      if (beneficiaire != null) dataToUpdate.beneficiaire = beneficiaire;
      if (requiertProformaBool !== undefined) dataToUpdate.requiert_proforma = requiertProformaBool;

      // On a déjà mis 'paye' plus haut pour satisfaire le trigger
      if (statut === "paye") delete dataToUpdate.statut;

      const updated = await tx.demandes_paiement.update({
        where: { id: demandeIdNum },
        data: dataToUpdate,
        include: {
          agents: true,
          paiements: { include: { documents_paiements: true } },
          proformas: true,
        },
      });

      return updated;
    }, { timeout: 20000, maxWait: 5000 });
    const actorUser = authUser?.id ? authUser : await getAuthUserFromToken(req);
    const actorName = actorUser?.agents?.nom ? actorUser.agents.nom : null;
    const statusKey = String(statut || "").toLowerCase();
    const hasBusinessModification =
      montant != null ||
      motif != null ||
      (hasNoteInPayload && canUpdateRemark) ||
      beneficiaire != null ||
      requiertProformaBool !== undefined ||
      proformaNewUploads.length > 0 ||
      removeProformaIds.length > 0 ||
      docArray.length > 0 ||
      paiementsPayload.length > 0 ||
      Boolean(moyen_paiement);
    const isStatusHandledBySpecificNotif = [
      "en_attente_paiement",
      "paye",
      "rejete",
      "cloture",
    ].includes(statusKey);

    // ========= E-MAILS POST-TRANSACTION =========
    try {
      const chainData = await buildRecipientsChain(result);
      const emailOf = (u) => (u?.email ? u.email : null);
      const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

      const lien = appLienDemande(result.id);
      const stakeholdersIds = uniquePositiveIds([
        chainData?.demandeur?.id,
        chainData?.superieur?.id,
        chainData?.directeur?.id,
        chainData?.dg?.id,
        chainData?.daf?.id,
      ]);

      if (statut === "en_attente_paiement") {
        const to =
          emailOf(chainData.daf) ||
          emailOf(chainData.superieur) ||
          emailOf(chainData.directeur) ||
          emailOf(chainData.dg) ||
          emailOf(chainData.demandeur);

        const cc = uniq([
          emailOf(chainData.demandeur),
          emailOf(chainData.superieur),
          emailOf(chainData.directeur),
          emailOf(chainData.dg),
        ]).filter((e) => e !== to);

        const sujet = formatDemandeMailSubject(result.id, "EN ATTENTE DE PAIEMENT");
        const mailTitle = formatDemandeMailTitleHtml(result.id);
        const message = `
          <p>Bonjour,</p>
          ${mailTitle}
          <p>La demande <strong>#${result.id}</strong> est <strong>en attente de paiement</strong>.</p>
          <p><strong>Montant :</strong> ${result.montant} FCFA<br/>
             <strong>Motif :</strong> ${result.motif}<br/>
             <strong>Demandeur :</strong> ${result?.agents?.nom || "-"}</p>
          ${
            result.demande_physique_signee_url
              ? `<p>Document REG signé : <a href="${result.demande_physique_signee_url}">ouvrir</a></p>`
              : ""
          }
          <p><a href="${lien}">Ouvrir la demande</a></p>
        `;

        const attachments = result.demande_physique_signee_url
          ? [inferAttachmentFromUrl(result.demande_physique_signee_url, "REG_signe")]
          : [];

        if (to) await sendEmail(to, sujet, message, attachments, cc);

        await notifyInAppUsers({
          utilisateurIds: stakeholdersIds,
          demandeId: result.id,
          action: "EN ATTENTE DE PAIEMENT",
          detail: "La demande est prete pour traitement financier.",
        });
      }

      if (statut === "paye") {
        const to = emailOf(chainData.demandeur) ||
                   emailOf(chainData.superieur) ||
                   emailOf(chainData.directeur) ||
                   emailOf(chainData.dg) ||
                   emailOf(chainData.daf);

        const cc = uniq([
          emailOf(chainData.superieur),
          emailOf(chainData.directeur),
          emailOf(chainData.dg),
          emailOf(chainData.daf),
        ]).filter((e) => e && e !== to);

        const paiementsListHtml = (result.paiements || [])
          .map(
            (p) =>
              `<li>${formatPaymentMethodLabel(p.moyen_paiement)} - ${(p.documents_paiements || []).length} document(s)</li>`
          )
          .join("");

        const sujet = formatDemandeMailSubject(result.id, "PAIEMENT EFFECTUE");
        const mailTitle = formatDemandeMailTitleHtml(result.id);
        const message = `
          <p>Bonjour,</p>
          ${mailTitle}
          <p>Le paiement de la demande <strong>#${result.id}</strong> a été <strong>effectué</strong>.</p>
          <p><strong>Montant :</strong> ${result.montant} FCFA<br/>
             <strong>Motif :</strong> ${result.motif}</p>
          ${paiementsListHtml ? `<p><strong>Détails du/des paiement(s) :</strong></p><ul>${paiementsListHtml}</ul>` : ""}
          <p><a href="${lien}">Voir la demande</a></p>
        `;

        const attachments = [];
        for (const p of result.paiements || []) {
          for (const d of (p.documents_paiements || [])) {
            if (!d?.url) continue;
            const base = normalizeDocType(d.type || "document");
            attachments.push(inferAttachmentFromUrl(d.url, base));
          }
        }

        if (to) await sendEmail(to, sujet, message, attachments, cc);

        await notifyInAppUsers({
          utilisateurIds: stakeholdersIds,
          demandeId: result.id,
          action: "PAIEMENT EFFECTUE",
          detail: "La demande est en attente d'achat.",
        });

        try {
          await notifyAcheteursDemandeEnAttenteAchat({ demandeId: result.id });
        } catch (mailError) {
          console.warn("Notification acheteurs (paye) non envoyee:", mailError?.message || mailError);
        }
      }

      if (statut === "rejete") {
        const to = emailOf(chainData.demandeur) ||
                   emailOf(chainData.superieur) ||
                   emailOf(chainData.directeur) ||
                   emailOf(chainData.dg) ||
                   emailOf(chainData.daf);

        const cc = uniq([
          emailOf(chainData.superieur),
          emailOf(chainData.directeur),
          emailOf(chainData.dg),
          emailOf(chainData.daf),
        ]).filter((e) => e && e !== to);

        const sujet = formatDemandeMailSubject(result.id, "REJETEE");
        const mailTitle = formatDemandeMailTitleHtml(result.id);
        const message = `
          <p>Bonjour,</p>
          ${mailTitle}
          <p>La demande <strong>#${result.id}</strong> a été <strong>rejetée</strong>.</p>
          <p><strong>Montant :</strong> ${result.montant} FCFA<br/>
             <strong>Motif (demande) :</strong> ${result.motif}</p>
          ${
            fromEnAttenteToRejete
              ? `<p><strong>Motif du rejet :</strong> ${motifRejet}</p>`
              : ""
          }
          <p><a href="${lien}">Consulter la demande</a></p>
        `;

        const attachments = (result.proformas || []).map((p, i) =>
          inferAttachmentFromUrl(p.fichier, `proforma_${i + 1}`)
        );
        if (fromEnAttenteToRejete) {
          for (let i = 0; i < rejectJustifUrls.length; i++) {
            attachments.push(
              inferAttachmentFromUrl(rejectJustifUrls[i], `justificatif_rejet_${i + 1}`)
            );
          }
        }

        if (to) await sendEmail(to, sujet, message, attachments, cc);

        await notifyInAppUsers({
          utilisateurIds: stakeholdersIds,
          demandeId: result.id,
          action: "REJETEE",
          detail: fromEnAttenteToRejete
            ? "Demande rejetee apres etape paiement."
            : "Demande rejetee par un validateur.",
        });
      }

      if (String(statut || "").toLowerCase() === "cloture") {
        await notifyInAppUsers({
          utilisateurIds: stakeholdersIds,
          demandeId: result.id,
          action: "CLOTUREE",
          detail: "Demande cloturee par l'initiateur.",
        });
      }

      if (hasBusinessModification && !isStatusHandledBySpecificNotif) {
        await notifyInAppUsers({
          utilisateurIds: stakeholdersIds,
          demandeId: result.id,
          action: "MODIFICATION",
          detail: actorName
            ? `Demande mise a jour par ${actorName}.`
            : "Demande mise a jour.",
        });
      }
    } catch (e) {
      console.warn("Notifications (non bloquant) :", e?.message || e);
    }

    return res.status(200).json({
      message: "Demande mise à jour avec succès.",
      demande: result,
      ...(fromEnAttenteToRejete ? { reject_attachments: rejectJustifUrls } : {}),
    });
  } catch (error) {
    console.error("[ERREUR] Erreur :", error);
    return res.status(500).json({ message: "Erreur serveur", error: error.message || String(error) });
  }
};

// === Suppression (soft delete)
const supprimerDemandePaiement = async (req, res) => {
  const { demande_id } = req.params;

  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: parseInt(demande_id) },
      include: { validations: true },
    });

    if (!demande)
      return res.status(404).json({ message: "Demande non trouvée." });

    // Autorisation : vérifier que l'utilisateur peut voir cette demande
    const authUser = await getAuthUserFromToken(req);
    if (!authUser || !authUser.agents) {
      return res.status(401).json({ message: "Utilisateur non authentifié." });
    }

    const isOwner = Number(authUser.agents.id) === Number(demande.agent_id);
    const sameEntite = Boolean(authUser.agents.entite_id && demande.agents && authUser.agents.entite_id === demande.agents.entite_id);

    const allowedFonctions = [
      "Responsable d'entité",
      "Responsable Entité Générale",
      "Responsable Entité Financière",
      "Directeur",
      "Directeur Général",
      "Directeur Administratif et Financier",
    ];

    const isValidatorFonction = authUser.agents && allowedFonctions.some((fn) => (authUser.agents.fonction || "").includes(fn));
    const isAdminRole = userHasAnyRole(authUser, ["Admin"]);

    if (!isOwner && !isAdminRole && !(sameEntite && isValidatorFonction)) {
      return res.status(403).json({ message: "Accès interdit : vous ne pouvez pas voir cette demande." });
    }

    if (demande.validations.length > 0) {
      return res.status(400).json({ message: "Demande déjà validée." });
    }

    const validations = await prisma.validations.findMany({
      where: { demande_id: parseInt(demande_id) },
    });
    if (validations.length > 0) {
      return res
        .status(400)
        .json({ message: "Suppression impossible après validation." });
    }

    await prisma.demandes_paiement.update({
      where: { id: parseInt(demande_id) },
      data: { deleted_at: new Date() },
    });
    res.status(200).json({ message: "Demande supprimée avec succès (soft delete)." });
  } catch (error) {
    console.error("Erreur :", error);
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

// === Listages / Stats
const getDemandesPaiement = async (req, res) => {
  const { page = 1, limit = 1000, utilisateur_id } = req.query;
  const offset = (page - 1) * limit;

  try {
    const utilisateur = await prisma.utilisateurs.findUnique({
      where: { id: Number(utilisateur_id) },
      include: { agents: true },
    });

    if (!utilisateur)
      return res.status(404).json({ message: "Utilisateur non trouvé." });

    const demandes = await prisma.demandes_paiement.findMany({
      skip: Number(offset),
      take: Number(limit),
      orderBy: { date_creation: "desc" },
      where: {
        agent_id: parseInt(utilisateur.agent_id),
        deleted_at: null,
      },
      include: { agents: true, proformas: true, validations: true },
    });

    const totalDemandes = await prisma.demandes_paiement.count();
    const totalPages = Math.ceil(totalDemandes / limit);

    res.json({ demandes, totalPages });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error });
  }
};

const getAllDemandesPaiement = async (req, res) => {
  const { page = 1, limit = 1000, utilisateur_id } = req.query;
  const offset = (page - 1) * limit;

  try {
    const utilisateur = await prisma.utilisateurs.findUnique({
      where: { id: Number(utilisateur_id) },
      include: { agents: true, utilisateur_roles: { include: { roles: true } } },
    });

    if (!utilisateur)
      return res.status(404).json({ message: "Utilisateur non trouvé." });

    if (!utilisateur.agents || utilisateur.agents.entite_id == null) {
      return res.status(400).json({ message: "Utilisateur sans entité rattachée." });
    }

    const entiteId = Number(utilisateur.agents.entite_id);
    const whereEntite = {
      agents: { entite_id: entiteId },
      deleted_at: null,
    };

    const demandes = await prisma.demandes_paiement.findMany({
      skip: Number(offset),
      take: Number(limit),
      orderBy: { date_creation: "desc" },
      where: whereEntite,
      include: { agents: true, proformas: true, validations: true },
    });

    const totalDemandes = await prisma.demandes_paiement.count({ where: whereEntite });
    const totalPages = Math.ceil(totalDemandes / limit);
    res.json({ demandes, totalPages });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error });
  }
};

const getDemandePaiementById = async (req, res) => {
  const { demande_id } = req.params;
  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: parseInt(demande_id) },
      include: {
        agents: true,
        proformas: true,
        achats: { include: { preuves_achat: true, utilisateurs: { include: { agents: true } } } },
        paiements: { include: { documents_paiements: true } },
        validations: { include: { utilisateurs: { include: { agents: true } } } },
      },
    });

    if (!demande)
      return res.status(404).json({ message: "Demande non trouvée." });

    res.status(200).json({ demande });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur.", error });
  }
};

const APPROVED_STATUSES = ["approuve", "en_attente_paiement", "paye"];
const PENDING_STATUSES = [
  "validation_section",
  "validation_entite",
  "validation_entite_generale",
  "validation_entite_finance",
];

const getAuthUserFromToken = async (req) => {
  const word = req.headers.authorization;
  if (!word) return null;
  const token = word.split(" ")[1];
  const payload = jwt.decode(token);
  if (!payload || !payload.userId) return null;
  return prisma.utilisateurs.findUnique({
    where: { id: payload.userId },
    include: { agents: true, utilisateur_roles: { include: { roles: true } } },
  });
};

function userHasAnyRole(user, roleNames = []) {
  if (!user || !Array.isArray(user.utilisateur_roles)) return false;
  const wanted = new Set(roleNames.map((r) => String(r).toLowerCase()));
  for (const ur of user.utilisateur_roles) {
    const rn = ur?.roles?.nom;
    if (rn && wanted.has(String(rn).toLowerCase())) return true;
  }
  return false;
}

const demandesCountByUser = async (req, res) => {
  try {
    const user = await getAuthUserFromToken(req);
    if (!user || !user.agents) {
      return res.status(404).json({ error: "Agent non trouv?" });
    }

    const agentId = Number(user.agents.id);
    const baseWhere = { agent_id: agentId, deleted_at: null };

    const [
      nbDemandes,
      montantTotalDemandes,
      nbDemandesPending,
      montantTotalDemandesPending,
      nbDemandesApprouvees,
      nbDemandesRejetees,
      nbPaiementsRecus,
      montantTotalPaiementsRecus,
    ] = await Promise.all([
      prisma.demandes_paiement.count({ where: baseWhere }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: baseWhere }),
      prisma.demandes_paiement.count({
        where: { ...baseWhere, statut: { in: [...PENDING_STATUSES, "en_attente_paiement"] } },
      }),
      prisma.demandes_paiement.aggregate({
        _sum: { montant: true },
        where: { ...baseWhere, statut: { in: [...PENDING_STATUSES, "en_attente_paiement"] } },
      }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: { in: APPROVED_STATUSES } } }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: "rejete" } }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: "paye" } }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: { ...baseWhere, statut: "paye" } }),
    ]);

    return res.json({
      nbDemandes,
      montantTotalDemandes: montantTotalDemandes._sum.montant || 0,
      nbDemandesPending,
      montantTotalDemandesPending: montantTotalDemandesPending._sum.montant || 0,
      nbDemandesApprouvees,
      nbDemandesRejetees,
      nbPaiementsRecus,
      montantTotalPaiementsRecus: montantTotalPaiementsRecus._sum.montant || 0,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};

const demandesCountByResponsableSection = async (req, res) => {
  try {
    const user = await getAuthUserFromToken(req);
    if (!user || !user.agents) {
      return res.status(404).json({ error: "Agent non trouv?" });
    }

    const sectionId = Number(user.agents.section_id);
    const baseWhere = { agents: { section_id: sectionId }, deleted_at: null };

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [
      nbDemandes,
      montantTotalDemandes,
      nbDemandesPending,
      nbDemandesApprouvees,
      nbDemandesApprouveesCeMois,
      nbDemandesRejeteesCeMois,
      nbDemandesRejetees,
      montantTotalPaiementsRecus,
    ] = await Promise.all([
      prisma.demandes_paiement.count({ where: baseWhere }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: baseWhere }),
      prisma.demandes_paiement.count({
        where: { ...baseWhere, statut: { in: [...PENDING_STATUSES, "en_attente_paiement"] } },
      }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: { in: APPROVED_STATUSES } } }),
      prisma.demandes_paiement.count({
        where: {
          ...baseWhere,
          statut: { in: APPROVED_STATUSES },
          date_creation: { gte: firstDayOfMonth, lte: lastDayOfMonth },
        },
      }),
      prisma.demandes_paiement.count({
        where: {
          ...baseWhere,
          statut: "rejete",
          date_creation: { gte: firstDayOfMonth, lte: lastDayOfMonth },
        },
      }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: "rejete" } }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: { ...baseWhere, statut: "paye" } }),
    ]);

    return res.json({
      nbDemandes,
      montantTotalDemandes: montantTotalDemandes._sum.montant || 0,
      nbDemandesPending,
      nbDemandesApprouvees,
      nbDemandesApprouveesCeMois,
      nbDemandesRejeteesCeMois,
      nbDemandesRejetees,
      montantTotalPaiementsRecus: montantTotalPaiementsRecus._sum.montant || 0,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};

const demandesCountByRef = async (req, res) => {
  try {
    const user = await getAuthUserFromToken(req);
    if (!user || !user.agents) {
      return res.status(404).json({ error: "Agent non trouv?" });
    }

    const globalWhere = { deleted_at: null };
    const mineWhere = { agent_id: Number(user.agents.id), deleted_at: null };

    const [
      nbPaiements,
      montantPaiements,
      nbPaiementAttente,
      nbPaiementRejetees,
      nbPaiementRef,
      montantPaiementRef,
      montantPaiementEnAttenteValidation,
      nbPaiementTypePaiement,
    ] = await Promise.all([
      prisma.paiements.count({ where: { demandes_paiement: { deleted_at: null } } }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: { ...globalWhere, statut: "paye" } }),
      prisma.demandes_paiement.count({ where: { ...globalWhere, statut: "en_attente_paiement" } }),
      prisma.demandes_paiement.count({ where: { ...globalWhere, statut: "rejete" } }),
      prisma.demandes_paiement.count({ where: mineWhere }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: { ...mineWhere, statut: "paye" } }),
      prisma.demandes_paiement.count({
        where: { ...mineWhere, statut: { in: [...PENDING_STATUSES, "en_attente_paiement"] } },
      }),
      prisma.paiements.groupBy({
        by: ["moyen_paiement"],
        _count: { moyen_paiement: true },
        where: { demandes_paiement: { deleted_at: null } },
      }),
    ]);

    const result = nbPaiementTypePaiement.reduce((acc, paiement) => {
      acc[paiement.moyen_paiement] = paiement._count.moyen_paiement;
      return acc;
    }, {});

    return res.json({
      nbPaiements,
      montantPaiements: montantPaiements._sum.montant || 0,
      nbPaiementAttente,
      nbPaiementRejetees,
      nbPaiementRef,
      montantPaiementRef: montantPaiementRef._sum.montant || 0,
      montantPaiementEnAttenteValidation,
      result,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

const demandesCountByReg = async (req, res) => {
  try {
    const user = await getAuthUserFromToken(req);
    if (!user) {
      return res.status(401).json({ error: "Token invalide" });
    }

    const baseWhere = { deleted_at: null };

    const [
      nbPaiements,
      montantPaiements,
      nbDemandesEnAttenteValidation,
      nbDemandesApprouvees,
      nbDemandesRejetees,
      nbDemandePaiementAttente,
      montantTotalPaiements,
      nbPaiementsType,
    ] = await Promise.all([
      prisma.paiements.count({ where: { demandes_paiement: { deleted_at: null } } }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: { ...baseWhere, statut: "paye" } }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: { in: PENDING_STATUSES } } }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: { in: APPROVED_STATUSES } } }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: "rejete" } }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: "en_attente_paiement" } }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: { ...baseWhere, statut: "paye" } }),
      prisma.paiements.groupBy({
        by: ["moyen_paiement"],
        _count: { moyen_paiement: true },
        where: { demandes_paiement: { deleted_at: null } },
      }),
    ]);

    const result = nbPaiementsType.reduce((acc, paiement) => {
      acc[paiement.moyen_paiement] = paiement._count.moyen_paiement;
      return acc;
    }, {});

    return res.json({
      nbPaiements,
      montantPaiements: montantPaiements._sum.montant || 0,
      nbDemandesEnAttenteValidation,
      nbDemandesApprouvees,
      nbDemandesRejetees,
      nbDemandePaiementAttente,
      montantTotalPaiements: montantTotalPaiements._sum.montant || 0,
      result,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

const demandesCountByResponsableEntite = async (req, res) => {
  try {
    const user = await getAuthUserFromToken(req);
    if (!user || !user.agents) {
      return res.status(404).json({ error: "Agent non trouv?" });
    }

    const entiteId = Number(user.agents.entite_id);
    const baseWhere = { agents: { entite_id: entiteId }, deleted_at: null };

    const [
      nbDemandes,
      montantDemandes,
      nbDemandesAttente,
      nbDemandesApprouvees,
      nbDemandesRejetees,
      nbPaiements,
      montantPaiements,
      nbPaiementsAttente,
      nbPaiementsType,
    ] = await Promise.all([
      prisma.demandes_paiement.count({ where: baseWhere }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: baseWhere }),
      prisma.demandes_paiement.count({
        where: { ...baseWhere, statut: { in: [...PENDING_STATUSES, "en_attente_paiement"] } },
      }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: { in: APPROVED_STATUSES } } }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: "rejete" } }),
      prisma.paiements.count({ where: { demandes_paiement: { agents: { entite_id: entiteId }, deleted_at: null } } }),
      prisma.demandes_paiement.aggregate({ _sum: { montant: true }, where: { ...baseWhere, statut: "paye" } }),
      prisma.demandes_paiement.count({ where: { ...baseWhere, statut: "en_attente_paiement" } }),
      prisma.paiements.groupBy({
        by: ["moyen_paiement"],
        _count: { moyen_paiement: true },
        where: { demandes_paiement: { agents: { entite_id: entiteId }, deleted_at: null } },
      }),
    ]);

    const result = nbPaiementsType.reduce((acc, paiement) => {
      acc[paiement.moyen_paiement] = paiement._count.moyen_paiement;
      return acc;
    }, {});

    return res.json({
      nbDemandes,
      montantDemandes: montantDemandes._sum.montant || 0,
      nbDemandesAttente,
      nbDemandesApprouvees,
      nbDemandesRejetees,
      nbPaiements,
      montantPaiements: montantPaiements._sum.montant || 0,
      nbPaiementsAttente,
      result,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

const exporterDemandesPaiementExcel = async (req, res) => {
  try {
    const { statut, date_debut, date_fin, agent_id, entite_id, utilisateur_id, scope } = req.query;

    const where = { deleted_at: null };

    if (statut) where.statut = statut;

    if (agent_id && !Number.isNaN(Number(agent_id))) {
      where.agent_id = Number(agent_id);
    }

    if (entite_id && !Number.isNaN(Number(entite_id))) {
      where.agents = { entite_id: Number(entite_id) };
    }

    // Scope optionnel piloté par le front:
    // - scope=mine   -> demandes de l'agent de l'utilisateur connecté
    // - scope=entite -> demandes de l'entité de cet utilisateur
    if (utilisateur_id && !Number.isNaN(Number(utilisateur_id))) {
      const user = await prisma.utilisateurs.findUnique({
        where: { id: Number(utilisateur_id) },
        include: { agents: true },
      });

      if (user?.agents) {
        if (scope === "mine") {
          where.agent_id = Number(user.agents.id);
        } else if (scope === "entite" && user.agents.entite_id != null) {
          where.agents = { entite_id: Number(user.agents.entite_id) };
        }
      }
    }

    if (date_debut || date_fin) {
      where.date_creation = {};
      if (date_debut) where.date_creation.gte = new Date(date_debut);
      if (date_fin) where.date_creation.lte = new Date(date_fin);
    }

    const demandes = await prisma.demandes_paiement.findMany({
      where,
      orderBy: { date_creation: "desc" },
      include: {
        agents: { include: { entites: true, sections: true } },
        proformas: true,
        validations: true,
        paiements: { include: { documents_paiements: true } },
      },
    });

    const headers = [
      "ID",
      "Date creation",
      "Demandeur",
      "Fonction",
      "Entite",
      "Section",
      "Beneficiaire",
      "Montant",
      "Motif",
      "Statut",
      "Requiert proforma",
      "Nombre proformas",
      "Nombre paiements",
      "Moyens de paiement",
      "Nombre documents paiement",
    ];

    const escapeCsv = (value) => {
      const str = value == null ? "" : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = demandes.map((d) => {
      const moyensPaiement = (d.paiements || []).map((p) => formatPaymentMethodLabel(p.moyen_paiement)).join(" | ");
      const nbDocsPaiement = (d.paiements || []).reduce(
        (acc, p) => acc + ((p.documents_paiements || []).length || 0),
        0
      );

      return [
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
        d.requiert_proforma ? "oui" : "non",
        d.proformas?.length || 0,
        d.paiements?.length || 0,
        moyensPaiement,
        nbDocsPaiement,
      ].map(escapeCsv).join(";");
    });

    const csv = [headers.map(escapeCsv).join(";"), ...rows].join("\n");

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(
      2,
      "0"
    )}${String(now.getSeconds()).padStart(2, "0")}`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"demandes_paiement_${stamp}.csv\"`);
    return res.status(200).send("\uFEFF" + csv);
  } catch (error) {
    console.error("Erreur export Excel demandes :", error);
    return res.status(500).json({ message: "Erreur serveur lors de l'export Excel." });
  }
};

module.exports = {
  creerDemandePaiement,
  modifierDemandePaiement,
  supprimerDemandePaiement,
  getDemandesPaiement,
  getDemandePaiementById,
  demandesCountByUser,
  demandesCountByResponsableSection,
  demandesCountByRef,
  demandesCountByReg,
  demandesCountByResponsableEntite,
  getAllDemandesPaiement,
  exporterDemandesPaiementExcel,
};


