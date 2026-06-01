const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient()
const {envoyerEmail} = require("../config/emailConfig")
const { formatDemandeMailSubject, formatDemandeMailTitleHtml } = require("./demandeMailFormat");



const envoyerNotification = async (utilisateur_id, demande_id, message) => {
    try {
        // RÃ©cupÃ©rer l'email de l'utilisateur concernÃ©
        const utilisateur = await prisma.utilisateurs.findUnique({
            where: { id: utilisateur_id },
            select: { email: true }
        });

        if (!utilisateur) {
            console.warn("âŒ Utilisateur non trouvÃ© pour la notification.");
            return;
        }

        // Envoyer l'email
        const sujet = formatDemandeMailSubject(demande_id, "NOTIFICATION");
        const mailTitle = formatDemandeMailTitleHtml(demande_id);
        const html = `
          <p>Bonjour,</p>
          ${mailTitle}
          ${message || ""}
        `;
        await envoyerEmail(utilisateur.email, sujet, html);
    } catch (error) {
        console.error("âŒ Erreur lors de l'envoi de la notification par email :", error);
    }
};

async function envoyerFichiersParMail(demandeId) {
  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: demandeId },
      include: {
        agents: {
          include: {
            utilisateurs: true,
            agents: { include: { utilisateurs: true } }, // supÃ©rieur direct
          },
        },
        paiements: {
          include: {
            documents_paiements: true,
          },
        },
        proformas: true,
      },
    });

    if (!demande) {
      console.warn("âŒ Demande introuvable pour envoi mail");
      return;
    }

    // ðŸ“¦ Construction de la liste des fichiers
    const fichiers = [];

    if (demande.demande_physique_signee_url) {
      fichiers.push({ label: "Fichier signÃ© (REG)", url: demande.demande_physique_signee_url });
    }

    for (const paiement of demande.paiements) {
      for (const doc of paiement.documents_paiements) {
        fichiers.push({ label: `Preuve de paiement (${doc.type})`, url: doc.url });
      }
    }

    for (const proforma of demande.proformas) {
      fichiers.push({ label: "Proforma", url: proforma.fichier });
    }

    if (fichiers.length === 0) {
      console.warn("âš ï¸ Aucun fichier Ã  envoyer par e-mail.");
      return;
    }

    // ðŸ§‘â€ðŸ’¼ RÃ©cupÃ©ration des e-mails des parties prenantes
    const emails = new Set();

    if (demande.agents.utilisateurs?.email) {
      emails.add(demande.agents.utilisateurs.email); // Demandeur
    }

    if (demande.agents.agents?.utilisateurs?.email) {
      emails.add(demande.agents.agents.utilisateurs.email); // SupÃ©rieur direct
    }

    // âœ… Tu peux ajouter ici plus d'e-mails Ã  notifier (ex: DG, DAF...)

    if (emails.size === 0) {
      console.warn("âŒ Aucun e-mail Ã  notifier.");
      return;
    }

    // âœ‰ï¸ Envoi dâ€™e-mail avec les fichiers


        const subject = formatDemandeMailSubject(demandeId, "FICHIERS ASSOCIES");
    const mailTitle = formatDemandeMailTitleHtml(demandeId);
    const html = `
      <p>Bonjour,</p>
      ${mailTitle}
      <p>Voici les fichiers lies a cette demande :</p>
      <ul>
        ${fichiers.map(f => `<li><strong>${f.label}:</strong> <a href="${f.url}">${f.url}</a></li>`).join("")}
      </ul>
      <p>Cordialement,<br/>GreenPay CI</p>
    `;

    const recipients = Array.from(emails);
    const to = recipients[0];
    const cc = recipients.slice(1);
    await envoyerEmail(to, subject, html, [], cc);
    console.log("âœ… E-mail envoyÃ© avec succÃ¨s aux parties prenantes.");
  } catch (error) {
    console.error("ðŸš¨ Erreur lors de l'envoi d'e-mail :", error);
  }
}

module.exports = { envoyerNotification, envoyerFichiersParMail };



