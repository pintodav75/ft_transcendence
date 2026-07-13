# CLAUDE.md — Projet ft_transcendence

> Fichier de contexte pour Claude Code. À lire en début de session.

---

## 🎯 Le projet

**ft_transcendence** — projet final du Common Core 42, en équipe de 4. Le sujet est **libre** : on construit une web app de notre choix qui valide ≥ 14 points via les modules.

**Concept choisi : plateforme compétitive multi-jeux type GameBattle**

- Profils utilisateurs, équipes
- Ladders par jeu avec ELO
- Matchmaking automatique (file d'attente, matching par skill)
- Soumission de résultats, système de disputes
- Chat, amis, notifications temps réel
- Pattern config-driven pour supporter plusieurs jeux

**Statut équipe** : ✅ équipe de 4 formée — début du travail de groupe (fin juin 2026). Deadline courte → focus, pas d'éparpillement.

---

## 🧩 Modules choisis (14 points)

| Module                                  | Type  | Points |
| --------------------------------------- | ----- | ------ |
| Frameworks front + back                 | Major | 2      |
| Standard user management                | Major | 2      |
| Real-time WebSocket                     | Major | 2      |
| User interaction (chat + profil + amis) | Major | 2      |
| ORM (Drizzle)                           | Minor | 1      |
| OAuth 2.0                               | Minor | 1      |
| 2FA TOTP                                | Minor | 1      |
| Game stats & match history              | Minor | 1      |
| File upload                             | Minor | 1      |
| Notification system                     | Minor | 1      |
| **TOTAL**                               |       | **14** |

Modules de réserve éventuels : Advanced search (1pt), Custom design system (1pt).

---

## 🛠️ Stack technique

**Frontend** : Vite 8 + React 19 + TypeScript + Tailwind v4 — _fondation F0 + F0-A + F0-B (routing & home) en place_

- ✅ **Fondation visuelle F0 mergée** : tokens Tailwind v4 dans `src/index.css`, composants UI de base (`Button`, `Input`, `Label`, `Card`), config shadcn-like `components.json`, alias `@/*`, helper `cn()`
- ✅ **F0-A implémenté et testé** : client API `fetch` + store auth Zustand (`user`, `accessToken`, `ready`, restauration `refresh → me`, retry unique sur 401)
- ✅ **F0-B routing + home mergé / Trello Done** : TanStack Router **file-based** branché (plugin Vite génère `routeTree.gen.ts`), pattern route/page, root layout global (restore session au mount), garde de route sur `/dashboard`, page home/landing arène complète + page login (UI seule, pas encore câblée au back)
- Libs front : **TanStack Router branché** + TanStack Query (installé), Zustand, React Hook Form, Zod, `lucide-react`, `clsx`, `tailwind-merge`
- ⚠️ **Pages encore majoritairement placeholders** : `/` (home/landing) et `/login` ont une vraie UI ; `/home`, `/register`, `/privacy`, `/terms`, `/dashboard` sont des stubs. Login **pas encore câblé** (formulaire non soumis). `App.tsx` supprimé (renommé `pages/login.tsx`)
- ⚠️ **Client temps réel** : le backend utilise `@fastify/websocket` (lib `ws`), donc côté front ce sera **WebSocket natif** (ou un wrapper compatible `ws`), **PAS socket.io-client**

**Backend** : Fastify v5 sur Node 24 LTS (TypeScript strict, ESM) — _en place et bien avancé_

- `@fastify/websocket` (+ `ws`) — chat temps réel
- `@fastify/multipart` — uploads avatar (limite 2 MB)
- `@fastify/jwt` + `@fastify/cookie` — auth (access 15 min / refresh 7 j en cookie)
- `@fastify/oauth2` — OAuth Google
- `@fastify/cors` (origin `http://localhost:5173`, credentials) + `@fastify/rate-limit` (100 req/min)
- `speakeasy` + `qrcode` — 2FA TOTP
- `bcryptjs` (cost 12) — hash password
- `drizzle-orm` + `postgres` / `pg`, `zod`, `minio`, `redis` (client v6)

**DB / Cache / Storage** :

- PostgreSQL 17.10 (conteneur, image figée)
- Redis 8.8.0 (authentification par mot de passe réellement activée ; client backend authentifié ; cache/pub-sub à exploiter — voir note présence ci-dessous)
- MinIO `RELEASE.2025-09-07T16-13-09Z` (S3-compatible, fichiers ; bucket `avatars` public en lecture)

**Infra** :

- Docker/Podman Compose, images tierces qualifiées et figées (**I2**), **pas de Nginx** (Fastify sert tout : API + front statique en prod + HTTPS)
- Bootstrap **I3** : après configuration du `.env`, `docker compose up -d --build` suffit — healthchecks PostgreSQL/Redis/MinIO, migrations Drizzle automatiques, certificat HTTPS généré dans le volume `backend_certs`, frontend lancé après le backend sain
- Dépendances Node installées avec `npm ci` ; les entrypoints comparent le hash du lockfile pour resynchroniser les volumes `node_modules` uniquement si nécessaire

**Outils dev** : Adminer (8080), redis-commander (8081), console MinIO (9001)

---

## 📁 Structure du projet (état réel)

```
~/transcendence/
├── docker-compose.yml
├── .env / .env.example / .gitignore
├── CLAUDE.md
├── docs/
│   └── schema.md            # design complet du domaine jeu (étape 5.5)
│                            # (maquettes HTML/CSS déplacées hors repo → .idea/, gitignoré)
│
├── backend/
│   ├── Dockerfile, docker-entrypoint.sh, package.json, tsconfig.json
│   ├── certs/               # point de montage du volume backend_certs (généré automatiquement)
│   ├── drizzle/             # migrations 0000 → 0014 (15 migrations) + meta
│   └── src/
│       ├── server.ts        # entry Fastify (HTTPS, registre plugins/routes)
│       ├── db/
│       │   ├── schema.ts     # 16 tables + 5 enums (voir État ci-dessous)
│       │   └── index.ts      # client drizzle
│       ├── auth/             # password.ts (bcrypt), tokens.ts (JWT + tempToken 2FA)
│       ├── routes/
│       │   ├── auth/         # index.ts (basic), google.ts, 2fa.ts
│       │   ├── users.ts      # profil + upload avatar
│       │   ├── friends.ts    # amis (6 endpoints)
│       │   ├── blocks.ts     # blocage d'users
│       │   ├── messages.ts   # historique DM (REST)
│       │   ├── chat.ts       # WebSocket DM temps réel (prefix /ws)
│       │   ├── games.ts      # read-only (list + detail)
│       │   ├── ladders.ts    # read-only (list + detail + rankings)
│       │   ├── external-accounts.ts  # liaison compte in-game (GET/POST/DELETE, prefix /users/me/external-accounts)
│       │   ├── teams.ts       # équipes CRUD + membres (prefix /teams) — B5a
│       │   └── matches.ts     # slots de match : créer/lister/détail (prefix /matches) — B5b
│       ├── storage/          # minio.ts, redis.ts
│       ├── utils/            # blocks.ts (helper isBlocked)
│       └── types/            # env.d.ts, fastify-jwt.d.ts, fastify-oauth2.d.ts
│
├── frontend/                # F0 + F0-A + F0-B en place (routing, home, login UI)
│   ├── Dockerfile, docker-entrypoint.sh
│   ├── components.json       # config shadcn-like
│   ├── package.json          # TanStack Router (branché) + Query, Zustand, RHF, Zod, lucide, clsx...
│   └── src/
│       ├── main.tsx          # createRouter(routeTree) + RouterProvider (plus d'App.tsx)
│       ├── routeTree.gen.ts  # généré par le plugin TanStack (VERSIONNÉ, ne pas éditer à la main)
│       ├── index.css         # source de vérité visuelle : tokens Tailwind + @utility (panel/label-caps/focus-ring) + utilitaires arène
│       ├── routes/           # wrappers file-based createFileRoute : __root, index, home, login, register, privacy, terms, dashboard (gardé)
│       ├── pages/            # composants de page : index/login + home/register/privacy/terms/dashboard
│       ├── stores/           # auth-store.ts (Zustand session — F0-A)
│       ├── lib/              # api.ts (fetch+refresh), api-config.ts, utils.ts (cn())
│       ├── types/            # auth.ts
│       ├── assets/images/    # bg.webp (hero)
│       └── components/
│           ├── ui/           # button, input, label, card, avatar, menu-item, icon-menu-item
│           ├── layout/       # RootLayout, LeftNav, RightNav, AuthNav, SiteFooter
│           └── home/         # HeroBanner, GameRail
│
└── data/                    # volumes bind-mount Postgres/MinIO (NON versionné)
```

---

## ✅ État d'avancement (au 13 juillet 2026)

### Infrastructure — I2 + I3 prêts pour review

- ✅ **I2 — images Compose reproductibles** (`feature/i2-pin-compose-images`) : noms de registres complets et tags figés pour PostgreSQL 17.10, Redis 8.8.0, Adminer 5.4.2 et MinIO `RELEASE.2025-09-07T16-13-09Z`. Redis Commander migre de l'ancienne image Docker Hub `0.7.2-rc3` vers l'image officielle maintenue `ghcr.io/joeferner/redis-commander:0.9.1`.
- ✅ **I3 — bootstrap en une commande** (`feature/i3-one-command-bootstrap`, dépend de I2) : auth Redis effective, clients backend/Redis Commander authentifiés, healthchecks + `depends_on: service_healthy`, certificat auto-signé dans `backend_certs`, migrations automatiques avant le backend, builds `npm ci` et resynchronisation conditionnelle des volumes selon le hash des lockfiles.
- ✅ Validé avec Podman : deux cycles `podman compose down` puis `podman compose up -d --build`, tous les services sains/accessibles ; Redis refuse sans mot de passe et répond avec authentification ; 12 tests backend passent ; build frontend passe ; lint frontend avec 0 erreur et 0 warning après le correctif Fast Refresh empilé sur I3.
- ⚠️ Le `.env` reste une configuration préalable volontaire : copier `.env.example`, remplacer les `changeme`, puis lancer Compose. Les certificats et migrations ne demandent plus de commande manuelle.

### Backend — TERMINÉ et fonctionnel

**Auth & user** (étapes 1-4) :

- Docker/Podman Compose (Postgres/Redis/MinIO/Adminer + hot reload), HTTPS auto-signé automatique, migrations automatiques, `.env.example`
- Drizzle ORM ; table `users` : id, pseudo, email, password_hash (nullable, OAuth), display_name, bio, avatar_url, oauth_provider/oauth_id (UNIQUE composite), totp_secret, totp_enabled, **is_admin**, created_at, updated_at
- JWT access 15 min + refresh cookie httpOnly/Secure/SameSite=Strict/Path=/auth ; bcryptjs cost 12
- Endpoints auth : `register`, `login`, `me`, `refresh`, `logout`
- **OAuth Google** : linking 3-cas (A déjà lié / B liaison par email / C nouveau compte), `googleOAuth2` plugin
- **2FA TOTP** (speakeasy) : `setup`/`enable`/`disable`/`verify` ; tempToken 5 min `{ pending: 'totp' }` ; décorateur `authenticate` rejette les tokens `pending` ; strip `totpSecret`/`totpEnabled` dans tous les handlers
- **Profil** : `GET/PATCH /users/me`, `GET /users/:pseudo` (public, strip privé), `POST /users/me/avatar` (MinIO, validation MIME, 2 MB)

**Social** (étape 5) :

- **Amis** (`/friends`) : 6 endpoints (request avec auto-accept sens inverse, list, requests, accept, reject=DELETE, unfriend)
- **Blocks** (`/blocks`) : bloquer/débloquer un user (supprime l'amitié au passage), helper `isBlocked`
- **Chat DM temps réel** (`/ws/chat?token=`, `chat.ts`) : auth par token en query, garde "amis acceptés uniquement" + check blocks à chaque message, persistance en DB, heartbeat ping/pong 30s. Double mécanisme de présence : **Map mémoire `userSockets`** (routage des sockets, obligatoire) + **Redis `online_users`** (`sAdd`/`sRem`). Events émis : `initial_presence` (à la connexion), `presence` (broadcast aux amis on/offline), `message`/`message_sent`, `error`. Multi-socket par user géré (premier/dernier socket)
- **Historique DM** (`GET /messages/:friendId`) : REST, gardes amis + blocks, 100 derniers messages chronologiques
- **Suppression de compte** (`DELETE /users/me`) : exige password (si compte local) + code TOTP (si 2FA), supprime l'avatar MinIO, clear cookie
- Sécurité transverse : CORS (5173, credentials), rate-limit global 100/min + limites par route (register 3, login 5, 2fa/verify 5, avatar 3)

**Domaine jeu — schéma & migrations** (étapes 5.5 + 6 partielles) :

- Design complet documenté dans `docs/schema.md`
- Enums : `friendship_status`, `provider_enum` (riot/steam/epic/chess_com), `format_enum` (1v1/2v2/3v3/5v5), `match_status_enum` (pending/in_progress/awaiting_confirmation/completed/disputed/cancelled), `dispute_status_enum`, `dispute_resolution_enum`
- Tables : `games`, `user_external_accounts` (champ `verified` central pour linking manuel vs OAuth), `ladders`, `teams`, `team_members`, `matches` (state machine via status), `match_sides` (check side_index ∈ {0,1}), `match_participants`, `disputes`, `dispute_evidence`, `rankings` (ELO, **XOR user/team** via check constraint, index ladder+elo desc)
- Routes **read-only** faites : `GET /games`, `GET /games/:id`, `GET /ladders`, `GET /ladders/:id` (+ join game), `GET /ladders/:id/rankings` (leaderboard trié par ELO, join user/team, 404 si ladder absent — logique de mise en forme extraite dans le helper pur `utils/leaderboard.ts` `shapeRankings`, couverte par tests — **B2 fait**)
- ✅ **Liaison de compte externe (in-game) faite — B4** : `external-accounts.ts` monté sur prefix `/users/me/external-accounts`, 3 routes authentifiées (validation Zod). `GET /` (liste mes liaisons, `[]` si aucune, projection `provider/externalId/verified`), `POST /` `{ provider, externalId }` (crée, `verified=false` par défaut, **201** ; provider hors enum ou externalId vide → **400** ; doublon `UNIQUE(user_id, provider)` capté via SQLSTATE `23505` → **409**), `DELETE /:provider` (idempotent → **200**, param validé contre l'enum → 400 sinon). Testé à la main (curl) + **openapi.yaml fait**. Garde §5.1 « liaison requise pour jouer » **PAS ici** (sera dans le ticket création de match B5b)
- ✅ **Équipes (teams) faites — B5a** : `teams.ts` monté sur prefix `/teams`, 6 routes authentifiées (Zod). `POST /` `{ ladderId, name }` (crée team + capitaine comme 1er membre en **transaction**, `ladderId` dénormalisé recopié ; ladder 1v1 → **400** ; `unique(ladder_id,name)` → **409** ; `unique(user_id,ladder_id)` → **409** ; **201**), `GET /` (mes teams tous ladders confondus, `[]` si aucune), `GET /:id` (détail + capitaine + membres, pas de fuite de champs privés), `POST /:id/members` `{ userId }` (**capitaine only** 403 ; user existe 404 ; **roster < 10** check code sinon 409 ; doublon/`user_ladder` → 409 ; 201), `DELETE /:id/members/:userId` (**kick capitaine OU quit soi-même** ; retrait du capitaine → 400 ; 200 idempotent), `DELETE /:id` (dissolution capitaine only, **cascade** DB sur les membres, 200). Roster **max 10** (§5.6 relâché) ; **lineup choisie au match** (B5b), pas à l'adhésion. Testé à la main (curl, tous cas) + **openapi.yaml fait**. Pas de tests Vitest (abandonnés — non exigés par le sujet).
- ✅ **Matchmaking — créer/lister les slots faits — B5b** : migration `0013` (table `game_maps` `game_id`+`name` avec `unique(game_id,name)`, colonne `maps text[]` sur `matches`, **seed val 6 / cs2 7** en `ON CONFLICT DO NOTHING`) + `0014` (`game_maps.name` **NOT NULL**). `matches.ts` sur prefix `/matches`, 3 routes Zod (**corps + query + param**). `POST /` `{ ladderId, scheduledAt, lineup? }` : **2 modes selon le format** — **2v2+** : capitaine engage sa team (team déduite du ladder ; lineup = **`format_size`** joueurs, tous membres + **§5.1** compte lié) ; **1v1** : créateur **solo** (lineup **ignorée**, side sans team `team_id=NULL`, participant = lui, §5.1 sur lui). **§5.2** slot ouvert unique + **lockout temporel** (`started_at + lockout_minutes`) → 409, **par team** (2v2+) ou **par joueur** (1v1). **Tirage 3 maps** distinctes (`ORDER BY random()`) si le jeu a un pool sinon `[]` ; transaction `match`(pending) + `match_side`(index 0, team ou NULL) + `match_participants` ; **201**. `GET /?ladderId=` : slots `pending`, **créateur ET maps masqués**, mes slots exclus (par team en 2v2+, par `user_id` en 1v1). `GET /:id` : détail brut (sides + participants + maps), **réservé aux participants** — membre d'une team engagée **OU** joueur solo du match (403 sinon → anonymat préservé). Validations : `scheduledAt` doit être **dans le futur** (400 sinon) ; `GET /?ladderId=` sur un ladder inconnu → **404**. Testé **end-to-end** (26 cas automatisés : solo, team, gardes, anonymat, lockout) + **openapi.yaml fait**. ⚠️ **§5.2 lockout** : seuls les matchs **actifs** (`in_progress` / `awaiting_confirmation` / `disputed`) dont `started_at + lockout_minutes` n'est pas écoulé bloquent une nouvelle création (**409**) — un match `completed` ou `cancelled` **libère aussitôt** (conforme §5.2). `started_at` étant posé à l'**accept** (B5c), le lockout est **dormant** tant que B5c n'est pas mergé, et devra être **reposé sur l'accept**.
- ✅ **Seed games/ladders fait** : les 5 jeux + 9 ladders sont insérés **dans les migrations `0008`/`0009`** (`INSERT ... ON CONFLICT DO NOTHING`, idempotent) — pas de script `seed.ts` séparé. Un `drizzle-kit migrate` sur clone neuf peuple donc les tables. ⚠️ La table `rankings` reste **vide** (pas encore de matchs → pas d'ELO) : le leaderboard renvoie donc `[]` tant qu'aucun match n'a généré de classement. Pour des faux classements en local : `npm run seed:dev` (script dev-only `backend/src/scripts/seed-dev.ts`, faux users/teams — **jamais** dans une migration).
- ⚠️ **Toutes les règles business §5.1–5.8 du design (`docs/schema.md`) sont à coder** : liaison de compte requise, lockout, soumission de score, accord/dispute, calcul ELO (K=32, départ 1000), dispute timeout. La DB est prête, la logique non.

### Frontend — F0 + F0-A + F0-B (routing/home) en place, câblage auth des pages à faire

**Fondation design F0 mergée** :

- `frontend/src/index.css` est la **source de vérité visuelle** : tokens Tailwind v4 couleurs, polices, radius, shadows, styles globaux et utilitaires DA
- DA retenue : fond sombre compétitif et sobre ; rappels rouge/bleu ; action principale violette `action-primary` ; pas de texte courant en gradient
- Composants UI de base : `Button` (`primary`, `secondary`, `ghost`), `Input`, `Label`, `Card` + `CardHeader`/`CardContent`/`CardFooter`
- Setup shadcn-like : `frontend/components.json`, alias `@/*`, `src/lib/utils.ts` avec `cn()`
- ⚠️ `App.tsx` (ex-écran de validation DA) a été **supprimé** en F0-B : le bootstrap se fait via le routeur (`main.tsx` → `RouterProvider`) et `pages/login.tsx`

**Client API + auth store F0-A implémenté/testé** :

- Store Zustand dans `frontend/src/stores/auth-store.ts` : `user`, `accessToken`, `ready`, `setSession`, `setAccessToken`, `clearSession`, `restoreSession`, `logout`
- Client API dans `frontend/src/lib/api.ts` : base `https://localhost:3000`, `credentials: 'include'`, Bearer automatique depuis le store, erreurs typées `ApiError`
- Refresh transparent : sur `401`, `POST /auth/refresh`, mise à jour du token, replay de l'appel **une seule fois** ; si refresh échoue → session locale vidée + logout backend best-effort
- Types auth dans `frontend/src/types/auth.ts`, config base URL dans `frontend/src/lib/api-config.ts`
- Testé avec backend réel : register/login manuel en console navigateur, `apiFetch('/auth/me')`, token invalide → refresh/retry OK, reload page → session restaurée
- Vérifications passées : `npm run build`, `npm run lint`, `git diff --check`

**Routing + home F0-B mergé (Trello Done)** :

- **TanStack Router file-based** : plugin `@tanstack/router-plugin/vite` (`tanstackRouter({ target: 'react', autoCodeSplitting: true })`) génère `src/routeTree.gen.ts` (**versionné**, ne pas éditer) ; `main.tsx` monte `createRouter({ routeTree })` + `<RouterProvider>` avec augmentation de module TS (`Register`)
- **Pattern route/page** : `src/routes/*.tsx` = wrappers minces `createFileRoute` (config routeur) ; `src/pages/*.tsx` = vrais composants. Le composant Dashboard est dans `pages/dashboard.tsx` et le layout racine dans `components/layout/RootLayout.tsx`. Routes : `/` (home/landing), `/home`, `/login`, `/register`, `/privacy`, `/terms`, `/dashboard`
- **`__root.tsx`** = wrapper TanStack mince qui importe `RootLayout`. Ce layout est monté **une seule fois** pour toute l'app : il lance `restoreSession()` au mount (`useEffect`), rend `<Outlet/>` + `<TanStackRouterDevtools/>`
- ✅ **Correctif Fast Refresh** (`fix/frontend-fast-refresh-routes`) : composants extraits des fichiers de routes ; `npm run lint` passe désormais avec 0 erreur et 0 warning, `npm run build` passe
- **Garde de route** sur `/dashboard` : `beforeLoad` attend `restoreSession()` si `!ready` (dédupliqué dans le store, donc peu coûteux), puis `throw redirect({ to: '/login' })` si pas de `user` — **le patron à réutiliser** pour toute page protégée
- **Home / landing (`pages/index.tsx`)** : layout arène complet — rails flottants fixes `LeftNav` (nav + sélecteur langue + `AuthNav`) et `RightNav` (avatar + icônes), viewport central scrollable avec `HeroBanner` (asset `bg.webp`) + `GameRail` (rail scroll-snap de cartes jeu, **données en dur** pour l'instant) + `SiteFooter` (liens Terms/Privacy)
- **Nouveaux composants UI** : `avatar` (sans dépendance radix), `menu-item` (rend un `<Link>` TanStack si prop `to`, sinon `<button>`), `icon-menu-item` (bouton icône + tooltip)
- **Nouveaux `@utility` dans `index.css`** : `panel` (surface carte des rails flottants), `label-caps` (gras/majuscules/tracking), `focus-ring` (outline violet clavier, a11y). Utilitaires arène (`arena-background`, `text-arena-gradient`, `arena-wordmark`…) déjà présents
- ⚠️ **Login (`pages/login.tsx`) pas encore câblé** : UI complète (fond arène, wordmark VS, champ password avec toggle œil `lucide`) mais **aucun handler de soumission**, pas d'appel `login` — lit juste `ready`/`user` du store pour l'affichage. Idem `/register` (stub)

**Règles front à respecter dès F0-A et les pages suivantes** :

- importer avec `@/...`, éviter les chemins relatifs longs
- ne pas écrire de couleurs/polices/radius/shadows en dur dans les pages ; ajouter d'abord un token dans `index.css` si nécessaire
- réutiliser les composants `frontend/src/components/ui` autant que possible
- utiliser `lucide-react` pour les icônes standard
- lancer `npm run build` et `npm run lint` dans `frontend/` avant review

### Reste à faire (backend)

- **vérification** des comptes externes (OAuth Steam/Riot → `verified = true`) — le linking manuel est fait (B4) ; les routes teams sont faites (B5a)
- Routes **matches** : ✅ création + liste des slots faites (B5b) ; **reste** : accepter un slot (side 1, → `in_progress` + `started_at`) & « mes matchs » (B5c), soumission de résultats, state machine, confirmation
- Routes **disputes** (ouverture, evidence upload, résolution admin)
- **Matchmaking worker** (file d'attente, matching par ELO) — la pièce centrale, pas encore commencée
- **Notifications système** — pas commencé
- Migrer la présence chat vers Redis (optionnel)

### Reste à faire (transverse / 42)

- Polish 42 : Privacy Policy, ToS, zéro warning console, README à jour
- Préparation soutenance

---

## 🗂️ Organisation d'équipe (Trello)

**Outil** : Trello, board à 4 colonnes — **Todo / In Progress / Review / Done**.

**Workflow** :

- On **s'assigne** une carte Todo (membre Trello) pour la passer en In Progress.
- Une carte = une unité de travail ~1-3 j = une branche `feature/xxx` = une PR reviewable.
- **Review** = diff local relu par un coéquipier (jamais sa propre branche).
- Sur approbation → **merge sur `master`** → carte déplacée en **Done** (Done = code intégré, pas juste "prêt à merger").

**Gabarit de carte** : titre (verbe + objet), description, **Definition of Done**, assigné, label (`backend` / `frontend` / `infra` / `docs`).

**Rituel de planif** : tous les **dimanches**, session avec Claude pour lister les tickets de **la semaine uniquement** (backlog just-in-time — on n'avance pas la liste plus loin, mais on peut enchaîner si on va vite). Les étapes lointaines restent des cartes "epic" jusqu'à la semaine où on les attaque.

**Lien Claude Code ↔ Trello** : possible via MCP (serveur Trello communautaire avec API key + token). Non branché pour l'instant — la planif se fait, le remplissage se fait à la main ou via MCP au choix.

---

## 📋 Conventions du projet

### Code

- **TypeScript strict** partout (`strict`, `noUncheckedIndexedAccess`…)
- **ESM** (`"type": "module"`), **Node 24 LTS**
- Imports nommés > default ; validation systématique **Zod** côté API
- Front : tokens Tailwind depuis `frontend/src/index.css`, composants UI dans `frontend/src/components/ui`, imports `@/...`, pas de couleurs en dur dans les pages

### Git

- **Dépôt de travail = Git vogsphere 42** (rendu + collaboration directe, pas de repo miroir). Pas d'interface PR → la "Review" se fait en local (`git diff master..<branche>`, jamais sa propre branche), puis merge sur `master`.
- **Branches** : `feature/<code-ticket>-<sujet-court>` / `fix/<sujet>` — kebab-case, sans accents/espaces. Ex : `feature/f1-scaffolding-front`, `fix/refresh-token`
- **Commits** : Conventional Commits `type(scope): description` — types feat/fix/docs/refactor/chore/test/style, scope optionnel (db, auth, front…). Commits atomiques. Pas de force push sur `master`.
- ⚠️ **Identité git par dev** = identité 42 (`user.name`/`user.email`) — 42 vérifie les contributions individuelles.
- ⚠️ Pas de trailer `Co-Authored-By: Claude` dans les commits (préférence user)

### Docker

- Services nommés explicitement, env **uniquement** dans `.env` (`${VAR}` dans compose)
- Volumes bind-mount sous `./data/`, hot reload via polling (WSL2)
- Images tierces avec registre complet + version précise ; pas de tag `latest`
- `npm ci` est utilisé dans les images. Les entrypoints resynchronisent les volumes `node_modules` seulement si le hash du `package-lock.json` a changé
- Le backend attend PostgreSQL, Redis et MinIO sains, applique les migrations puis démarre ; le frontend attend le backend sain

### Sécurité

- `.env` jamais commit, `.env.example` versionné (obligatoire sujet)
- Backend **HTTPS partout**, mots de passe forts hashés+salés, validation front **ET** back
- Backend écoute sur `0.0.0.0`

---

## 🚨 Pièges déjà rencontrés

1. **Espaces dans `.env`** : `VAR=valeur` sans espaces
2. **Données PostgreSQL en bind mount** : changer `POSTGRES_USER/PASSWORD` après initialisation ne reconfigure pas la base existante. `docker compose down -v` ne supprime pas `./data/postgres` ; une réinitialisation exige de supprimer explicitement ce dossier après sauvegarde (opération destructive)
3. **Hot reload WSL2 + Docker** : polling obligatoire (`CHOKIDAR_USEPOLLING=true` ; `server.watch.usePolling` Vite)
4. **Fastify host** : toujours `host: '0.0.0.0'`
5. **Nom de service ≠ localhost** dans le réseau Docker (`postgres:5432`)
6. **Fastify affiche `127.0.0.1`** même en écoute `0.0.0.0` (cosmétique)
7. **`node_modules` dans bind mount** : volume anonyme `/app/node_modules`. Il ne se met pas à jour seul lorsqu'une dépendance change. Les entrypoints I3 comparent désormais le hash de `package-lock.json` au marqueur du volume et lancent `npm ci` uniquement si nécessaire (I1 est ainsi conservé sans réinstallation systématique)
8. **Enum Drizzle sans `export`** non détecté par drizzle-kit → migration cassée. Toujours `export const xxxEnum = pgEnum(...)`
9. **Interop CJS `@fastify/oauth2`** + `verbatimModuleSyntax` : workaround `(oauth2 as any).GOOGLE_CONFIGURATION`
10. **F0 front = fondation visuelle uniquement** : ne pas traiter `App.tsx` comme une vraie page login ; elle sert seulement de référence DA temporaire
11. **Certificat HTTPS dev** : l'entrypoint backend le génère automatiquement dans le volume `backend_certs` avec `subjectAltName=DNS:localhost,IP:127.0.0.1`. Il reste nécessaire d'accepter `https://localhost:3000/ping` dans le navigateur
12. **Migrations au démarrage** : l'entrypoint backend lance `drizzle-kit migrate` avant Fastify. La commande manuelle ne sert plus qu'au diagnostic
13. **Redis officiel** : la variable `REDIS_PASSWORD` seule n'active rien. Le Compose lance explicitement `redis-server --requirepass` et le backend fournit ce mot de passe au client

---

## 💬 Style d'interaction préféré

> ⚠️ **Préférence par défaut, ajustable par chaque membre de l'équipe.** On est 4 sur ce repo. Le point « code » ci-dessous est la préférence du créateur du repo — chacun peut dire à son Claude comment il préfère travailler.

**Contexte commun à l'équipe** :

- **On vient du C, on débute en TypeScript/Node/Docker** — explications claires, sans jargon inutile
- On veut **comprendre le pourquoi** ; on apprécie les **questions de clarification** avant d'attaquer

**Préférence par défaut du créateur du repo (brahim / pintodav75)** :

- **Ne pas générer le code à sa place** (sauf demande explicite). Pas de blocs de code, même illustratifs : décrire les concepts, il écrit le code lui-même.
- Préfère **explications + commandes shell** plutôt que blocs de code complets.
- Mode de travail : 1) annoncer quoi/pourquoi 2) décrire les concepts 3) donner les commandes shell 4) laisser coder 5) relire ensemble.

👉 **Chaque coéquipier peut surcharger ça** en début de session (ex : « écris-moi le code directement »). En cas de doute sur qui tu assistes, demande la préférence sur le code avant d'attaquer.

---

## 🔗 Commandes utiles

```bash
cd ~/transcendence
docker compose up -d --build      # construire et démarrer toute l'application
docker compose ps                 # état
docker compose logs -f <service>  # logs
docker compose exec <service> sh  # entrer dans un conteneur
docker compose down               # arrêter (garde les données)
docker compose down -v            # supprime cert/node_modules ; conserve les bind mounts ./data
docker compose up -d --build <service>  # rebuild après modif Dockerfile
```

**UIs locales** : Front (5173), Adminer (8080), redis-commander (8081), MinIO console (9001), Backend API (3000, HTTPS).

---

## 🎯 Prochaines actions immédiates

- **Infra** : faire reviewer puis merger I2 avant I3 (I3 est empilé sur I2). Après merge I2, reviewer `git diff master..feature/i3-one-command-bootstrap`, tester `docker compose up -d --build`, puis merger I3 et déplacer les deux cartes Trello en Done
- **Frontend** : après I3, reviewer puis merger `fix/frontend-fast-refresh-routes`. F0-B est déjà mergé/Done ; l'étape suivante est de câbler le formulaire de login (`login` → `setSession` → `redirect`), puis register/2FA et les vraies pages profil/social
- Les stubs `/home`, `/register`, `/privacy`, `/terms`, `/dashboard` restent à remplir

---

_Dernière mise à jour : 13 juillet 2026 — I2/I3 + correctif Fast Refresh des routes TanStack_
