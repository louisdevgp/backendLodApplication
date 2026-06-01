-- Migration schema: devgp_gpOld.sql (prod actuelle) -> devgp_gp.sql (dev modifiee)
-- Date: 2026-06-01
-- Variante one-shot (sans IF NOT EXISTS sur ALTER, compatible serveurs SQL plus stricts)
-- Important: faire un backup avant execution.

-- =========================================================
-- 1) demandes_paiement: etendre statut + ajouter colonne note
-- =========================================================
ALTER TABLE `demandes_paiement`
  MODIFY COLUMN `statut` ENUM(
    'validation_section',
    'validation_entite',
    'validation_entite_finance',
    'validation_entite_generale',
    'approuve',
    'paye',
    'achat_effectue',
    'cloture',
    'rejete',
    'en_attente_paiement'
  ) DEFAULT 'validation_section';

ALTER TABLE `demandes_paiement`
  ADD COLUMN `note` TEXT NULL AFTER `demande_physique_signee_url`;

-- =========================================================
-- 2) paiements: etendre enum moyen_paiement (carte_recharge)
-- =========================================================
ALTER TABLE `paiements`
  MODIFY COLUMN `moyen_paiement` ENUM(
    'cheque',
    'mobile_money',
    'especes',
    'virement_bancaire',
    'carte_recharge'
  ) NOT NULL;

-- =========================================================
-- 3) nouvelles tables achats / preuves_achat
-- =========================================================
CREATE TABLE `achats` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `demande_id` INT(11) NOT NULL,
  `acheteur_id` INT(11) NOT NULL,
  `commentaire` TEXT DEFAULT NULL,
  `date_achat` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_achat_demande` (`demande_id`),
  KEY `idx_achats_acheteur` (`acheteur_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `preuves_achat` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `achat_id` INT(11) NOT NULL,
  `type` VARCHAR(100) DEFAULT 'autre',
  `url` VARCHAR(255) NOT NULL,
  `nom_fichier` VARCHAR(255) DEFAULT NULL,
  `date_ajout` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_preuves_achat` (`achat_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =========================================================
-- 4) contraintes FK achats / preuves_achat
-- =========================================================
ALTER TABLE `achats`
  ADD CONSTRAINT `fk_achats_demande` FOREIGN KEY (`demande_id`)
    REFERENCES `demandes_paiement` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_achats_acheteur` FOREIGN KEY (`acheteur_id`)
    REFERENCES `utilisateurs` (`id`) ON DELETE CASCADE;

ALTER TABLE `preuves_achat`
  ADD CONSTRAINT `fk_preuves_achat` FOREIGN KEY (`achat_id`)
    REFERENCES `achats` (`id`) ON DELETE CASCADE;

-- =========================================================
-- 5) controles post-migration (sans information_schema)
-- =========================================================
SHOW CREATE TABLE `demandes_paiement`;
SHOW CREATE TABLE `paiements`;
SHOW CREATE TABLE `achats`;
SHOW CREATE TABLE `preuves_achat`;
