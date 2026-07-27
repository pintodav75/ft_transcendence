# Modules 42 — détail

> Extrait de CLAUDE.md (refacto 25/07). Détail complet des 11 modules revendiqués, du module le plus fragile et des candidats de réserve.

## 🧩 Modules choisis (16 points)

| Module                                         | Type  | Points | État                                   |
| ---------------------------------------------- | ----- | ------ | -------------------------------------- |
| Frameworks front + back                        | Major | 2      | ✅                                     |
| Standard user management                       | Major | 2      | ✅                                     |
| Real-time WebSocket                            | Major | 2      | ✅ (chat)                              |
| User interaction (chat + profil + amis)        | Major | 2      | ✅                                     |
| **Organization system** (= nos **teams**, B5a + B-Org) | Major | **2**  | ✅ **vérifié PDF 22/07** — remplace Game stats |
| ORM (Drizzle)                                  | Minor | 1      | ✅                                     |
| OAuth 2.0                                      | Minor | 1      | ✅                                     |
| 2FA TOTP                                       | Minor | 1      | ✅                                     |
| File upload                                    | Minor | 1      | ✅ **complet** — back (T1, 24/07) + puces front (FT-2B, 27/07) |
| Notification system                            | Minor | 1      | ✅ **B9 + #53 + B11** (match, dispute, amis, équipe) |
| **Advanced search**                            | Minor | **1**  | ✅ **vérifié PDF 22/07** — `GET /search` (filtres + tri + pagination) |
| **TOTAL**                                      |       | **16** |                                        |

### File upload — COMPLET (back 24/07, front 27/07)

✅ **Les puces FRONT sont livrées par FT-2B** (27/07) et le module est **démontrable en soutenance**. Elles vivent toutes dans **`frontend/src/components/ui/image-picker.tsx`**, composant contrôlé et réutilisable : *validation client* (allowlist `image/jpeg|png|webp` et plafond de 2 Mo, en écho de la garde serveur — un mauvais fichier est refusé **sans aucun aller-retour réseau**, ce que le scénario d'audit prouve avec `countRequests` à 0), *aperçu local* via `URL.createObjectURL` (révoqué au démontage), et *barre de progression* réelle alimentée par `XMLHttpRequest.upload.onprogress` — c'est la raison d'être de `frontend/src/lib/upload.ts` : `fetch` n'a **aucun** événement de progression d'envoi.

Il est câblé à deux endroits : la création d'équipe (FT-1C) et le logo d'équipe de l'onglet Manage (FT-2B, avec le retrait du logo via `PATCH { logoUrl: null }`).

**Ce qu'il reste de fragile** (rappel du sujet, à re-vérifier avant la soutenance) :

Le sujet est explicite : *« You will be asked to demonstrate each claimed module. Only fully functional and properly implemented modules will be counted. **Non-functional or incomplete modules = 0 points.** »*

✅ **Les deux trous back sont bouchés — T1 mergé le 24/07** (branche `fix/file-upload-delete-avatar-pdf`, commit `b2a0c80`, merge `e187480`) :

- *« **Ability to delete uploaded files** »* → **`DELETE /users/me/avatar`** : supprime l'objet MinIO **et** remet `avatar_url` à `NULL`, **idempotente** (sans avatar, renvoie l'user inchangé). ⚠️ L'échec de suppression MinIO est **loggé en `warn`, pas propagé** : on préfère un objet orphelin dans le bucket à un utilisateur bloqué avec un avatar qu'il ne peut plus retirer. Le front retombe sur l'avatar par défaut dès que `avatarUrl` est `NULL`.
- *« Support multiple file types (images, documents, etc.) »* → l'allowlist MIME partagée `MIME_TO_EXT` est **scindée en deux** : `IMAGE_MIME` (avatar : jpeg/png/webp **uniquement**) et `EVIDENCE_MIME` (preuves de dispute : images **+ `application/pdf`**). 🔑 **Ne jamais les refusionner** : un avatar est forcément une image, une preuve de litige peut être un document. C'est le seul découpage qui satisfait le sujet sans absurdité produit.

⚠️ **Ce qui reste : les puces FRONT du module** (validation côté client, aperçu avant envoi, indicateur de progression) — aucune n'est faite, et le bouton « Upload Avatar » de la page team est encore un `alert` stub. Le module ne sera démontrable qu'une fois ces puces livrées.

⚠️ **L'option de repli tient toujours** : le sujet décrit un vrai **système de gestion de fichiers**, on a un avatar et des preuves de litige. Si le front coince, **l'échanger contre « Custom design system »** (voir candidats de réserve) reste bien moins cher — on garde 16 pts dans les deux cas.

### 🚨 Pourquoi « Game stats & match history » a disparu

**Décision du 13/07 : il n'y aura PAS de jeu jouable dans l'app.** Or le sujet (v21.1, vérifié 23/07) l'exige pour ce module — _« You cannot claim this module without a functional game »_. La plateforme ne fait que **tracker des jeux externes** (LoL / CS2 / chess.com via liaison de compte) → le module est **invalidable**.

Sans remplacement, l'équipe tombait à **13 points → sous la barre des 14 → projet rejeté.**

Il est remplacé par **Organization system** (Major, 2 pts) : créer/éditer/supprimer des organisations et gérer leurs membres — c'est **exactement** ce que font nos teams (B5a : création, roster, capitaine, kick/quit, dissolution). Au 13/07 on le croyait **gratuit** — en réalité l'**édition** manquait : elle a coûté un ticket (**B-Org**, `PATCH /teams/:id`). Le module est complet depuis.

✅ **Vérifié contre le PDF du sujet (David, 22/07)** : « Organization system » est bien un **Major à 2 points** et notre implémentation teams y répond. Le sujet exige *create, **edit**, delete* — l'édition manquait, elle a été livrée par **B-Org** (`PATCH /teams/:id`, merge `3be19b7`). **Les 15 points sont confirmés**, ne plus écrire « sous réserve » à propos de ce module.

⚠️ La réserve **reste entière pour les candidats de réserve ci-dessous** : leurs intitulés et exigences datent de la lecture du 04/07 et n'ont pas été revérifiés.

### Candidats de réserve (marge)

- **Advanced permissions / roles** (Major, 2 pts) — ❌ **PLUS quasi gratuit : le PDF a tranché (22/07), `is_admin` NE SUFFIT PAS.** Le sujet exige *« Roles management (admin, user, guest, moderator, etc.) »*, *« different views and actions based on user role »* **et** un CRUD complet sur les users (view/edit/delete). Il faudrait de vrais rôles assignables + les vues associées → **vrai chantier**, pas un bonus.
- **Public API** (Major, 2 pts) — 20+ endpoints, rate-limit et `openapi.yaml` déjà là ; il manquerait une **clé d'API**. ⚠️ Le seul qui coûte du **vrai code neuf** → à ne prendre que s'il reste du temps.
- **Custom design system** (1) — 🎯 **le candidat le moins cher qui reste** : le sujet demande **10 composants réutilisables minimum** + palette, typographie et icônes. `components/ui/` en compte déjà 9-10 (avatar, button, card, form-message, icon-menu-item, input, label, menu-item, password-input) et `index.css` porte tokens de couleurs, polices, radius et shadows ; lucide fournit les icônes. **Surtout à documenter dans le README**, quasi rien à coder.
- GDPR (1) — ⚠️ **plus loin qu'il n'y paraît** : la suppression de compte existe, mais le sujet exige AUSSI l'**export des données dans un format lisible**, la demande de ses données, et des **emails de confirmation** (aucune infra mail dans le projet).
- i18n (1) — 3 langues complètes + sélecteur ; les sélecteurs EN/FR/ES existent dans l'UI mais **ne sont pas câblés**. *(Advanced search est **compté dans le tableau** depuis le 22/07, il n'est plus en réserve.)*

---

