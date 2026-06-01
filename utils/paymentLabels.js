const PAYMENT_METHOD_LABELS = {
  cheque: "Chèque",
  mobile_money: "Mobile Money",
  especes: "Espèces",
  virement_bancaire: "Virement bancaire",
  carte_recharge: "Carte de recharge",
};

const PAYMENT_METHOD_VALUES = Object.keys(PAYMENT_METHOD_LABELS);

const formatPaymentMethodLabel = (method) => {
  const key = String(method || "").trim().toLowerCase();
  if (!key) return "—";
  return PAYMENT_METHOD_LABELS[key] || key.replace(/_/g, " ");
};

module.exports = {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_VALUES,
  formatPaymentMethodLabel,
};
