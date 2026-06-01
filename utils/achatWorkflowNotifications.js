const { PrismaClient } = require("@prisma/client");
const { envoyerEmail } = require("../config/emailConfig");
const {
  formatDemandeMailSubject,
  formatDemandeMailTitleHtml,
  formatDemandeInAppMessage,
} = require("./demandeMailFormat");
const {
  createNotificationsForUsers,
  notifyUsersDataRefreshed,
} = require("./inAppNotifications");

const prisma = new PrismaClient();

const clean = (value) => String(value || "").trim();

const normalizeName = (value) =>
  clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, " ");

const uniqueEmails = (emails = []) => {
  const seen = new Set();
  const out = [];
  for (const raw of emails) {
    const email = clean(raw);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
};

const hasBuyerRole = (user) =>
  (user?.utilisateur_roles || []).some(
    (ur) => normalizeName(ur?.roles?.nom) === "acheteur"
  );

const getBuyerUsers = async (entiteId) => {
  const where = {};
  if (entiteId != null) {
    where.agents = { entite_id: Number(entiteId) };
  }

  const users = await prisma.utilisateurs.findMany({
    where,
    include: {
      agents: true,
      utilisateur_roles: { include: { roles: true } },
    },
  });

  return users.filter(hasBuyerRole);
};

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

const getFrontendBaseUrl = () =>
  clean(process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL) ||
  "https://achats.greenpayci.com";

const appLienDemande = (id) =>
  `${getFrontendBaseUrl().replace(/\/+$/, "")}/demandes/${id}`;

const notifyAcheteursDemandeEnAttenteAchat = async ({ demandeId }) => {
  const id = Number(demandeId);
  if (!Number.isFinite(id) || id <= 0) {
    return { sent: false, reason: "invalid_demande_id" };
  }

  const demande = await prisma.demandes_paiement.findUnique({
    where: { id },
    include: {
      agents: {
        include: {
          entites: true,
          sections: true,
          utilisateurs: true,
        },
      },
    },
  });

  if (!demande || demande.deleted_at) {
    return { sent: false, reason: "demande_not_found" };
  }

  const entiteId = demande?.agents?.entite_id;
  if (entiteId == null) {
    return { sent: false, reason: "demande_without_entite" };
  }

  const buyerUsers = await getBuyerUsers(entiteId);

  const recipients = uniqueEmails(buyerUsers.map((u) => u.email));
  if (!recipients.length) {
    return { sent: false, reason: "no_buyer_email" };
  }
  const buyerUserIds = buyerUsers
    .map((u) => Number(u.id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const demandeur = clean(demande?.agents?.nom) || "Demandeur";
  const lien = appLienDemande(demande.id);

  const subject = formatDemandeMailSubject(demande.id, "EN ATTENTE D'ACHAT");
  const mailTitle = formatDemandeMailTitleHtml(demande.id);
  const html = `
    <p>Bonjour,</p>
    ${mailTitle}
    <p>Une demande est en <strong>attente d'achat</strong> :</p>
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <tr><td><strong>Demande</strong></td><td>#${demande.id}</td></tr>
      <tr><td><strong>Demandeur</strong></td><td>${escapeHtml(demandeur)}</td></tr>
      <tr><td><strong>Entite</strong></td><td>${escapeHtml(demande?.agents?.entites?.nom || "-")}</td></tr>
      <tr><td><strong>Section</strong></td><td>${escapeHtml(demande?.agents?.sections?.nom || "-")}</td></tr>
      <tr><td><strong>Beneficiaire</strong></td><td>${escapeHtml(demande?.beneficiaire || "-")}</td></tr>
      <tr><td><strong>Montant</strong></td><td>${formatMontant(demande?.montant)}</td></tr>
      <tr><td><strong>Motif</strong></td><td>${escapeHtml(demande?.motif || "-")}</td></tr>
    </table>
    <p><a href="${escapeHtml(lien)}">Voir la demande</a></p>
    <p>Cordialement,<br/>GreenPay CI</p>
  `;

  const sends = await Promise.allSettled(
    recipients.map((email) => envoyerEmail(email, subject, html, [], []))
  );
  const successCount = sends.filter((s) => s.status === "fulfilled").length;

  await createNotificationsForUsers({
    utilisateurIds: buyerUserIds,
    demandeId: demande.id,
    message: formatDemandeInAppMessage(
      demande.id,
      "EN ATTENTE D'ACHAT",
      "Action requise pour les acheteurs de la direction."
    ),
  });

  notifyUsersDataRefreshed(buyerUserIds, {
    source: "achat_pending",
    demandeId: demande.id,
  });

  if (!successCount) {
    return { sent: false, reason: "email_send_failed", recipients: recipients.length };
  }

  return { sent: true, recipients: recipients.length, successCount };
};

module.exports = {
  notifyAcheteursDemandeEnAttenteAchat,
};
