# Modules 42 — détail

> Extrait de CLAUDE.md (refacto 25/07). Détail complet des 14 modules revendiqués, du module le plus fragile et des candidats de réserve.

> ⚠️ **Mis à jour le 4 août 2026** : le tableau passe à **21 points revendiqués** — le README livré
> ce jour-là ajoute les **2 modules qui ne coûtaient aucun code** (custom design system, et le
> cycle compétitif en *module of choice*). 🚨 **Le plafond de notation reste 19** : les 2 points
> au-dessus sont une **marge**, pas un gain — voir la note sous le tableau.

## 🧩 Modules choisis (21 points revendiqués, 19 comptabilisables)

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
| **Advanced search**                            | Minor | **1**  | ✅ **vérifié PDF 22/07** — `GET /search` (filtre par type + pagination, tri alphabétique global) |
| **Accessibilité WCAG 2.1 AA**                  | Major | **2**  | ✅ **VALIDÉ le 01/08** — voir ci-dessous |
| **Custom design system**                       | Minor | **1**  | ✅ **revendiqué le 04/08 par le README** — 26 composants dans `components/ui/` (le sujet en demande 10) + tokens couleurs/polices/radius/ombres dans `index.css` + icônes lucide. **Aucun code écrit pour ce module.** |
| **Module of choice — le cycle compétitif**     | Major | **2**  | ✅ **revendiqué le 04/08 par le README** — challenge/accept + Elo transactionnel + litiges + jobs 24 h, qu'**aucun** module de la liste ne couvre. Les **4 justifications exigées** (pourquoi ce module, difficultés techniques, valeur, pourquoi Major) sont rédigées dans le README, section 8. |
| **TOTAL**                                      |       | **21** | plafond comptabilisable : **19**       |

### 🚨 Le plafond de notation est 19 points, pas plus

Chapitre VII du sujet : le bonus n'est compté que **jusqu'à 5 points au-dessus des 14** requis.
**19 est donc le maximum comptabilisable.** À 21 revendiqués, les **2 derniers points ne rapportent
rien** — mais viser au-delà reste utile comme **marge** si un module n'est pas validé en
soutenance, ce que le sujet conseille explicitement (« aiming for more than 14 points may be a
good idea, especially if some modules aren't validated »).

### Accessibilité WCAG 2.1 AA — VALIDÉ le 1er août 2026

Le sujet demande : *« Complete accessibility compliance (WCAG 2.1 AA) with screen reader support,
keyboard navigation, and assistive technologies »* (Major, 2 pts).

**Ce qui était déjà là** (livré au fil des tickets front, pas pour ce module) : 92 `aria-label`,
55 `role="status"`, 4 régions live, un lien d'évitement, une gestion explicite du focus — et
surtout un **harnais d'audit qui teste** la restauration du focus (`awaitFocusRestored`) et les
annonces vocales (`awaitAnnouncement`), donc des preuves rejouables en soutenance.

**La mise en conformité du 1er août**, en deux passes — 🚨 **la seconde est celle qui compte** :

1. **`axe-core`**, filtré sur les tags `wcag2a/2aa/21a/21aa`, sur 17 routes × 2 largeurs + 4 états
   interactifs (tiroir mobile, panneau social, deux formulaires en erreur) → **0 violation**.
2. **Les critères qu'`axe` ne sait pas mesurer**, vérifiés à la main. **Les 4 défauts réels
   viennent tous de là, aucun n'a été vu par l'outil** :
   - 🚨 **2.4.2 « Page Titled », niveau A** (donc en dessous même du AA revendiqué) : **un seul
     titre « VS MODE » pour 13 routes**. → `frontend/src/lib/page-title.ts`.
   - **1.4.11** : bordure des champs de saisie à **1,44:1** au lieu de 3:1 → token
     `--color-border-control` (3,02–3,50:1), réservé aux **contrôles**.
   - **1.4.11** : bordure du bouton primaire à 2,53–2,93:1 → `#6266b8` (3,34:1).
   - **1.4.10** : à **320 px** — le seuil exact de la norme, pas 375 — les onglets faisaient
     scroller la page entière.

**Propres sans intervention** : zoom texte 200 %, espacement de texte imposé, focus visible
(25 arrêts de tabulation, 0 sans indicateur), aucun piège clavier, contraste de tous les textes
(après le passage de `--color-text-muted` à `#78849e` le même jour).

**Ce qui reste volontairement sous 3:1, et la réponse à donner en soutenance** : `border-subtle` ne
borde plus que **cartes et séparateurs** — de la décoration, explicitement exemptée de 1.4.11 ; les
boutons sans bordure ni fond s'identifient par leur **libellé à 8,44:1**, ce qui relève de 1.4.3
(qui passe) ; et les deux derniers boutons mesurés appartiennent aux **devtools TanStack**, qui
rendent `null` hors développement (vérifié dans le paquet, pas supposé).

📄 Récit complet, tableau avant/après et scripts de mesure → `docs/frontend.md`, section
`[A11Y-AA]`.

### File upload — COMPLET (back 24/07, front 27/07)

✅ **Les puces FRONT sont livrées par FT-2B** (27/07) et le module est **démontrable en soutenance**. Elles vivent toutes dans **`frontend/src/components/ui/image-picker.tsx`**, composant contrôlé et réutilisable : *validation client* (allowlist `image/jpeg|png|webp` et plafond de 2 Mo, en écho de la garde serveur — un mauvais fichier est refusé **sans aucun aller-retour réseau**, ce que le scénario d'audit prouve avec `countRequests` à 0), *aperçu local* via `URL.createObjectURL` (révoqué au démontage), et *barre de progression* réelle alimentée par `XMLHttpRequest.upload.onprogress` — c'est la raison d'être de `frontend/src/lib/upload.ts` : `fetch` n'a **aucun** événement de progression d'envoi.

Il est câblé à deux endroits : la création d'équipe (FT-1C) et le logo d'équipe de l'onglet Manage (FT-2B, avec le retrait du logo via `PATCH { logoUrl: null }`).

**Ce qu'il reste de fragile** (rappel du sujet, à re-vérifier avant la soutenance) :

Le sujet est explicite : *« You will be asked to demonstrate each claimed module. Only fully functional and properly implemented modules will be counted. **Non-functional or incomplete modules = 0 points.** »*

✅ **Les deux trous back sont bouchés — T1 mergé le 24/07** (branche `fix/file-upload-delete-avatar-pdf`, commit `b2a0c80`, merge `e187480`) :

- *« **Ability to delete uploaded files** »* → **`DELETE /users/me/avatar`** : supprime l'objet MinIO **et** remet `avatar_url` à `NULL`, **idempotente** (sans avatar, renvoie l'user inchangé). ⚠️ L'échec de suppression MinIO est **loggé en `warn`, pas propagé** : on préfère un objet orphelin dans le bucket à un utilisateur bloqué avec un avatar qu'il ne peut plus retirer. Le front retombe sur l'avatar par défaut dès que `avatarUrl` est `NULL`.
- *« Support multiple file types (images, documents, etc.) »* → l'allowlist MIME partagée `MIME_TO_EXT` est **scindée en deux** : `IMAGE_MIME` (avatar : jpeg/png/webp **uniquement**) et `EVIDENCE_MIME` (preuves de dispute : images **+ `application/pdf`**). 🔑 **Ne jamais les refusionner** : un avatar est forcément une image, une preuve de litige peut être un document. C'est le seul découpage qui satisfait le sujet sans absurdité produit.

⚠️ **Ces deux paragraphes disaient encore, au 31/07, que « les puces FRONT ne sont pas faites » et
qu'il fallait prévoir un repli — c'était périmé depuis FT-2B (27/07) et contredit par le haut de
cette même section.** Supprimé le 01/08. Le module est complet et démontrable ; « Custom design
system » n'est plus un **repli** mais un **module de plus** à prendre (voir candidats de réserve).

### 🚨 Pourquoi « Game stats & match history » a disparu

**Décision du 13/07 : il n'y aura PAS de jeu jouable dans l'app.** Or le sujet (v21.1, vérifié 23/07) l'exige pour ce module — _« You cannot claim this module without a functional game »_. La plateforme ne fait que **tracker des jeux externes** (LoL / CS2 / chess.com via liaison de compte) → le module est **invalidable**.

Sans remplacement, l'équipe tombait à **13 points → sous la barre des 14 → projet rejeté.**

Il est remplacé par **Organization system** (Major, 2 pts) : créer/éditer/supprimer des organisations et gérer leurs membres — c'est **exactement** ce que font nos teams (B5a : création, roster, capitaine, kick/quit, dissolution). Au 13/07 on le croyait **gratuit** — en réalité l'**édition** manquait : elle a coûté un ticket (**B-Org**, `PATCH /teams/:id`). Le module est complet depuis.

✅ **Vérifié contre le PDF du sujet (David, 22/07)** : « Organization system » est bien un **Major à 2 points** et notre implémentation teams y répond. Le sujet exige *create, **edit**, delete* — l'édition manquait, elle a été livrée par **B-Org** (`PATCH /teams/:id`, merge `3be19b7`). **Les 15 points sont confirmés**, ne plus écrire « sous réserve » à propos de ce module.

⚠️ La réserve **reste entière pour les candidats de réserve ci-dessous** : leurs intitulés et exigences datent de la lecture du 04/07 et n'ont pas été revérifiés.

### Candidats de réserve (marge)

- **Advanced permissions / roles** (Major, 2 pts) — ❌ **PLUS quasi gratuit : le PDF a tranché (22/07), `is_admin` NE SUFFIT PAS.** Le sujet exige *« Roles management (admin, user, guest, moderator, etc.) »*, *« different views and actions based on user role »* **et** un CRUD complet sur les users (view/edit/delete). Il faudrait de vrais rôles assignables + les vues associées → **vrai chantier**, pas un bonus.
- **Public API** (Major, 2 pts) — 20+ endpoints, rate-limit et `openapi.yaml` déjà là ; il manquerait une **clé d'API**. ⚠️ Le seul qui coûte du **vrai code neuf** → à ne prendre que s'il reste du temps.
- ~~**Custom design system** (1)~~ — ✅ **REVENDIQUÉ le 04/08**, il est passé dans le tableau ci-dessus. Historique de la décision : c'était **le candidat le moins cher qui restait** : le sujet demande **10 composants réutilisables minimum** + palette, typographie et icônes. `components/ui/` en compte déjà 9-10 (avatar, button, card, form-message, icon-menu-item, input, label, menu-item, password-input) et `index.css` porte tokens de couleurs, polices, radius et shadows ; lucide fournit les icônes. **Surtout à documenter dans le README**, quasi rien à coder.
- GDPR (1) — ⚠️ **plus loin qu'il n'y paraît** : la suppression de compte existe, mais le sujet exige AUSSI l'**export des données dans un format lisible**, la demande de ses données, et des **emails de confirmation** (aucune infra mail dans le projet).
- i18n (1) — 3 langues complètes + sélecteur ; les sélecteurs EN/FR/ES existent dans l'UI mais **ne sont pas câblés**. *(Advanced search est **compté dans le tableau** depuis le 22/07, il n'est plus en réserve.)*

---

