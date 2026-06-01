const { PrismaClient } = require("@prisma/client");
const { envoyerEmail } = require("../../config/emailConfig");
const { normalizeName } = require("../../middlewares/authMiddleware");
const {
  formatDemandeMailSubject,
  formatDemandeMailTitleHtml,
  formatDemandeInAppMessage,
} = require("../../utils/demandeMailFormat");
const {
  notifyUsersDataRefreshed,
  createNotificationsForUsers,
} = require("../../utils/inAppNotifications");

const prisma = new PrismaClient();

const cleanName = (value) => String(value || "").trim();
const normalizePieceType = (value) => cleanName(value).toLowerCase().slice(0, 100);
const parseDateAchatInput = (value) => {
  const raw = cleanName(value);
  if (!raw) return { date: null, error: null };

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map((x) => Number(x));
    const parsed = new Date(y, m - 1, d, 0, 0, 0, 0);
    const isValid =
      parsed.getFullYear() === y &&
      parsed.getMonth() === m - 1 &&
      parsed.getDate() === d;
    if (!isValid) {
      return { date: null, error: "Date d'achat invalide." };
    }
    return { date: parsed, error: null };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { date: null, error: "Date d'achat invalide." };
  }
  return { date: parsed, error: null };
};

const getPublicBaseUrl = (req) =>
  cleanName(process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_BASE_URL) ||
  `${req.protocol}://${req.get("host")}`;

const fileToPublicUrl = (req, file) => {
  if (!file?.filename) return null;
  return `${getPublicBaseUrl(req)}/uploads/preuves_achat/${encodeURIComponent(file.filename)}`;
};

const getFrontendBaseUrl = () =>
  cleanName(process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL) ||
  "https://achats.greenpayci.com";

const appLienDemande = (id) => `${getFrontendBaseUrl().replace(/\/+$/, "")}/demandes/${id}`;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatMontant = (value) => {
  const amount = typeof value?.toNumber === "function" ? value.toNumber() : Number(value);
  if (!Number.isFinite(amount)) return `${escapeHtml(value || "")} FCFA`;
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
};

const formatDate = (value) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const uniqueEmails = (emails) => {
  const seen = new Set();
  const out = [];
  for (const raw of emails || []) {
    const email = cleanName(raw);
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push(email);
  }
  return out;
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

const getStakeholderUserIdsByDemandeId = async (demandeId) => {
  const id = toPositiveInt(demandeId);
  if (!id) return [];

  const demande = await prisma.demandes_paiement.findUnique({
    where: { id },
    include: {
      agents: {
        include: {
          utilisateurs: true,
          agents: { include: { utilisateurs: true } },
        },
      },
    },
  });

  const agent = demande?.agents;
  if (!agent) return [];

  const hierarchyFilters = [];
  if (agent.superieur_id) hierarchyFilters.push({ id: Number(agent.superieur_id) });
  if (agent.section_id) {
    hierarchyFilters.push({
      section_id: Number(agent.section_id),
      fonction: { contains: "Responsable de section" },
    });
  }
  if (agent.entite_id) {
    hierarchyFilters.push({
      entite_id: Number(agent.entite_id),
      fonction: { contains: "Responsable d'entit" },
    });
  }
  hierarchyFilters.push({ fonction: { contains: "Directeur" } });

  const hierarchyAgents = hierarchyFilters.length
    ? await prisma.agents.findMany({
        where: { OR: hierarchyFilters },
        include: { utilisateurs: true },
      })
    : [];

  return uniquePositiveIds([
    agent.utilisateurs?.id,
    agent.agents?.utilisateurs?.id,
    ...hierarchyAgents.map((a) => a.utilisateurs?.id),
  ]);
};

const buildAchatAttachments = (files) => {
  const maxBytes = 20 * 1024 * 1024;
  let total = 0;
  const attachments = [];

  for (const [index, file] of (files || []).entries()) {
    if (!file?.path) continue;
    const size = Number(file.size) || 0;
    if (size && total + size > maxBytes) continue;
    total += size;
    attachments.push({
      filename: file.originalname || `preuve_achat_${index + 1}`,
      path: file.path,
      contentType: file.mimetype || undefined,
    });
  }

  return attachments;
};

const buildAchatEmailRecipients = async (demande) => {
  const agent = demande?.agents;
  if (!agent) return { to: null, cc: [] };

  const hierarchyFilters = [];
  if (agent.superieur_id) hierarchyFilters.push({ id: Number(agent.superieur_id) });
  if (agent.section_id) {
    hierarchyFilters.push({
      section_id: Number(agent.section_id),
      fonction: { contains: "Responsable de section" },
    });
  }
  if (agent.entite_id) {
    hierarchyFilters.push({
      entite_id: Number(agent.entite_id),
      fonction: { contains: "Responsable d'entit" },
    });
  }
  hierarchyFilters.push({ fonction: { contains: "Directeur" } });

  const hierarchyAgents = hierarchyFilters.length
    ? await prisma.agents.findMany({
        where: { OR: hierarchyFilters },
        include: { utilisateurs: true },
      })
    : [];

  const demandeurEmail = cleanName(agent.utilisateurs?.email);
  const cc = uniqueEmails([
    agent.agents?.utilisateurs?.email,
    ...hierarchyAgents.map((a) => a.utilisateurs?.email),
  ]).filter((email) => email.toLowerCase() !== demandeurEmail.toLowerCase());

  if (demandeurEmail) return { to: demandeurEmail, cc };
  return { to: cc[0] || null, cc: cc.slice(1) };
};

const notifyAchatEffectue = async ({ demandeId, achat, files }) => {
  const demande = await prisma.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    include: {
      agents: {
        include: {
          utilisateurs: true,
          agents: { include: { utilisateurs: true } },
          entites: true,
          sections: true,
        },
      },
    },
  });

  if (!demande) return;

  const { to, cc } = await buildAchatEmailRecipients(demande);
  if (!to) return;

  const acheteurNom = achat?.utilisateurs?.agents?.nom || achat?.utilisateurs?.email || "Acheteur";
  const lien = appLienDemande(demande.id);
  const attachments = buildAchatAttachments(files);
  const nbPreuves = Array.isArray(achat?.preuves_achat) ? achat.preuves_achat.length : files.length;
  const commentaire = cleanName(achat?.commentaire);

  const subject = formatDemandeMailSubject(demande.id, "ACHAT EFFECTUE");
  const mailTitle = formatDemandeMailTitleHtml(demande.id);
  const html = `
    <p>Bonjour ${escapeHtml(demande.agents?.nom || "")},</p>
    ${mailTitle}
    <p>L'achat lie a la demande <strong>#${demande.id}</strong> a ete confirme.</p>
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <tr><td><strong>Statut</strong></td><td>achat effectué</td></tr>
      <tr><td><strong>Montant</strong></td><td>${formatMontant(demande.montant)}</td></tr>
      <tr><td><strong>Beneficiaire</strong></td><td>${escapeHtml(demande.beneficiaire)}</td></tr>
      <tr><td><strong>Motif</strong></td><td>${escapeHtml(demande.motif)}</td></tr>
      <tr><td><strong>Entite</strong></td><td>${escapeHtml(demande.agents?.entites?.nom || "-")}</td></tr>
      <tr><td><strong>Section</strong></td><td>${escapeHtml(demande.agents?.sections?.nom || "-")}</td></tr>
      <tr><td><strong>Acheteur</strong></td><td>${escapeHtml(acheteurNom)}</td></tr>
      <tr><td><strong>Date d'achat</strong></td><td>${escapeHtml(formatDate(achat?.date_achat))}</td></tr>
      <tr><td><strong>Preuves</strong></td><td>${nbPreuves} fichier(s) ajoute(s)</td></tr>
    </table>
    ${commentaire ? `<p><strong>Commentaire acheteur :</strong><br/>${escapeHtml(commentaire)}</p>` : ""}
    <p>Les preuves d'achat sont disponibles dans l'application${attachments.length ? " et jointes a cet email dans la limite de taille autorisee." : "."}</p>
    <p><a href="${escapeHtml(lien)}">Voir la demande</a></p>
    <p>Cordialement,<br/>GreenPay CI</p>
  `;

  await envoyerEmail(to, subject, html, attachments, cc);
};

function collectAchatFiles(req) {
  const names = new Set(["preuves", "preuves[]", "preuves_achat", "preuves_achat[]", "files"]);
  const out = [];

  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      if (!f?.fieldname || names.has(f.fieldname)) out.push(f);
    }
  } else if (req.files && typeof req.files === "object") {
    for (const key of Object.keys(req.files)) {
      if (!names.has(key)) continue;
      const arr = Array.isArray(req.files[key]) ? req.files[key] : [req.files[key]];
      out.push(...arr);
    }
  } else if (req.file) {
    out.push(req.file);
  }

  return out;
}

function collectAchatTypes(req) {
  const first = req.body?.preuves_types;
  const second = req.body?.["preuves_types[]"];
  const raw = first ?? second;

  if (Array.isArray(raw)) {
    return raw.map((v) => normalizePieceType(v || "autre"));
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => normalizePieceType(v || "autre"));
        }
      } catch {
        // fallback sur valeur simple
      }
    }
    return [normalizePieceType(trimmed)];
  }

  return [];
}

const getAuthUser = async (req) => {
  if (!req.user?.id) return null;
  return prisma.utilisateurs.findUnique({
    where: { id: Number(req.user.id) },
    include: {
      agents: true,
      utilisateur_roles: {
        include: { roles: true },
      },
    },
  });
};

const hasBuyerRole = (user) =>
  (user?.utilisateur_roles || []).some((ur) => normalizeName(ur.roles?.nom) === "acheteur");

const getBuyerUserIdsByEntite = async (entiteId) => {
  const id = Number(entiteId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const users = await prisma.utilisateurs.findMany({
    where: { agents: { entite_id: id } },
    include: {
      utilisateur_roles: {
        include: { roles: true },
      },
    },
  });

  return Array.from(
    new Set(
      users
        .filter(hasBuyerRole)
        .map((u) => Number(u.id))
        .filter((u) => Number.isFinite(u) && u > 0)
    )
  );
};

const formatAchat = (achat) => ({
  ...achat,
  acheteur: achat.utilisateurs
    ? {
        id: achat.utilisateurs.id,
        email: achat.utilisateurs.email,
        agent: achat.utilisateurs.agents,
      }
    : null,
});

const getPagination = (req) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const getAchatsEnAttente = async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user || !hasBuyerRole(user)) {
      return res.status(403).json({ message: "Profil acheteur requis." });
    }

    const entiteId = user.agents?.entite_id;
    if (!entiteId) {
      return res.status(400).json({ message: "Acheteur sans entite rattachee." });
    }

    const { page, limit, skip } = getPagination(req);
    const q = cleanName(req.query.q).toLowerCase();
    const where = {
      statut: "paye",
      deleted_at: null,
      agents: { entite_id: Number(entiteId) },
      achats: null,
      ...(q
        ? {
            OR: [
              { motif: { contains: q } },
              { beneficiaire: { contains: q } },
              { agents: { nom: { contains: q } } },
            ],
          }
        : {}),
    };

    const [demandes, total] = await Promise.all([
      prisma.demandes_paiement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date_creation: "desc" },
        include: {
          agents: {
            include: {
              entites: true,
              sections: true,
            },
          },
          proformas: true,
          paiements: { include: { documents_paiements: true } },
        },
      }),
      prisma.demandes_paiement.count({ where }),
    ]);

    return res.status(200).json({
      demandes,
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    console.error("Erreur getAchatsEnAttente:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const getAchatsEffectues = async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user || !hasBuyerRole(user)) {
      return res.status(403).json({ message: "Profil acheteur requis." });
    }

    const entiteId = user.agents?.entite_id;
    if (!entiteId) {
      return res.status(400).json({ message: "Acheteur sans entite rattachee." });
    }

    const { page, limit, skip } = getPagination(req);
    const q = cleanName(req.query.q).toLowerCase();
    const where = {
      acheteur_id: Number(user.id),
      demandes_paiement: {
        deleted_at: null,
        agents: { entite_id: Number(entiteId) },
        ...(q
          ? {
              OR: [
                { motif: { contains: q } },
                { beneficiaire: { contains: q } },
                { agents: { nom: { contains: q } } },
              ],
            }
          : {}),
      },
    };

    const [achats, total] = await Promise.all([
      prisma.achats.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date_achat: "desc" },
        include: {
          preuves_achat: true,
          utilisateurs: { include: { agents: true } },
          demandes_paiement: {
            include: {
              agents: {
                include: {
                  entites: true,
                  sections: true,
                },
              },
              paiements: { include: { documents_paiements: true } },
            },
          },
        },
      }),
      prisma.achats.count({ where }),
    ]);

    return res.status(200).json({
      achats: achats.map(formatAchat),
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    console.error("Erreur getAchatsEffectues:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const effectuerAchat = async (req, res) => {
  const demandeId = Number(req.params.demande_id);
  const commentaire = cleanName(req.body.commentaire);
  const { date: dateAchat, error: dateAchatError } = parseDateAchatInput(req.body.date_achat);
  const files = collectAchatFiles(req);
  const pieceTypes = collectAchatTypes(req);

  if (!demandeId) {
    return res.status(400).json({ message: "ID de demande invalide." });
  }

  if (dateAchatError) {
    return res.status(400).json({ message: dateAchatError });
  }

  if (dateAchat && dateAchat.getTime() > Date.now()) {
    return res.status(400).json({ message: "La date d'achat ne peut pas etre dans le futur." });
  }

  if (!files.length) {
    return res.status(400).json({ message: "Au moins une preuve d'achat est obligatoire." });
  }

  try {
    const user = await getAuthUser(req);
    if (!user || !hasBuyerRole(user)) {
      return res.status(403).json({ message: "Profil acheteur requis." });
    }

    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: demandeId },
      include: { agents: true, achats: true },
    });

    if (!demande || demande.deleted_at) {
      return res.status(404).json({ message: "Demande non trouvee." });
    }

    if (demande.statut !== "paye") {
      return res.status(409).json({ message: "Cette demande n'est plus en attente d'achat." });
    }

    if (Number(demande.agents?.entite_id) !== Number(user.agents?.entite_id)) {
      return res.status(403).json({ message: "Demande hors de votre entite." });
    }

    if (demande.achats) {
      return res.status(409).json({ message: "L'achat a deja ete traite." });
    }

    const uploaded = [];
    for (const [index, file] of files.entries()) {
      const url = fileToPublicUrl(req, file);
      if (!url) continue;
      const typeFromForm = normalizePieceType(pieceTypes[index]);
      uploaded.push({
        url,
        nom_fichier: file.originalname || null,
        type: typeFromForm || file.mimetype || "autre",
      });
    }

    if (!uploaded.length) {
      return res.status(400).json({ message: "Aucune preuve exploitable recue." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.demandes_paiement.updateMany({
        where: {
          id: demandeId,
          statut: "paye",
        },
        data: { statut: "achat_effectue" },
      });

      if (updated.count !== 1) {
        throw new Error("ACHAT_ALREADY_HANDLED");
      }

      const achat = await tx.achats.create({
        data: {
          demande_id: demandeId,
          acheteur_id: Number(user.id),
          commentaire: commentaire || null,
          ...(dateAchat ? { date_achat: dateAchat } : {}),
          preuves_achat: {
            create: uploaded,
          },
        },
        include: {
          preuves_achat: true,
          utilisateurs: { include: { agents: true } },
        },
      });

      return achat;
    });

    try {
      await notifyAchatEffectue({ demandeId, achat: result, files });
    } catch (mailError) {
      console.warn("Notification achat effectue non envoyee:", mailError?.message || mailError);
    }

    try {
      const stakeholderUserIds = await getStakeholderUserIdsByDemandeId(demandeId);
      if (stakeholderUserIds.length) {
        await createNotificationsForUsers({
          utilisateurIds: stakeholderUserIds,
          demandeId,
          message: formatDemandeInAppMessage(
            demandeId,
            "ACHAT EFFECTUE",
            "Achat confirme avec preuves disponibles."
          ),
        });
      }
    } catch (notifyError) {
      console.warn("Notif in-app achat effectue (non bloquant):", notifyError?.message || notifyError);
    }

    try {
      const buyerUserIds = await getBuyerUserIdsByEntite(demande.agents?.entite_id);
      notifyUsersDataRefreshed(buyerUserIds, {
        source: "achat_effectue",
        demandeId,
      });
    } catch (refreshError) {
      console.warn("Refresh live acheteurs non declenche:", refreshError?.message || refreshError);
    }

    return res.status(201).json({
      message: "Achat confirme avec succes.",
      achat: formatAchat(result),
    });
  } catch (error) {
    if (error?.message === "ACHAT_ALREADY_HANDLED" || error?.code === "P2002") {
      return res.status(409).json({ message: "L'achat a deja ete traite." });
    }
    console.error("Erreur effectuerAchat:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

const getAchatByDemande = async (req, res) => {
  const demandeId = Number(req.params.demande_id);
  if (!demandeId) return res.status(400).json({ message: "ID de demande invalide." });

  try {
    const achat = await prisma.achats.findUnique({
      where: { demande_id: demandeId },
      include: {
        preuves_achat: true,
        utilisateurs: { include: { agents: true } },
      },
    });

    if (!achat) return res.status(404).json({ message: "Achat non trouve." });

    return res.status(200).json({ achat: formatAchat(achat) });
  } catch (error) {
    console.error("Erreur getAchatByDemande:", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};

module.exports = {
  getAchatsEnAttente,
  getAchatsEffectues,
  effectuerAchat,
  getAchatByDemande,
};
