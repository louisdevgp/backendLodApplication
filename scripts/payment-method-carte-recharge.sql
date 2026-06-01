ALTER TABLE paiements
MODIFY moyen_paiement ENUM(
  'cheque',
  'mobile_money',
  'especes',
  'virement_bancaire',
  'carte_recharge'
) NOT NULL;
