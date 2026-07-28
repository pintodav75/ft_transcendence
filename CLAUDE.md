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
- **Backend** : **terminé et fonctionnel** — auth (JWT typés, OAuth Google, 2FA, profil, avatar), social (amis, blocks, chat WS, DM, conversations), teams (CRUD + membres + édition + **cycle d'invitation B-INV** : `POST /teams/{id}/members` **supprimée**, remplacée par inviter / annuler / accepter / refuser / `GET /teams/invitations/me`, index unique **partiel** sur les `pending`, plafond `membres + en attente ≤ 10` sous verrous consultatifs triés), matchmaking complet (créer/accepter/annuler/résultat/ELO), **score Bo3 + delta d'Elo persistés par match (B14)**, **historique de match d'une équipe (B15, `GET /teams/{id}/matches`) + garde de `GET /matches/{id}` relâchée sur un match `completed`**, disputes + arbitrage, notifications (10 types), recherche avancée, jobs 24 h. **[B12] mergé le 28/07** (commit `531344f`, merge `487036b`) : `POST /auth/2fa/verify` compte ses essais **par compte visé par le tempToken**, plus par IP — montage à **deux étages** (plancher 30/min par IP en `onRequest` + 5/min par compte appelé à la main dans le handler via `server.createRateLimit()`). ⚠️ **Ne jamais remonter ce comptage dans un hook** : `hook: 'preValidation'` laisse passer les corps illisibles **sans aucun comptage**, et un second `server.rateLimit()` en hook est **neutralisé silencieusement** (symbole `rateLimitRan` partagé). ⚠️ **Pas de `trustProxy`** : `req.ip` est l'IP de **socket**, donc tout le trafic navigateur arrive par le conteneur front et **partage une seule adresse** — un compteur par IP est un point d'étranglement pour toute la plateforme, jamais une limite par utilisateur. **[B13] mergé le 28/07** (commit `fd69624`, merge `b499833`) : `POST /auth/refresh` rend **204** sans cookie (la ligne rouge que Chrome écrivait sur chaque page anonyme était un motif de rejet) et **purge** le cookie sur un refus, pour que ce 401 ne se répète pas indéfiniment — mais **pas** sur une panne (la vérification JWT a son propre `try` : purger sur une coupure de base déconnecterait durablement tout le monde). → `docs/backend.md`
- **Frontend** : F0, F0-A/B/C/D, FR1 Register, FR2 Login+2FA, F-Nav (teams + ranking), FL landing publique, **FT-1 + FT-1B** (`/teams`, mergés le 26/07 dans `640248b`) — **mergés**. **FT-2A** (`/teams/$teamId` en consultation) **mergé le 27/07** (commit `478c62b`, merge `9ef6406`). **FT-2B** (onglet Manage capitaine : renommer, logo, ajouter, exclure, dissoudre + Leave team) **mergé le 27/07** (commit `d7c6f93`, merge `6746e81`). **FT-INV** (invitations d'équipe) **mergé le 28/07** (commit `0108084`, merge `ab9a4c6`) — juste après **B-INV** (commit `ad97df0`, merge `a724fe4`), les deux **dos à dos** parce que B-INV supprime une route que le front de FT-2B appelait. **FT-2C** (ouvrir et annuler un créneau de match depuis la page équipe) **mergé le 28/07** (commit `1d74b90`, merge `f0e2369`) — le cycle challenge/accept est désormais atteignable à la souris. Restent à remplir : `/home`, `/games`, `/profile`, `/privacy`, `/terms`, et les 3 placeholders posés par FT-2A (`/players/$pseudo`, `/matches/$matchId`, `/ladders/$ladderId`). → `docs/frontend.md`
- **Tests** : `npm run audit` (audit console Chrome) sort **0 sans filtre** depuis FT-2A — **9 scénarios, 107 checks** (FT-2C a ajouté `teams-matchmaking`, 15 checks). ⚠️ **`run.mjs` accepte un nom de scénario en argument** : pendant qu'on itère on filtre, la suite complète ne se lance **qu'à la fin** — une passe complète pilote un vrai Chrome sur 8 parcours et c'est le poste de temps dominant d'un ticket front. Vitest 27/27 (helpers purs) + **20 suites e2e Python / 753 cas** (run B-INV du 27/07) (`cd backend/tests && python3 run_all.py`), sans mocks, sur la vraie base de dev. ⚠️ Les users de test sont **semés en SQL** avec un token forgé (la route `register` reste à 3/min, rien n'est désactivé) : `test_sentinel.py` garde ce couplage, `test_auth_contract.py` couvre la vraie route. → `backend/tests/README.md`

📄 Historique des merges et décisions datées → **`docs/journal.md`**

### Prochaines actions

- 🔧 **LOT DE FIX EN COURS (décision David, 28/07)** : avant d'attaquer FT-3, on vide la liste Trello **Issues / bug fixes**, une carte à la fois — branche → `reviewer-*` → merge. Ordre : ~~**[B12]**~~ ✅ mergé · ~~**[B13]**~~ ✅ mergé · **[BX-DEL]** suppression de compte (porte une migration, https://trello.com/c/dx25Y99Y) · **[FX-FOCUS]** (https://trello.com/c/Yf8oRHCD) · **[FX-MIDNIGHT]** (https://trello.com/c/L9GCUBkQ). **[B12B]** (https://trello.com/c/xC70Wqjf) est née de la review de B12 et n'est **pas** dans ce lot. **Un seul message Discord pour tout le lot, à la fin.**

- **FT-2 a été découpé en trois le 27/07** (le ticket unique mélangeait lecture, 5 mutations et un composant de confirmation inexistant). Maquette de référence commune : **`vsmode-team-detail-demo.html`** à la racine — ⚠️ sa propre bande de stats y est illisible (son `.a-scrim` la recouvre), ce n'est pas un écart à corriger.
  - **[FT-2A]** https://trello.com/c/8EdedO3e — consultation. **MERGÉ** (commit `478c62b`, merge `9ef6406`).
  - **[FT-2B]** https://trello.com/c/tmgQGBVz — gestion capitaine. **LIVRÉ** (confirm-dialog réutilisable, onglet Manage, 5 mutations, Leave team). Écarts assumés vs la carte : la recherche « add member » est **par préfixe** sur `GET /search?q=&type=user` (et non « pseudo exact » : la contrainte décrivait l'ancienne route `/users/{pseudo}`, dont le 404 produisait une erreur console) ; le bouton **`Edit team` de l'en-tête a été retiré** (l'onglet Manage n'est visible que du capitaine, le bouton doublait la navigation).
  - **[FT-2C]** https://trello.com/c/LnSfRghd — créer / annuler un match depuis la page équipe. **MERGÉ le 28/07** (commit `1d74b90`, merge `f0e2369`). ⚠️ **Deux règles CSS globales ajoutées** dans `index.css` : `color-scheme: dark` (sans elle la liste native d'un `<select>` est blanc sur blanc) et `scrollbar-gutter: stable` (la colonne centrale est en `flex-1` donc fluide, le rail se resserrait/réélargissait à chaque changement d'onglet). **Conséquence : la colonne centrale fait désormais 601 px à 1280, plus 616** — à budgéter dans tout ticket portant une table large. ⚠️ Le lockout est **pré-empté côté client** : `|t − s| < lockoutMinutes`, **inégalité stricte** (21h et 22h en 5v5 restent tous les deux ouverts, 21h30 non) ; `lockoutMinutes` vient de `GET /ladders`, jamais du format.
- **Invitations d'équipe — [B-INV] + [FT-INV] mergés le 28/07.** Rejoindre une équipe n'est plus un ajout forcé : le capitaine **invite**, le joueur **accepte ou refuse**. Front livré : « Invite a player », puces **« Pending »** dans `RosterChips` (annuler ≠ exclure), compteur **`Roster slots`** incluant les invitations, `excludeIds` élargi aux invités, mapping d'erreurs sur les **`code` stables** (`openapi.yaml` → `TeamInvitationError` ; **ne jamais parser la prose `error`**), bloc « Team invitations » sur `/teams`, `components/ui/callout.tsx` extrait. ⚠️ **Écart assumé vs la carte** : la réponse aux invitations vit sur **`/teams`**, pas sur `/profile` (stub) — le composant est **sans props et fait sa propre query**, donc remontable tel quel sur `/profile` et dans le rail social. **Rail social / icône notifications hors périmètre** (cartes FS-0→5). ⚠️ **Deux compteurs volontairement différents** : l'en-tête dit `Roster N/10` en comptant les **membres** (il est **public** : un visiteur ne peut pas compter des invitations qu'il n'a pas le droit de voir), l'onglet Manage dit `Roster slots` en comptant le **plafond**.
  - **PROCHAIN TICKET : [FT-3]** https://trello.com/c/6yZLPjpP — page d'un ladder (règles, pool de maps, classement complet). ⚠️ Aucune route n'expose aujourd'hui le pool de maps d'un ladder : à confirmer, sinon petit ticket back en amont. ⚠️ **Le briefer sur 601 px de colonne centrale, pas 616** (voir FT-2C) : c'est un ticket à table large.
- **Composants** : stratégie tranchée le 27/07 — un composant **sans connaissance du domaine** part tout de suite dans `components/ui/` ; tout le reste est extrait au **second usage réel**, par le ticket du second consommateur (détail et inventaire dans `docs/frontend.md`). **Chaque brief de `coder-front` doit porter la consigne de réutilisation** (interdiction de recopier les classes Tailwind d'un composant existant).
- **Front (reste)** : `/profile` ; liaison de compte (`LinkAccountBanner`) ; pages match + notifications ; rail social (voir mémoire F-Social). *(Les puces file upload et le câblage de la recherche sur `GET /search` sont faits — FT-2B ; le composant vit maintenant dans `components/search/UserSearch.tsx`.)* **Deux dettes d'accessibilité mesurées à ticketer** : `text-text-muted` sur carte = 4,23:1 (sous AA, 45 usages dans 25 fichiers → ticket design system) et l'historique de matchs qui laisse 262 px hors champ à 375 px (rendu en cartes sous `sm`).
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
10. **`npm run audit` sort 0 sans filtre** depuis FT-2A : une entrée console nouvelle est donc **imputable au ticket en cours**, plus noyée dans le bruit. Une erreur réseau *provoquée volontairement* par un scénario se déclare avec `expectHttp(motif, raison)` — cloisonnée à sa phase, flux réseau uniquement. ⚠️ Un `exit 2` = harnais en échec, **jamais** « console propre ».
11. **`routeTree.gen.ts` et `api-types.gen.ts` sont générés, jamais édités à la main** — mais leur statut git diffère : `routeTree.gen.ts` est **gitignoré** (régénéré au build) ; `api-types.gen.ts` est **tracké** et doit être **committé à chaque régénération** (invariant #8). ⚠️ Erreur vécue : cette ligne affirmait à tort les deux gitignorés, ce qui a fait sauter la régénération sur B14 — vérifier avec `git ls-files`/`git check-ignore` avant de faire confiance à un souvenir sur le statut d'un fichier généré.

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
