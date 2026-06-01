ALTER TABLE demandes_paiement
MODIFY statut ENUM(
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

CREATE TABLE IF NOT EXISTS achats (
  id INT NOT NULL AUTO_INCREMENT,
  demande_id INT NOT NULL,
  acheteur_id INT NOT NULL,
  commentaire TEXT NULL,
  date_achat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_achat_demande (demande_id),
  KEY idx_achats_acheteur (acheteur_id),
  CONSTRAINT fk_achats_demande FOREIGN KEY (demande_id) REFERENCES demandes_paiement(id) ON DELETE CASCADE,
  CONSTRAINT fk_achats_acheteur FOREIGN KEY (acheteur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS preuves_achat (
  id INT NOT NULL AUTO_INCREMENT,
  achat_id INT NOT NULL,
  type VARCHAR(100) DEFAULT 'autre',
  url VARCHAR(255) NOT NULL,
  nom_fichier VARCHAR(255) NULL,
  date_ajout TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_preuves_achat (achat_id),
  CONSTRAINT fk_preuves_achat FOREIGN KEY (achat_id) REFERENCES achats(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO roles (nom) VALUES ('Admin'), ('Acheteur');

-- Bootstrap admin example, replace the email before running if needed:
-- INSERT IGNORE INTO utilisateur_roles (utilisateur_id, role_id)
-- SELECT u.id, r.id
-- FROM utilisateurs u
-- JOIN roles r ON r.nom = 'Admin'
-- WHERE u.email = 'admin@example.com';
