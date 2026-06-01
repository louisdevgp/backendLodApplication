const clean = (value) => String(value || "").trim();

const demandeRef = (demandeId) => `ACHAT - DEMANDE #${demandeId}`;

const formatDemandeMailSubject = (demandeId, action = "") => {
  const ref = demandeRef(demandeId);
  const act = clean(action).toUpperCase();
  return act ? `${ref} - ${act}` : ref;
};

const formatDemandeMailTitleHtml = (demandeId) =>
  `<p style="margin:0 0 12px;font-weight:700;text-transform:uppercase;">${demandeRef(demandeId)}</p>`;

const formatDemandeInAppMessage = (demandeId, action = "", detail = "") => {
  const ref = demandeRef(demandeId);
  const act = clean(action).toUpperCase();
  const info = clean(detail);
  if (act && info) return `${ref} - ${act} - ${info}`;
  if (act) return `${ref} - ${act}`;
  if (info) return `${ref} - ${info}`;
  return ref;
};

module.exports = {
  demandeRef,
  formatDemandeMailSubject,
  formatDemandeMailTitleHtml,
  formatDemandeInAppMessage,
};
