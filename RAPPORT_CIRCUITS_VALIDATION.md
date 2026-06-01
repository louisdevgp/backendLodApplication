# Rapport Check Circuit Validation (Par User)

- Genere le: 2026-05-26T11:39:12.839Z
- Utilisateurs analyses: 12

## Reponse Rapide
- Oui, le circuit est bien scope "par direction" (entite) pour les etapes section/entite.
- Pour un profil Agent, la demande part en `validation_section`, puis `validation_entite`, puis `validation_entite_generale`.
- Ensuite le flux passe par les operations REG/REF/paiement (routes de modification), puis achat.

## Circuits Par Profil
| Profil | Statut initial | Circuit |
|---|---|---|
| Agent | validation_section | validation_section -> validation_entite -> validation_entite_generale -> en_attente_paiement -> paye -> achat_effectue |
| Responsable de section | validation_entite | validation_entite -> validation_entite_generale -> en_attente_paiement -> paye -> achat_effectue |
| Responsable d'entite | validation_entite_generale | validation_entite_generale -> en_attente_paiement -> paye -> achat_effectue |
| REG | validation_entite_finance | validation_entite_finance -> (transition non explicite dans validationController) |
| REF | validation_entite_generale | validation_entite_generale -> en_attente_paiement -> paye -> achat_effectue |

## Tableau Par User
| UserId | Email | Agent | Fonction | Direction/Entite | Section | Roles | Statut initial calcule | Validateur initial attendu | Peut approuver | Peut rejeter | Inbox pending |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | louis@greenpayci.com | Kouamé Koyé Louis Celestin | Agent | Entité Technique
 | Support & Développement	 | Agent
, Admin, Acheteur | validation_section | Kevin Ganlonon (Responsable de section, kevin@greenpayci.com) | - | - | - |
| 2 | jean-joseph@greenpayci.com | Guindo Jean-Joseph | Agent | Entité Technique
 | Support & Développement	 | Agent
 | validation_section | Kevin Ganlonon (Responsable de section, kevin@greenpayci.com) | - | - | - |
| 3 | clauvice@greenpayci.com | Yao Clauvice Vivien | Agent | Entité Technique
 | Réseau et Maintenance | Agent
 | validation_section | Coulibaly Emmanuel (Responsable de section, emmanuel@greenpayci.com) | - | - | - |
| 4 | wilfried@greenpayci.com | Koffi Wilfried | Agent | Entité Technique
 | Réseau et Maintenance | Agent
 | validation_section | Coulibaly Emmanuel (Responsable de section, emmanuel@greenpayci.com) | - | - | - |
| 5 | christian@greenpayci.com | Combey Christian | Agent | Entité Technique
 | Support & Développement	 | Agent
 | validation_section | Kevin Ganlonon (Responsable de section, kevin@greenpayci.com) | - | - | - |
| 6 | hermann@greenpayci.com | Ya Kouame Hermann | Agent | Entité Technique
 | Support & Développement	 | Agent
 | validation_section | Kevin Ganlonon (Responsable de section, kevin@greenpayci.com) | - | - | - |
| 7 | raphael@greenpayci.com | Yeti Raphael | Agent | Entité Technique
 | Réseau et Maintenance | Agent
, Acheteur | validation_section | Coulibaly Emmanuel (Responsable de section, emmanuel@greenpayci.com) | - | - | - |
| 8 | ornellas@greenpayci.com | Yao Ornella | Responsable de section | Entité Technique
 | Assistance | Responsable_de_section
 | validation_entite | Sidoine Nonwanon (Responsable d'entité, sidoines@greenpayci.com) | validation_section (meme section) | validation_section | validation_section |
| 9 | dorcas@greenpayci.com | Amon Dorcas | Agent | Entité Technique
 | Support & Développement	 | Agent
 | validation_section | Kevin Ganlonon (Responsable de section, kevin@greenpayci.com) | - | - | - |
| 10 | kevin@greenpayci.com | Kevin Ganlonon | Responsable de section | Entité Technique
 | Support & Développement	 | Responsable_de_section
 | validation_entite | Sidoine Nonwanon (Responsable d'entité, sidoines@greenpayci.com) | validation_section (meme section) | validation_section | validation_section |
| 11 | emmanuel@greenpayci.com | Coulibaly Emmanuel | Responsable de section | Entité Technique
 | Réseau et Maintenance | Responsable_de_section
 | validation_entite | Sidoine Nonwanon (Responsable d'entité, sidoines@greenpayci.com) | validation_section (meme section) | validation_section | validation_section |
| 12 | sidoines@greenpayci.com | Sidoine Nonwanon | Responsable d'entité | Entité Technique
 | - | Responsable_d'entité
 | validation_entite_generale | - | validation_entite (meme entite) | validation_entite | - |

## Ecarts A Verifier Dans Le Code
- `validation_entite_finance` est present dans le schema mais non gere comme etape d approbation dans `validationController` (a confirmer metier).
- La fonction `findNextValidatorsUsers` semble cibler `validation_entite` pour chercher des responsables entite, ce qui peut rater la notif attendue juste apres `validation_section`.