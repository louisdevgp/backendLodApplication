// config/emailConfig.js
const nodemailer = require("nodemailer");

/**
 * Office 365 (Exchange Online) — SMTP AUTH
 * ⚠️ Prérequis côté Microsoft 365 :
 * - SMTP AUTH activé au niveau du tenant ET sur la boîte (Authenticated SMTP)
 * - Authentification par mot de passe d’application si MFA activé
 * - L’adresse `FROM` correspond à la BAL ou dispose de "Send As"
 */
const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false,               // STARTTLS
  requireTLS: true,            // upgrade TLS obligatoire
  auth: {
    user: process.env.NODEMAILER_USER,      // ex: prenom.nom@domaine.com
    pass: process.env.NODEMAILER_PASSWORD,  // mot de passe (ou App Password si MFA)
  },
  // Pool = meilleures perfs si plusieurs envois
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  // Timeouts généreux pour éviter les coupures en charge
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 60_000,
  // TLS “safe” (O365 exige au moins TLS 1.2)
  tls: {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    // servername utile derrière certains proxys
    servername: "smtp.office365.com",
  },
  // Active ces deux options en DEV pour voir les échanges SMTP :
  logger: process.env.SMTP_DEBUG === "true",
  debug: process.env.SMTP_DEBUG === "true",
});

/** Vérifie la connexion SMTP au démarrage (log OK/KO) */
async function verifySmtp() {
  try {
    await transporter.verify();
    console.log("[SMTP] OK: connexion Office365 vérifiée");
  } catch (e) {
    console.error("[SMTP] ÉCHEC verify():", e);
  }
}
verifySmtp().catch(() => {});

/**
 * Normalise les pièces jointes (ignore valeurs falsy) :
 * - Chaque item: { filename, path, contentType? }
 */
function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map(a => {
      if (!a) return null;
      const filename = a.filename || "fichier";
      if (!a.path) return null;
      return { filename, path: a.path, contentType: a.contentType };
    })
    .filter(Boolean);
}

/**
 * ✅ Envoi d'email (HTML + fallback texte), CC/BCC optionnels, PJ
 * @param {string|string[]} to
 * @param {string} subject
 * @param {string} html
 * @param {Array} attachments
 * @param {string[]|undefined} cc
 * @param {string[]|undefined} bcc
 * @param {string|undefined} replyTo
 * @returns {Promise<{messageId:string,response:string}>}
 */
async function envoyerEmail(
  to,
  subject,
  html,
  attachments = [],
  cc = [],
  bcc = [],
  replyTo = undefined
) {
  const from = process.env.NODEMAILER_USER; // ⚠️ doit correspondre à la BAL O365
  const atts = normalizeAttachments(attachments);

  // Fallback texte lisible
  const text = html
    ? html.replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
    : undefined;

  const mailOptions = {
    from,
    to,
    cc: cc && cc.length ? cc : undefined,
    bcc: bcc && bcc.length ? bcc : undefined,
    subject,
    html,
    text,
    attachments: atts.length ? atts : undefined,
    replyTo,
  };

  console.log("📧 Envoi email →", { to, cc, bcc, subject, pj: atts.length });
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email envoyé", { to, messageId: info?.messageId, response: info?.response });
    return { messageId: info?.messageId, response: info?.response };
  } catch (error) {
    // Logs explicites sur les erreurs Office365 fréquentes
    // 535 5.7.3/5.7.57 => Auth fail / SMTP AUTH disabled
    // 550 5.7.60 => SendAs denied
    // 454 4.7.0 => Throttling / too many attempts
    console.error("❌ Erreur envoi email:", {
      code: error?.code,
      command: error?.command,
      response: error?.response,
      responseCode: error?.responseCode,
      message: error?.message,
    });
    throw error;
  }
}

module.exports = { envoyerEmail };
