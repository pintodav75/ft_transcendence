# CLAUDE.md — ft_transcendence

> Contexte de session. **Volontairement court** : le détail vit dans `docs/`, à lire **à la demande** (voir « Index de la doc »).

---

## 🎯 Le projet

Projet final du Common Core 42, équipe de 4, sujet libre : une web app validant ≥ 14 points de modules.

**Concept : plateforme compétitive multi-jeux type GameBattle / LiveNplay** — profils, équipes, ladders ELO, soumission de résultats, disputes, chat/amis/notifications temps réel, pattern config-driven multi-jeux.

> 🚨 **PAS de file d'attente, PAS de worker de matchmaking automatique.** Modèle = **challenge/accept** : un camp ouvre un slot → un autre l'accepte → les deux entrent le score → l'ELO bouge. Aucun bouton « chercher une partie », aucun appariement par ELO. (Décision explicite de David, 13/07 — ne jamais la réintroduire.) Le cycle est **déjà implémenté** (B5b→B6).

> 🚨 **Pas de jeu jouable dans l'app** (décision 13/07) : la plateforme _tracke_ des jeux externes (LoL/CS2/chess.com via liaison de compte).

**Statut** : équipe de 4 formée, deadline courte → focus.

---

## 🧩 Modules — 16 points (seuil 14)

5 majors + 6 minors, **vérifiés contre le PDF v21.1** (audit 23/07) : frameworks front+back, user management, WebSocket temps réel, user interaction, **organization system** (= nos teams) | ORM Drizzle, OAuth 2.0, 2FA TOTP, file upload, notifications, **advanced search**.

- Tous **✅ back**. **File upload est désormais complet et démontrable** : les puces FRONT (validation client du type et des 2 Mo, aperçu, barre de progression) sont livrées par `components/ui/image-picker.tsx`, câblé sur le logo d'équipe par **FT-2B**. Le repli « Custom design system » n'est plus nécessaire.
- « Game stats & match history » est **mort** (exige un jeu fonctionnel) → remplacé par Organization system. **Ne jamais le ticketer.**

📄 Détail, exigences PDF et candidats de réserve → **`docs/modules.md`**

### 🚨 Motifs de REJET du projet (hors modules)

1. **Privacy Policy + ToS** non vides / non placeholder — aujourd'hui 8 lignes chacune → **projet rejeté en l'état**. Carte `[FT]`, rédigée **en toute fin** de projet.
2. **Zéro warning/erreur dans la console Chrome.**
3. **README complet** : Team Info, Project Management, Technical Stack, Database Schema, Features (qui a fait quoi), Modules + calcul de points, contributions individuelles, usage de l'IA.

Reste aussi la **préparation de la soutenance** (chaque module revendiqué doit être démontrable en live).

---

## 🛠️ Stack (résumé)

- **Front** : Vite 8 + React 19 + TS strict + Tailwind v4, TanStack Router (file-based) + Query, Zustand, RHF + Zod, lucide. WebSocket **natif** (le back utilise `ws`, **jamais** socket.io-client).
- **Back** : Fastify v5 / Node 24 LTS, TS strict ESM — `@fastify/websocket|multipart|jwt|cookie|oauth2|cors|rate-limit`, Drizzle ORM, Zod, bcryptjs, speakeasy, minio, redis.
- **Data** : PostgreSQL 17.10, Redis 8.8.0 (auth activée), MinIO (buckets `avatars` public / `evidence` privé).
- **Infra** : Docker/Podman Compose, **pas de Nginx**. **Origine navigateur UNIQUE `https://localhost:5173`** (Vite HTTPS) qui proxifie `/api/*` → backend et `/media/*` → MinIO. Fastify ne sert **jamais** le build front. `docker compose up -d --build` suffit après le `.env`.

📄 Versions, arborescence complète et détail des libs → **`docs/stack.md`**

---

## ✅ État d'avancement (résumé — 28 juillet 2026)

- **Infra** : I2 + I3 + I4 mergés. Origine unique HTTPS, proxy, certs auto, migrations auto, validation d'env Zod. → `docs/infra.md`
- **Backend** : **terminé et fonctionnel** — auth (JWT typés, OAuth Google, 2FA, profil, avatar), social (amis, blocks, chat WS, DM, conversations), teams (CRUD + membres + édition + **cycle d'invitation B-INV** : `POST /teams/{id}/members` **supprimée**, remplacée par inviter / annuler / accepter / refuser / `GET /teams/invitations/me`, index unique **partiel** sur les `pending`, plafond `membres + en attente ≤ 10` sous verrous consultatifs triés), matchmaking complet (créer/accepter/annuler/résultat/ELO), **score Bo3 + delta d'Elo persistés par match (B14)**, **historique de match d'une équipe (B15, `GET /teams/{id}/matches`) + garde de `GET /matches/{id}` relâchée sur un match `completed`**, disputes + arbitrage, notifications (10 types), recherche avancée, jobs 24 h. **[B12] mergé le 28/07** (commit `531344f`, merge `487036b`) : `POST /auth/2fa/verify` compte ses essais **par compte visé par le tempToken**, plus par IP — montage à **deux étages** (plancher 30/min par IP en `onRequest` + 5/min par compte appelé à la main dans le handler via `server.createRateLimit()`). ⚠️ **Ne jamais remonter ce comptage dans un hook** : `hook: 'preValidation'` laisse passer les corps illisibles **sans aucun comptage**, et un second `server.rateLimit()` en hook est **neutralisé silencieusement** (symbole `rateLimitRan` partagé). ⚠️ **Pas de `trustProxy`** : `req.ip` est l'IP de **socket**, donc tout le trafic navigateur arrive par le conteneur front et **partage une seule adresse** — un compteur par IP est un point d'étranglement pour toute la plateforme, jamais une limite par utilisateur. **[B13] mergé le 28/07** (commit `fd69624`, merge `b499833`) : `POST /auth/refresh` rend **204** sans cookie (la ligne rouge que Chrome écrivait sur chaque page anonyme était un motif de rejet) et **purge** le cookie sur un refus, pour que ce 401 ne se répète pas indéfiniment — mais **pas** sur une panne (la vérification JWT a son propre `try` : purger sur une coupure de base déconnecterait durablement tout le monde). **[BX-DEL] mergé le 28/07** (commit `392dfb3`, merge `607a63a`, **migration `0023`** → `docker compose restart backend` au prochain pull) : `match_participants.user_id` passe de `restrict` à `cascade` (le `restrict` rendait la suppression de compte impossible **à vie**, en 500, pour tout joueur ayant été aligné une fois) et `DELETE /users/me` porte la règle produit — **409 `engaged_in_match`** (match non terminé) ou **409 `captain_of_team`**. 🔑 **Le parcours de sortie est imposé : annuler ses matchs → dissoudre son équipe → supprimer son compte** (`DELETE /teams/:id` refuse aussi une équipe engagée, **`team_engaged_in_match`**). ⚠️ **Ne pas relâcher `captain_of_team`** : `teams.captain_id` est en CASCADE, le départ d'un capitaine effacerait l'équipe, son roster et sa ligne `rankings` sans notifier personne. → `docs/backend.md`
- **Frontend** : F0, F0-A/B/C/D, FR1 Register, FR2 Login+2FA, F-Nav (teams + ranking), FL landing publique, **FT-1 + FT-1B** (`/teams`, mergés le 26/07 dans `640248b`) — **mergés**. **FT-2A** (`/teams/$teamId` en consultation) **mergé le 27/07** (commit `478c62b`, merge `9ef6406`). **FT-2B** (onglet Manage capitaine : renommer, logo, ajouter, exclure, dissoudre + Leave team) **mergé le 27/07** (commit `d7c6f93`, merge `6746e81`). **FT-INV** (invitations d'équipe) **mergé le 28/07** (commit `0108084`, merge `ab9a4c6`) — juste après **B-INV** (commit `ad97df0`, merge `a724fe4`), les deux **dos à dos** parce que B-INV supprime une route que le front de FT-2B appelait. **FT-2C** (ouvrir et annuler un créneau de match depuis la page équipe) **mergé le 28/07** (commit `1d74b90`, merge `f0e2369`) — le cycle challenge/accept est désormais atteignable à la souris. **[F-Nav] rail gauche mergé le 29/07** (commit `4a5c4bb`, merge `822a6eb`) — voir *Prochaines actions*. Restent à remplir : `/home`, `/games`, `/profile`, `/privacy`, `/terms`, les 3 pages **vierges** créées par F-Nav (`/solo`, `/matchmaking`, `/history`) et les 3 placeholders posés par FT-2A (`/players/$pseudo`, `/matches/$matchId`). → `docs/frontend.md`
- **Tests** : `npm run audit` (audit console Chrome) sort **0 sans filtre** depuis FT-2A — **11 scénarios, 157 checks** (campagne complète rejouée verte le 29/07 après F-Nav, `f-nav` inclus) (FX-FOCUS a ajouté 5 checks de focus, tous **au clavier**). 🔑 **UNE seule région live `role="status"` par écran** (FX-FOCUS) : deux se disputent la lecture, et un sélecteur `[role="status"]` en `.first()` prend la première venue — les `Callout` ne portent plus le rôle, l'annonce passe par `lib/use-announcement.ts`. ⚠️ Une région live est **montée en permanence**, donc `waitFor()` sur sa seule présence n'attend RIEN : passer par **`awaitAnnouncement(texte)`** (invariant #11). ⚠️ **`run.mjs` accepte un nom de scénario en argument** : pendant qu'on itère on filtre, la suite complète ne se lance **qu'à la fin** — une passe complète pilote un vrai Chrome sur 10 parcours (~4 min depuis `RATE_LIMIT_FACTOR`) et c'est le poste de temps dominant d'un ticket front. Vitest 27/27 (helpers purs) + **20 suites e2e Python / 753 cas** (run B-INV du 27/07) (`cd backend/tests && python3 run_all.py`), sans mocks, sur la vraie base de dev. ⚠️ Les users de test sont **semés en SQL** avec un token forgé (la route `register` reste à 3/min, rien n'est désactivé) : `test_sentinel.py` garde ce couplage, `test_auth_contract.py` couvre la vraie route. → `backend/tests/README.md`

📄 Historique des merges et décisions datées → **`docs/journal.md`**

### Prochaines actions

- ✅ **LOT DE FIX TERMINÉ (28/07)** : les 5 cartes de *Issues / bug fixes* sont mergées — **[B12]** (rate limit 2FA par compte), **[B13]** (204 sur `/auth/refresh`), **[BX-DEL]** (suppression de compte, **migration `0023`**), **[FX-FOCUS]** (focus rendu après une suppression), **[FX-MIDNIGHT]** (jour incohérent à minuit). La liste ne contient plus que **[B12B]** (https://trello.com/c/xC70Wqjf), née de la review de B12 : `/2fa/enable` et `/2fa/disable` vérifient un code à 6 chiffres à 100/min, 20× le quota de `/verify`. ⚠️ **Au prochain pull : `docker compose restart backend`** (migration 0023).

- ✅ **[FT-3] MERGÉ le 28/07** (commit `715aa9c`, merge `65de356`) — page `/ladders/$ladderId` : identité + artwork, règles en clair, pool de maps servi par l'API, classement complet (joueurs **et** équipes), ligne de sa propre équipe surlignée. `GET /ladders/{id}` enrichi du **pool de maps du JEU** (même table que `POST /matches` : la page ne peut pas annoncer des maps que le serveur n'attribuera pas) ; section pilotée par la **donnée**, pas par une liste de jeux en dur — seuls **cs2 (7) et valorant (6)** ont des maps. `LadderRow` + `LadderBoard` extraits de `LadderExcerpt` (règle du second usage), helpers dans `lib/ladders.ts`, `ui/error-panel.tsx` extrait. ⚠️ **Le code venait d'un chat mobile, sans `coder-front` ni review** : le rapport `reviewer-front` (Opus) a sorti 3 bloquants + 9 non-bloquants, tous soldés avant merge. **3 écarts assumés, à ne pas « corriger » par erreur** :
  1. ⚠️ **La carte Trello ment sur une règle** : elle annonce « slot sans adversaire annulé au bout de 24 h ». **FAUX** — `cancelExpiredSlots` (`jobs/index.ts`) l'annule dès qu'il passe **sous `MIN_LEAD_MINUTES` (15 min) de son PROPRE coup d'envoi**, l'instant où plus personne ne peut l'accepter. Les 24 h de la règle « Score » sont un autre mécanisme (match joué mais non rapporté). C'est la règle du **code** qui est affichée.
  2. ⚠️ **`/ranking` SUPPRIMÉE** (page, route, `RankingTable`, entrée de nav) au lieu d'être migrée. Décision de David. **DETTE OUVERTE** : plus aucun point d'entrée vers un classement pour un compte **sans équipe** (`/games` est un stub, `play`/`find party` sont des `MenuItem` sans `to`). **Carte à ouvrir : entrée vers les ladders depuis `/games`.**
  3. ⚠️ **NI pagination NI conteneur défilant** — décision de David prise **avec la mesure** : à 200 compétiteurs la page fait **11 431 px (16 écrans)** pour 2941 nœuds DOM et 1278 ms. Le coût DOM n'est pas le sujet ; on accepte de descendre la page et on garde le **Ctrl+F sur tout le classement** (une pagination ferait atterrir un 137ᵉ sur une page 1 sans lui). Rationale figée dans le docblock de `LadderBoard.tsx`. **Ne pas re-ticketer avant qu'un ladder dépasse la centaine.**
  - 🔑 **Défaut invisible trouvé au passage** : à 375 px le nom du compétiteur était rendu **0 px de large** (tracks fixes + gaps + padding = 268 px d'une boîte de 276, avatar `shrink-0`), 73 px sortaient **en silence** car `LadderBoard` clippe. Le check de largeur ne pouvait pas le voir — il mesurait `documentElement`, il était **vert par construction**. Corrigé le check d'abord (`L9b` mesure la boîte ET la largeur rendue du nom), le défaut ensuite : sous `sm` les 3 nombres passent sous le nom via **`sm:contents`**, au-dessus la grille à 5 colonnes est restaurée à l'identique.

- ✅ **[F-Nav] MERGÉ le 29/07** (commit `4a5c4bb`, merge `822a6eb`) — rail gauche : wordmark, recherche, 6 items, bloc compte. **Livré une 1ʳᵉ fois sans suivre la maquette, puis RECODÉ** : `vsmode-home-demo.html` (`.left`/`.nav-item`/`.sep`) fait foi pour la **structure et les dimensions**, `index.css` pour couleurs/radius/ombres. Écarts corrigés : 288→**264 px**, `p-6`→**18/16**, wordmark 48 px italique→**30 px droit**, icônes 20→**16 px**, et la recherche sortie du `<nav>` (ce n'est pas un lien). 🔑 **La maquette contenait déjà la solution d'un défaut trouvé en review** : l'actif se distingue du survol par la **bordure** (`.nav-item.active` ajoute `border-color`, `:hover:not(.active)` ne la touche pas) — la 1ʳᵉ passe avait gardé le fond et jeté la bordure, rendant les deux états **identiques au pixel**.
  - **`ranking` SUPPRIMÉ** du rail (absent de la maquette) : ça règle du même coup le fait que `to="/ranking"` **cassait `npm run build` de master au merge** (route retirée par FT-3, branche basée avant).
  - **Décision : aucun item grisé.** Les 6 items naviguent ; `/solo`, `/matchmaking`, `/history` sont des **pages vierges** créées ici. ⚠️ `MenuItem` garde `muted`/`disabled` **sans appelant** — ce sont l'état `.off` de la maquette, un futur ticket les redemandera. La prop `params`, elle, a été **supprimée** (morte ET non sûre : le wrapper cassait l'appariement `to`/`params`).
  - ⚠️ **`AuthNav` n'est PAS un composant du rail** : `LandingNav` le monte aussi, sur la **landing publique**. Piège vécu — le `<ConfirmDialog>` de déconnexion était rendu sans garde, donc son `<h2>` « Log out » était le **premier titre du DOM** d'un visiteur anonyme, avant le `<h1>`. Il est désormais sous `{isLogged && …}`, et `LandingNav` est passé de `<nav>` à **`<aside>`** (il *contient* une navigation, il n'en est pas une). **Toute modif d'`AuthNav` doit être vérifiée sur `/` autant que sur `/home`.**
  - ⚠️ **Lien d'évitement : jamais `sr-only` + `focus:not-sr-only`** — cette paire compile un `padding:0` de spécificité (0,2,0) qui **bat** `px-4`/`py-2` en (0,1,0) : le lien se rendait en 149 × 22 px, **sous les 24 px** de WCAG 2.5.8. Motif retenu : **translation** (`-translate-y-24` / `focus:translate-y-0`), sans conflit.
  - ⚠️ **`L7` de `ladder-detail` est scopé à `<main>` depuis ce ticket.** Il compte les mots `queue|matchmaking|auto-match` pour garder la décision produit challenge/accept — mais il balayait le **document entier**, et le rail persistant porte un item `Matchmaking` (le nom interne du cycle, `openapi.yaml` tague déjà `POST /matches` ainsi) sur **toutes** les pages authentifiées. Non scopé, il rendait rouge une page dont la copie est irréprochable. **Même piège pour tout check qui balaie la page : le rail est là aussi maintenant.**
  - 🔑 **Le scénario `f-nav.mjs` (18 checks) MESURE les 13 dimensions de la maquette** (`N4d`) : l'échelle dynamique de Tailwind v4 accepte n'importe quel nombre, donc `w-66` mal tapé en `w-64` passe lint **et** build en silence. Un critère visuel non mesuré n'est pas gardé.
- **Composants** : stratégie tranchée le 27/07 — un composant **sans connaissance du domaine** part tout de suite dans `components/ui/` ; tout le reste est extrait au **second usage réel**, par le ticket du second consommateur (détail et inventaire dans `docs/frontend.md`). **Chaque brief de `coder-front` doit porter la consigne de réutilisation** (interdiction de recopier les classes Tailwind d'un composant existant).
- **Front (reste)** : `/profile` ; liaison de compte (`LinkAccountBanner`) ; pages match + notifications ; rail social (voir mémoire F-Social). *(Les puces file upload et le câblage de la recherche sur `GET /search` sont faits — FT-2B ; le composant vit maintenant dans `components/search/SearchBar.tsx`, qui a **absorbé `UserSearch`** en F-Nav et sert le rail **et** `TeamInvitePlayer`.)* **Deux dettes d'accessibilité mesurées à ticketer** : `text-text-muted` sur carte = 4,23:1 (sous AA, 45 usages dans 25 fichiers → ticket design system) et l'historique de matchs qui laisse 262 px hors champ à 375 px (rendu en cartes sous `sm`).
- **Cartes à ouvrir après F-Nav** (aucune n'est bloquante, toutes sont argumentées) : ① **`server.ts:119` déclare `max: 100` en LITTÉRAL** au lieu de `rlMax(100)` → `RATE_LIMIT_FACTOR` ne s'applique pas au limiteur global, et `GET /ladders` étant **anonyme** (clé `ip:`, pas de `trustProxy`), tout le trafic navigateur partage **un seul seau de 100/min** — c'est la source des 429 en campagne (invariant #13). ② **`/home` et `/games` sont des stubs** (`<div>a faire</div>`, un `<h3>` sans `<h1>`) **moins finis** que les 3 pages vierges créées par F-Nav, et le rail les met à un clic depuis partout. ③ **Rail en `hidden lg:flex`** : sous 1024 px, ni navigation ni moyen de se déconnecter. ④ **`landing-public.mjs` L4 est une tautologie** (`step('L4', true, …)`) qui visait le sélecteur de langue, supprimé par F-Nav : check mort.
- **Back** : vérification des comptes externes (OAuth Steam/Riot → `verified=true`), présence chat vers Redis (optionnel).
- **Branche en attente** : `feature/b10-player-count` (`80c675b`) — code **fini et vert**, non mergé. **Ne pas recoder**, rebaser puis merger.

---

## 🔑 Invariants à ne jamais casser

1. **Cookie refresh** : back pose `Path=/auth`, le proxy Vite le réécrit en `Path=/api/auth`, le front tape `/api/auth/*`. Les 3 forment un tout — en casser un casse **silencieusement** la restauration de session. Options centralisées dans `backend/src/auth/cookies.ts`.
2. **Notifications** : `notify()` INSÈRE **dans la transaction métier**, `pushNotifications()` pousse **après le commit**. Règle produit : on notifie le camp concerné, **jamais l'acteur** ; en 2v2+ seulement les joueurs **alignés** (banc exclu).
3. **Fenêtres de temps** : inégalités **strictes** (`<`, jamais `<=`) — deux matchs qui se touchent (21h–22h / 22h–23h) ne se chevauchent pas, c'est le cas d'usage central (enchaînement dos à dos).
4. **`scheduled_at` est LA référence temporelle** ; `started_at` n'est **lu par aucune règle**.
5. **Params d'URL validés par Zod** avant toute requête Drizzle, **après** `authenticate` (anonyme → 401, jamais 400). Malformé → **400**, bien formé mais absent → **404**.
6. **Jamais de `select()` nu** sur `users` : projection explicite (fuite `email`/`passwordHash`).
7. **`IMAGE_MIME` et `EVIDENCE_MIME` restent séparés** : un avatar est une image, une preuve de dispute peut être un PDF.
8. **Contrat API** : `openapi.yaml` est la source de vérité ; **régénérer `frontend/src/lib/api-types.gen.ts`** après toute modif. Ne **jamais** importer les types du backend côté front (ils décrivent la DB). ⚠️ `scheduledAt` arrive en **string ISO**, pas en `Date`.
9. **Type-check front** : `npx tsc --noEmit` est un **faux vert** (fichier solution + `references`). Utiliser **`npx tsc -b --noEmit`** ou `npm run build`.
10. **`npm run audit` sort 0 sans filtre** depuis FT-2A : une entrée console nouvelle est donc **imputable au ticket en cours**, plus noyée dans le bruit. Une erreur réseau *provoquée volontairement* par un scénario se déclare avec `expectHttp(motif, raison)` — cloisonnée à sa phase, flux réseau uniquement. ⚠️ Un `exit 2` = harnais en échec, **jamais** « console propre ». ⚠️ **NE JAMAIS ÉCRIRE UN FICHIER SOUS `frontend/` PENDANT UNE CAMPAGNE** (même un `.md`, même hors du graphe de modules) : Vite déclenche un **full reload**, la SPA rebootstrape (`/auth/refresh` + `/users/me` + toutes les queries de la page) et retombe sur l'onglet par défaut. Vécu le 28/07 : `teams-manage` a pris un `B14b` rouge à 6 requêtes **puis** un `locator.focus` expiré à 30 s (le bouton « Kick » n'existe que dans l'onglet Manage) → **exit 2**. Le même scénario seul : 35/35 en 23,7 s. Le rapport accuse le **ticket**, jamais l'éditeur — d'où le coût de diagnostic. Éditer la doc **après** le run, ou lancer un scénario filtré.

11. **Lire une région live : TOUJOURS `awaitAnnouncement(texte)`** (helper du `runner.mjs`, exposé à chaque scénario). ⚠️ La règle « attendre le texte, pas la présence » était déjà écrite ici et a **quand même produit 2 faux rouges** (`ft1c` 4.1b, `teams-manage` B13c-bis) — parce qu'une règle en prose ne s'applique pas toute seule. Elle est donc désormais **outillée** : `page.locator('[role=status]').waitFor()` rend la main **immédiatement** (la région est montée en permanence) et on lit soit du vide, soit **l'annonce précédente**. ⚠️ **`focusLanding()` est un INSTANTANÉ synchrone** — il n'attend ni le focus ni l'annonce : appeler `awaitAnnouncement()` **avant** lui (attendre un texte ne déplace pas le focus, donc ne fausse pas la mesure). ⚠️ **Leçon de méthode** : ces 2 courses étaient **latentes depuis toujours** et se gagnaient uniquement parce que la campagne dormait entre scénarios (attentes de quota) ; `RATE_LIMIT_FACTOR` a supprimé ce sommeil et les a fait tomber d'un coup. **Un rouge qui apparaît en campagne mais reste vert en isolation est une course du harnais, pas une régression du ticket** — chercher un `waitFor` qui n'attend rien avant d'accuser le code applicatif.
12. **`routeTree.gen.ts` et `api-types.gen.ts` sont générés, jamais édités à la main** — mais leur statut git diffère : `routeTree.gen.ts` est **gitignoré** (régénéré au build) ; `api-types.gen.ts` est **tracké** et doit être **committé à chaque régénération** (invariant #8). ⚠️ Erreur vécue : cette ligne affirmait à tort les deux gitignorés, ce qui a fait sauter la régénération sur B14 — vérifier avec `git ls-files`/`git check-ignore` avant de faire confiance à un souvenir sur le statut d'un fichier généré.

13. **`RATE_LIMIT_FACTOR` multiplie TOUS les quotas de l'API** (défaut 1, commit `9f5cdec`). Les quotas sont calibrés pour un humain, pas pour un harnais : l'audit console et les e2e Python passaient ~10 min par campagne à **attendre** la reconstitution des fenêtres (`awaitRegisterSlot` 3/min, `awaitGlobalQuota` 100/min), plus ~60 s à chaque relance filtrée. Toute route qui déclare un quota **doit** passer par `rlMax()` (`backend/src/utils/rate-limit.ts`) — un `max:` littéral oublié rend le harnais bloquant sur cette seule route, symptôme pénible à relier à sa cause. ⚠️ **Ce n'est PAS un interrupteur off** : plugin, hooks, clés de comptage et montage à deux étages de `/2fa/verify` inchangés, seul le nombre bouge (à 1000, `/auth/register` 429 toujours, au 3001ᵉ appel) — la mécanique reste démontrable en soutenance. ⚠️ **DOIT valoir 1 à la livraison** : `.env.example` est à 1, compose retombe sur 1 si la variable est absente, et le backend écrit un WARN à chaque démarrage tant que ce n'est pas le cas (`console.warn`, **pas** `server.log.warn` — le serveur est instancié sans `logger`, `server.log` est muet). ⚠️ Le `.env` local de David est à **1000** ; changer la valeur exige `docker compose up -d backend` (recréation), pas un simple `restart`. ⚠️ **Effet de bord à surveiller** : supprimer les pauses de quota supprime ~60 s de repos entre scénarios d'audit — suspect n°1 devant un check rouge **en campagne mais vert en isolation**. ⚠️ **Vérifié le 28/07** : ce n'était pas une régression mais **2 courses latentes du harnais** (`ft1c` 4.1b, `teams-manage` B13c-bis), corrigées par `awaitAnnouncement` — voir invariant #11.

📄 Les 21 pièges rencontrés, version longue et expliquée → **`docs/pieges.md`** (TOCTOU/verrous, ordre des verrous, tests de course **sans barrière ET sans balayage de décalage**, écritures par **cascade** hors inventaire, slots périmés, `.env`, WSL2, Drizzle…)

---

## 📋 Conventions

**Code** — TS strict partout, ESM, Node 24 (`nvm use`, `.nvmrc`). Imports nommés > default. Validation **Zod** systématique côté API. Front : tokens depuis `frontend/src/index.css` (aucune couleur/police/radius/shadow en dur dans les pages), composants de `components/ui`, imports `@/...`, icônes `lucide-react`. Lancer `npm run build` **et** `npm run lint` avant review.

**Tests** — côté **front**, la console sans warning est un motif de rejet : chaque ticket front a son scénario dans `frontend/tests/console-audit/scenarios/`, et `npm run audit` doit sortir **0** avant la review (⚠️ un code 2 = harnais en échec, pas un vert). Côté **back**, le scratchpad (`/tmp/claude-*/`) est réservé au vrai jetable : one-liner de debug, inspection ponctuelle. Dès qu'un script est relancé une 2ᵉ fois ou valide un comportement durable de l'API, il est **promu** dans `backend/tests/` : nom `test_<domaine>.py`, réutilisation de `helpers.py` (ne jamais réécrire login / création d'user / gestion de token), enregistrement dans `run_all.py`, ligne ajoutée dans le README. ⚠️ **Lire `backend/tests/README.md` avant d'écrire un test** : les suites existantes couvrent déjà largement l'API — le README liste ce que couvre chacune. Si le comportement y est, on l'exécute, on ne le recrée pas.

**Git** — dépôt de travail = **Git vogsphere 42** (pas de PR : review en local via `git diff master..<branche>`, jamais sa propre branche). Branches `feature/<code-ticket>-<sujet>` / `fix/<sujet>` en kebab-case. Commits **Conventional Commits**, atomiques, un ticket = un commit (squash). Pas de force push sur `master`. Identité git = identité 42. ⚠️ **Pas de trailer `Co-Authored-By: Claude`.**

**Docker** — env uniquement dans `.env` (`${VAR}` dans compose), bind mounts sous `./data/`, polling pour le hot reload (WSL2), images avec registre complet + version figée (jamais `latest`), `npm ci`.

**Sécurité** — `.env` jamais commité (`.env.example` versionné, obligatoire), HTTPS partout, validation front **et** back, Fastify écoute sur `0.0.0.0`.

---

## 🗂️ Organisation (Trello)

Board 4 colonnes **Todo / In Progress / Review / Done**. Une carte = ~1-3 j = une branche = une review. Review = diff relu par un coéquipier → merge sur `master` → carte en Done. Gabarit : titre (verbe + objet), description, Definition of Done, assigné, label (`backend`/`frontend`/`infra`/`docs`). **Planif le dimanche**, tickets de la semaine uniquement (backlog just-in-time).

---

## 💬 Style d'interaction

Équipe venue du **C**, débutante en TS/Node/Docker → explications claires, on veut le **pourquoi**, questions de clarification bienvenues.

⚠️ **Préférence par défaut (brahim, créateur du repo)** : **ne pas générer le code à sa place** — décrire les concepts + donner les commandes shell, il code lui-même.
⚠️ **David surcharge cette règle** : il veut le **code directement** quand il le demande ou bloque sur une syntaxe TS/JS. En cas de doute sur qui tu assistes, demander.

---

## 🔗 Commandes utiles

```bash
cd ~/ft_transcendence
nvm use                                 # Node 24 (.nvmrc)
docker compose up -d --build            # build + démarrage complet
docker compose ps / logs -f <service>   # état / logs
docker compose exec <service> sh        # entrer dans un conteneur
docker compose down                     # arrêter (garde les données)
docker compose down -v                  # supprime cert/node_modules ; garde ./data
cd backend && npm test                  # Vitest (helpers purs)
cd backend/tests && python3 run_all.py  # e2e (vraie base de dev)
```

**UIs locales** : Front **5173** (seule origine navigateur), Adminer 8080, redis-commander 8081, MinIO console 9001, backend direct 3000 (diagnostic).

---

## 📚 Index de la doc (lire à la demande)

| Fichier                   | Contenu                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `docs/schema.md`          | Design complet du domaine jeu (§5.1→§5.4, tables, state machine)                                             |
| `docs/backend.md`         | Détail par domaine : auth, social, teams, matchmaking, disputes, notifications, search, jobs + reste à faire |
| `docs/frontend.md`        | Détail par ticket : F0/F0-A/B/C/D, FR1, FR2, F-Nav, FL + règles front et dette                               |
| `docs/infra.md`           | I2/I3/I4 : proxy, certs, env, cookie, OAuth, médias                                                          |
| `docs/modules.md`         | Les 11 modules, exigences PDF, candidats de réserve                                                          |
| `docs/stack.md`           | Versions des libs + arborescence réelle du repo                                                              |
| `docs/pieges.md`          | Les 21 pièges rencontrés, version longue                                                                     |
| `docs/journal.md`         | Historique daté des merges et décisions                                                                      |
| `backend/tests/README.md` | Les suites e2e Python : ce que couvre chacune, helpers disponibles                                           |
| `frontend/tests/console-audit/README.md` | Audit console Chrome automatisé : lancer, écrire le scénario d'un ticket, la dette connue |

_Refacto du 25 juillet 2026 : CLAUDE.md est passé de 116 Ko à ~9 Ko ; rien n'a été perdu, tout le détail est dans `docs/`._
