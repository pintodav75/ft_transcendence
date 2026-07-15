# CLAUDE.md — Projet ft_transcendence

> Fichier de contexte pour Claude Code. À lire en début de session.

---

## 🎯 Le projet

**ft_transcendence** — projet final du Common Core 42, en équipe de 4. Le sujet est **libre** : on construit une web app de notre choix qui valide ≥ 14 points via les modules.

**Concept choisi : plateforme compétitive multi-jeux type GameBattle / LiveNplay**

- Profils utilisateurs, équipes
- Ladders par jeu avec ELO
- **Matchmaking par défi (challenge/accept)** : une team (ou un joueur en 1v1) **ouvre un slot**, une autre **l'accepte**
- Soumission de résultats, système de disputes
- Chat, amis, notifications temps réel
- Pattern config-driven pour supporter plusieurs jeux

> ⚠️ **PAS de file d'attente, PAS de worker de matchmaking automatique.** La référence produit est **LiveNplay / GameBattle**, pas Valorant/LoL. Il n'y a **aucun** bouton « chercher une partie », aucun job périodique d'appariement par ELO. Un ladder est un **classement où l'on se défie** : créer un slot → l'autre accepte → les deux entrent le score → l'ELO bouge. Rien d'autre. (Décision explicite de David, 13/07 — ne pas réintroduire cette idée.)

**Statut équipe** : ✅ équipe de 4 formée — début du travail de groupe (fin juin 2026). Deadline courte → focus, pas d'éparpillement.

---

## 🧩 Modules choisis (15 points)

| Module                                         | Type  | Points | État                                  |
| ---------------------------------------------- | ----- | ------ | ------------------------------------- |
| Frameworks front + back                        | Major | 2      | ✅                                     |
| Standard user management                       | Major | 2      | ✅                                     |
| Real-time WebSocket                            | Major | 2      | ✅ (chat)                              |
| User interaction (chat + profil + amis)        | Major | 2      | ✅                                     |
| **Organization system** (= nos **teams**, B5a) | Major | **2**  | ✅ **déjà codé** — remplace Game stats |
| ORM (Drizzle)                                  | Minor | 1      | ✅                                     |
| OAuth 2.0                                      | Minor | 1      | ✅                                     |
| 2FA TOTP                                       | Minor | 1      | ✅                                     |
| File upload                                    | Minor | 1      | ✅ (avatar MinIO)                      |
| Notification system                            | Minor | 1      | ⬜ pas commencé                        |
| **TOTAL**                                      |       | **15** |                                       |

### 🚨 Pourquoi « Game stats & match history » a disparu

**Décision du 13/07 : il n'y aura PAS de jeu jouable dans l'app.** Or le sujet v20 l'exige pour ce module — _« You cannot claim this module without a functional game »_. La plateforme ne fait que **tracker des jeux externes** (LoL / CS2 / chess.com via liaison de compte) → le module est **invalidable**.

Sans remplacement, l'équipe tombait à **13 points → sous la barre des 14 → projet rejeté.**

Il est remplacé par **Organization system** (Major, 2 pts) : créer/éditer/supprimer des organisations et gérer leurs membres — c'est **exactement** ce que font nos teams (B5a : création, roster, capitaine, kick/quit, dissolution). **Zéro ligne de code à écrire**, juste à le déclarer dans le README et savoir le défendre.

⚠️ **À confirmer contre le PDF du sujet** — l'intitulé exact et ses exigences n'ont pas été revérifiés depuis le 04/07. **Ne pas bâtir le compte de points sur cette ligne sans vérifier.**

### Candidats de réserve (marge)

- **Advanced permissions / roles** (Major, 2 pts) — s'appuierait sur l'**arbitrage admin des disputes** (ticket **B7**). ⚠️ À vérifier dans le sujet : un booléen `is_admin` suffit-il, ou faut-il de **vrais rôles assignables** ? Si ça colle, quasi gratuit une fois B7 fait → 17 pts.
- **Public API** (Major, 2 pts) — 20+ endpoints, rate-limit et `openapi.yaml` déjà là ; il manquerait une **clé d'API**. ⚠️ Le seul qui coûte du **vrai code neuf** → à ne prendre que s'il reste du temps.
- Mineurs : Advanced search (1), Custom design system (1), GDPR (1 — la suppression de compte existe déjà), i18n (1).

---

## 🛠️ Stack technique

**Frontend** : Vite 8 + React 19 + TypeScript + Tailwind v4 — _fondation F0 + F0-A + F0-B (routing & home) en place_

- ✅ **Fondation visuelle F0 mergée** : tokens Tailwind v4 dans `src/index.css`, composants UI de base (`Button`, `Input`, `Label`, `Card`), config shadcn-like `components.json`, alias `@/*`, helper `cn()`
- ✅ **F0-A implémenté et testé** : client API `fetch` + store auth Zustand (`user`, `accessToken`, `ready`, restauration `refresh → me`, retry unique sur 401)
- ✅ **F0-B routing + home (branche `feature/f0b-routeur-base-home`)** : TanStack Router **file-based** branché (plugin Vite génère `routeTree.gen.ts`), pattern route/page, root layout `__root.tsx` (restore session au mount), garde de route sur `/dashboard`, page home/landing arène complète + page login (UI seule, pas encore câblée au back)
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

- PostgreSQL 17 (conteneur)
- Redis (client connecté ; cache/pub-sub à exploiter — voir note présence ci-dessous)
- MinIO (S3-compatible, fichiers ; bucket `avatars` public en lecture)

**Infra** :

- Docker Compose, **pas de Nginx** (Fastify sert tout : API + front statique en prod + HTTPS)
- HTTPS via certificats auto-signés en dev (`backend/certs/`)

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
│   ├── Dockerfile, package.json, tsconfig.json
│   ├── certs/               # cert auto-signé (NON versionné)
│   ├── openapi.yaml         # contrat d'API (à jour : auth, users, social, teams, matches)
│   ├── tests/               # tests e2e Python (run_all.py — 9 suites, 206 cas) + unit/ (Vitest) + README
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
│       │   └── matches.ts     # cycle de match complet : créer/lister/accepter/annuler/mes matchs/détail — B5b+B5c
│       ├── jobs/             # planificateur (setInterval) : slots périmés — B5d
│       ├── storage/          # minio.ts, redis.ts
│       ├── utils/            # blocks.ts (helper isBlocked)
│       └── types/            # env.d.ts, fastify-jwt.d.ts, fastify-oauth2.d.ts
│
├── frontend/                # F0 + F0-A + F0-B en place (routing, home, login UI)
│   ├── components.json       # config shadcn-like
│   ├── package.json          # TanStack Router (branché) + Query, Zustand, RHF, Zod, lucide, clsx...
│   └── src/
│       ├── main.tsx          # createRouter(routeTree) + RouterProvider (plus d'App.tsx)
│       ├── routeTree.gen.ts  # généré par le plugin TanStack (VERSIONNÉ, ne pas éditer à la main)
│       ├── index.css         # source de vérité visuelle : tokens Tailwind + @utility (panel/label-caps/focus-ring) + utilitaires arène
│       ├── routes/           # wrappers file-based createFileRoute : __root, index, home, login, register, privacy, terms, dashboard (gardé)
│       ├── pages/            # composants de page : index (home/landing arène), login (UI), home/register/privacy/terms (stubs)
│       ├── stores/           # auth-store.ts (Zustand session — F0-A)
│       ├── lib/              # api.ts (fetch+refresh), api-config.ts, utils.ts (cn())
│       ├── types/            # auth.ts
│       ├── assets/images/    # bg.webp (hero)
│       └── components/
│           ├── ui/           # button, input, label, card, avatar, menu-item, icon-menu-item
│           ├── layout/       # LeftNav, RightNav, AuthNav, SiteFooter
│           └── home/         # HeroBanner, GameRail
│
└── data/                    # volumes bind-mount Postgres/MinIO (NON versionné)
```

---

## ✅ État d'avancement (au 8 juillet 2026)

### Backend — TERMINÉ et fonctionnel

**Auth & user** (étapes 1-4) :

- Docker (Postgres/Redis/MinIO/Adminer + hot reload WSL2), HTTPS auto-signé, `.env.example`
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
- ✅ **Matchmaking — créer/lister les slots faits — B5b** : migration `0013` (table `game_maps` `game_id`+`name` avec `unique(game_id,name)`, colonne `maps text[]` sur `matches`, **seed val 6 / cs2 7** en `ON CONFLICT DO NOTHING`) + `0014` (`game_maps.name` **NOT NULL**). `matches.ts` sur prefix `/matches`, 3 routes Zod (**corps + query + param**). `POST /` `{ ladderId, scheduledAt, lineup? }` : **2 modes selon le format** — **2v2+** : capitaine engage sa team (team déduite du ladder ; lineup = **`format_size`** joueurs, tous membres + **§5.1** compte lié) ; **1v1** : créateur **solo** (lineup **ignorée**, side sans team `team_id=NULL`, participant = lui, §5.1 sur lui). **§5.2** slot ouvert unique + **lockout temporel** (`started_at + lockout_minutes`) → 409, **par team** (2v2+) ou **par joueur** (1v1). **Tirage 3 maps** distinctes (`ORDER BY random()`) si le jeu a un pool sinon `[]` ; transaction `match`(pending) + `match_side`(index 0, team ou NULL) + `match_participants` ; **201**. `GET /?ladderId=` : slots `pending`, **créateur ET maps masqués**, mes slots exclus (par team en 2v2+, par `user_id` en 1v1). `GET /:id` : détail brut (sides + participants + maps), **réservé aux participants** — membre d'une team engagée **OU** joueur solo du match (403 sinon → anonymat préservé). Validations : `scheduledAt` doit être **dans le futur** (400 sinon) ; `GET /?ladderId=` sur un ladder inconnu → **404**. Testé **end-to-end** (26 cas automatisés : solo, team, gardes, anonymat, lockout) + **openapi.yaml fait**. ⚠️ **§5.2 lockout** : seuls les matchs **actifs** (`in_progress` / `awaiting_confirmation` / `disputed`) dont `started_at + lockout_minutes` n'est pas écoulé bloquent une nouvelle création (**409**) — un match `completed` ou `cancelled` **libère aussitôt** (conforme §5.2). ⚠️ **Ce « slot ouvert unique + lockout `started_at` » décrit B5b/B5c ; B5d l'a remplacé par la disponibilité par fenêtre — cf. bloc B5d.**
- ✅ **Matchmaking — accepter / annuler / mes matchs / détail enrichi faits — B5c** : **aucune migration**. `matches.ts` compte désormais 6 routes.
  - **`validateSide()` extrait** au niveau module : valide **un côté** (§5.1 compte lié, lineup présente/taille `format_size`/⊆ roster, garde capitaine, §5.2 lockout) et rend une **union discriminée** (`{ok:true, sideTeamId, participantIds}` | `{ok:false, code, error, unlinkedPlayers?}`). Il n'a **pas accès à `reply`** : il rend un verdict, la route le traduit en HTTP. Appelé **deux fois** — à la création (side 0) et à l'accept (side 1) → **les deux camps sont validés à l'identique**. Le check « j'ai déjà un slot ouvert » n'y est **pas** (il valide l'action d'ouvrir, pas le côté) → reste dans `POST /`.
  - **`POST /:id/accept`** `{ lineup? }` : engage le side 1. **Garde anti-auto-accept** — ⚠️ **par `team_id` en 2v2+**, mais **par `user_id` en 1v1** (les deux sides y ont `team_id = NULL` : comparer les teamId ne détecterait rien et refuserait *tous* les accepts solo). En **transaction** : update **conditionnel** (`WHERE status='pending'` + `.returning()` → tableau vide = deux accepts simultanés → **409**) posant `status='in_progress'` + **`started_at = now()`**, puis side 1 + participants, puis **annulation des slots `pending` restants des deux camps** (**par team** en 2v2+ — annuler par joueur raterait un slot dont la lineup est disjointe ; **par joueur + filtre ladder** en solo). Sans cette annulation, une 3e équipe accepterait le slot d'un camp déjà en match → **deux matchs actifs, lockout contourné**. Body **facultatif** (`request.body ?? {}` : en 1v1 le client n'envoie rien).
  - 🔑 **Le lockout §5.2 est ENFIN ARMÉ** : `started_at` restait `NULL` partout, donc `started_at + lockout_minutes > now()` ne pouvait jamais être vrai. La règle existait depuis B5b mais était **dormante**. C'est l'accept qui la réveille. ⚠️ **HISTORIQUE — remplacé par B5d** : ce lockout basé sur `started_at` a été abandonné au profit de la **disponibilité par fenêtre** sur `scheduled_at` (voir bloc B5d ci-dessous). `started_at` n'est plus lu par aucune règle.
  - **`DELETE /:id`** : annuler **son** slot ouvert → `status = 'cancelled'` (on **n'efface pas** : historique conservé). Créateur = **side_index 0** (capitaine en 2v2+, joueur en 1v1). Idempotent (200). Update conditionnel → **409** si quelqu'un a accepté entre-temps.
  - **`GET /me`** : mes matchs, **deux sources** — (A) je suis dans `match_participants` (mes solos + les matchs où j'étais **aligné**), (B) une de mes teams est sur un side (→ **le remplaçant sur le banc voit le match de sa team** ; sans B il serait invisible, il n'a aucune ligne participant). Union dédoublonnée (un match d'équipe où j'ai joué remonte des **deux** sources). **Rien n'est masqué** ici (maps visibles). Aucun match → `[]`, pas 404.
  - **`GET /:id` enrichi** : rend l'**objet team** (nom, logo, `captainId` — `null` en 1v1) et les **joueurs** (pseudo, avatar) au lieu d'ids bruts, sides **triés** (0 = créateur, 1 = accepteur). **Deux requêtes seulement** quel que soit le nombre de joueurs (ids collectés → 2 `SELECT` → indexés dans des `Map` → assemblage en mémoire) : **pas de N+1**. Projection **explicite** sur `users` (jamais de `select()` nu : fuite `email`/`passwordHash`). Garde « participants only » inchangée (banc compris).
  - Testé **end-to-end** : **206 cas verts** (`cd backend/tests && python3 run_all.py`) — 9 suites. **openapi.yaml fait**.
- ✅ **Le TEMPS : grille horaire, fenêtres de disponibilité, expiration — B5d** : **aucune migration** (`scheduled_at` et l'index `(status, scheduled_at)` existaient déjà, ils n'étaient juste **jamais lus**).
  - 🔑 **`scheduled_at` est LA référence temporelle.** La plateforme n'a **aucune source de vérité** sur le vrai coup d'envoi (elle ne voit pas la partie Valorant), donc elle ne fait pas semblant : elle se fie à l'heure annoncée. **`started_at` n'enregistre plus que l'instant de l'acceptation — AUCUNE règle ne le lit.** Avant B5d, §5.2 et §5.3 s'appuyaient dessus : un slot à 21h accepté à 20h30 voyait son lockout expirer **au coup d'envoi**, et les équipes redevenaient « libres » **pendant qu'elles jouaient**.
  - **Grille** : `scheduled_at` doit tomber sur un **quart fixe** (`:00`/`:15`/`:30`/`:45`, secondes et ms à 0) et être à **≥ 15 min** dans le futur — pour **créer** comme pour **accepter**. Borne **incluse** (20h45:00 passe, 20h45:01 non).
  - 🔑 **§5.2 réécrit — disponibilité par FENÊTRE.** Chaque match occupe `[scheduled_at, scheduled_at + lockout_minutes]`. Un camp ne peut pas avoir deux matchs dont les fenêtres se **chevauchent**. Les slots `pending` comptent autant que les matchs actifs. **Remplace « un seul slot ouvert » ET le lockout** : `hasOpenSlot()` + `isLockedOut()` **fusionnent** dans `hasConflictingMatch()`.
  - ⚠️ **Le « camp » est PAR LADDER, pas par personne** (décision du 14/07, après une review externe). En 2v2+ = la **team** ; en 1v1 = le couple **(joueur, ladder)**. Conséquence **assumée** : un joueur peut avoir un match d'échecs **et** un match Rocket League à 21h ; un joueur dans deux teams sur deux ladders peut être aligné deux fois. **Ce n'est PAS un bug — ne le « corrigez » pas.** Raison : la plateforme n'observe pas les parties, le mécanisme dispute/forfait corrige déjà l'absence, et c'est une **responsabilité humaine** (le capitaine engage son équipe et doit avoir l'accord de ses joueurs ; si l'un ne vient pas, c'est **sa** team qui perd par forfait). À écrire dans les **Terms of Service** (`/terms`, obligatoire pour le sujet). ⚠️ **Limite connue** : le capitaine ne *voit pas* qu'un joueur est déjà pris ailleurs → ticket futur « informer sans bloquer » (comme `hasLinkedAccount`).
  - ⚠️ **INÉGALITÉS STRICTES** (`gt`/`lt`, jamais `gte`/`lte`) : deux fenêtres qui se **touchent** (21h–22h puis 22h–23h) **ne se chevauchent pas** → l'enchaînement **dos à dos** est autorisé. C'est le cas d'usage central : une team ouvre **21h, 23h et 01h** en même temps et planifie sa soirée. Écrire `gte`/`lte` casserait la feature.
  - ⚠️ **Option A resserrée** : accepter un match n'annule QUE les slots qui **chevauchent** sa fenêtre. Avant, il les annulait **tous** — accepter le match de 21h aurait détruit les slots de 23h et 01h.
  - 🔑 **Le point le plus subtil : ce qui bloque DÉPEND de l'action.** `hasConflictingMatch()` prend les **statuts en paramètre**. À la **création** → `ENGAGING_STATUSES` (`pending` **+** actifs) : je ne peux pas *proposer* deux créneaux qui se chevauchent. À l'**accept** → `LOCKING_STATUSES` (**actifs seulement**) : mes slots `pending` qui chevauchent ne me bloquent **pas**, ce ne sont que des propositions — et l'option A va justement les **retirer** quand je m'engage. Les compter reviendrait à me refuser un match à cause d'une offre que je m'apprête moi-même à annuler. *(Bug trouvé par les tests, pas à la relecture.)*
  - **Expiration** : un slot `pending` sous la barre des 15 min est **périmé** → masqué de `GET /matches?ladderId=`, refusé à l'accept (**409**), **ignoré** par le check de conflit et par le plafond (sinon il **bloquerait son propre créateur**), et passé à `cancelled` par le **job**.
  - **Plafond** : **5 slots ouverts max** par camp et par ladder (anti-spam).
  - 🆕 **Planificateur** (`src/jobs/index.ts`) : un `setInterval` à la minute, branché dans `server.ts` après le `listen`. **La seule partie du backend qui tourne sans requête HTTP.** Un `try/catch` autour du tick — un job qui plante ne doit jamais tuer le serveur. B6 et B7 y ajouteront leurs tâches (confirmation auto à 24 h, timeout des disputes).
  - `docs/schema.md` **§5.2 et §5.3 réécrits** — le design était en retard sur l'UX.
- ✅ **Seed games/ladders fait** : les 5 jeux + 9 ladders sont insérés **dans les migrations `0008`/`0009`** (`INSERT ... ON CONFLICT DO NOTHING`, idempotent) — pas de script `seed.ts` séparé. Un `drizzle-kit migrate` sur clone neuf peuple donc les tables. ⚠️ La table `rankings` reste **vide** (pas encore de matchs → pas d'ELO) : le leaderboard renvoie donc `[]` tant qu'aucun match n'a généré de classement. Pour des faux classements en local : `npm run seed:dev` (script dev-only `backend/src/scripts/seed-dev.ts`, faux users/teams — **jamais** dans une migration).
- ✅ **Règles business §5.1 et §5.2 codées** (`docs/schema.md`) : liaison de compte requise pour jouer (§5.1) et **disponibilité par fenêtre** (§5.2, **modèle B5d** : `[scheduled_at, scheduled_at + lockout_minutes]`, chevauchement interdit, inégalités strictes ; `started_at` n'est plus lu — il remplace l'ancien « slot unique + lockout `started_at` » de B5b/B5c). ⚠️ **Reste à coder** : §5.3/§5.4 soumission de score + accord/dispute, calcul **ELO** (K=32, départ 1000), dispute timeout. La DB est prête, la logique non.
- ✅ **Tests — deux niveaux, deux outils** (`backend/tests/`) :
  - **Unitaires (Vitest)** — `npm test` (`tests/unit/` : `elo`, `leaderboard`, `password`). Réservés aux **helpers purs**, sans DB ni HTTP.
  - **End-to-end (Python, stdlib seule)** — `cd backend/tests && python3 run_all.py` : **9 suites, 206 cas** qui tapent sur le **vrai** backend et la **vraie** base de dev, sans mocks. Les users de test sont créés puis **supprimés** (motif `^(alice|bob|carol|dave|erin)[0-9a-f]{8}$`) → les données de l'équipe ne sont jamais touchées. `helpers.py` gère le rate-limit de `register` (3/min) et l'accès SQL direct (pour forcer des états que l'API ne permet pas encore d'atteindre). Voir `backend/tests/README.md`.

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

**Routing + home F0-B implémenté (branche `feature/f0b-routeur-base-home`, pas encore mergé)** :

- **TanStack Router file-based** : plugin `@tanstack/router-plugin/vite` (`tanstackRouter({ target: 'react', autoCodeSplitting: true })`) génère `src/routeTree.gen.ts` (**versionné**, ne pas éditer) ; `main.tsx` monte `createRouter({ routeTree })` + `<RouterProvider>` avec augmentation de module TS (`Register`)
- **Pattern route/page** : `src/routes/*.tsx` = wrappers minces `createFileRoute` (config routeur) ; `src/pages/*.tsx` = vrais composants. Routes : `/` (home/landing), `/home`, `/login`, `/register`, `/privacy`, `/terms`, `/dashboard`
- **`__root.tsx`** = layout racine monté **une seule fois** pour toute l'app : lance `restoreSession()` au mount (`useEffect`), rend `<Outlet/>` + `<TanStackRouterDevtools/>` (c'est ici que la session est restaurée, plus dans `App.tsx`)
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
- Routes **matches** : ✅ le cycle de matchmaking complet est fait (B5b + B5c : créer / lister / accepter / annuler / mes matchs / détail). **Reste** : **soumission de résultats** (§5.3/§5.4 : les deux camps déclarent un score → accord = `completed`, désaccord = `disputed`, timeout), puis **calcul de l'ELO** (K=32, départ 1000) et écriture dans `rankings` (table encore vide → le leaderboard renvoie `[]`)
- Routes **disputes** (ouverture, evidence upload, résolution admin)
- **Notifications système** — pas commencé (« ton défi a été accepté », « l'adversaire a soumis un score », « une dispute est ouverte »)
- Migrer la présence chat vers Redis (optionnel)

> ⚠️ Il n'y a **pas** de « matchmaking worker » à écrire. Cette ligne a longtemps figuré ici par erreur (« file d'attente, matching par ELO — la pièce centrale ») : **c'est faux**, le modèle est challenge/accept et il est **déjà implémenté**. Voir l'encadré du concept en haut du fichier.

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

### Sécurité

- `.env` jamais commit, `.env.example` versionné (obligatoire sujet)
- Backend **HTTPS partout**, mots de passe forts hashés+salés, validation front **ET** back
- Backend écoute sur `0.0.0.0`

---

## 🚨 Pièges déjà rencontrés

1. **Espaces dans `.env`** : `VAR=valeur` sans espaces
2. **Volume Postgres persiste** : changer `POSTGRES_USER/PASSWORD` après init → `docker compose down -v`
3. **Hot reload WSL2 + Docker** : polling obligatoire (`CHOKIDAR_USEPOLLING=true` ; `server.watch.usePolling` Vite)
4. **Fastify host** : toujours `host: '0.0.0.0'`
5. **Nom de service ≠ localhost** dans le réseau Docker (`postgres:5432`)
6. **Fastify affiche `127.0.0.1`** même en écoute `0.0.0.0` (cosmétique)
7. **`node_modules` dans bind mount** : volume anonyme `/app/node_modules`. ⚠️ Ce volume ne se met **pas** à jour tout seul quand une dépendance est ajoutée → erreur Vite `Failed to resolve import` pour les coéquipiers. Fix : back **et** front font `npm install` au démarrage (`CMD ["sh","-c","npm install && npm run dev"]` dans les deux Dockerfiles) → le volume se resynchronise à chaque `docker compose up` (ticket I1)
8. **Enum Drizzle sans `export`** non détecté par drizzle-kit → migration cassée. Toujours `export const xxxEnum = pgEnum(...)`
9. **Interop CJS `@fastify/oauth2`** + `verbatimModuleSyntax` : workaround `(oauth2 as any).GOOGLE_CONFIGURATION`
10. **F0 front = fondation visuelle uniquement** : ne pas traiter `App.tsx` comme une vraie page login ; elle sert seulement de référence DA temporaire
11. **Certificat HTTPS dev** : générer `backend/certs` avec `subjectAltName=DNS:localhost,IP:127.0.0.1`, puis accepter `https://localhost:3000/ping` dans le navigateur avant d'utiliser le front
12. **Migrations obligatoires au 1er lancement** : `docker compose exec backend npx drizzle-kit migrate`, sinon `register/login` plantent car la table `users` n'existe pas
13. **`docker compose up -d` NE SUFFIT PAS à avoir un backend qui répond.** `server.ts` fait `await ensureBucket()` (MinIO) **avant** le `listen()`. Si le conteneur `minio` n'est pas démarré, l'appel échoue et le process sort en `process.exit(1)` — mais le conteneur backend reste **« Up »** (`tsx watch` tourne toujours) et le port 3000 **accepte la connexion TCP** (via docker-proxy). Symptôme : le handshake TLS échoue, `curl` semble « bloqué », et rien dans `docker compose ps` n'a l'air anormal. → Vérifier `docker compose ps` (tous les services), puis `docker compose logs backend`. Piège trouvé par une review externe (14/07).
14. **Un check en code n'est JAMAIS atomique** (leçon de la review de B5c). Entre le moment où tu lis (« ce joueur est-il libre ? ») et celui où tu écris, une autre requête a pu changer le monde — c'est le TOCTOU. Un `UPDATE ... WHERE status='pending'` ne sérialise que les acteurs qui visent **la même ligne** ; deux requêtes sur des **lignes différentes** passent toutes les deux. Pour un invariant qui porte sur un **acteur** (« un seul match actif par équipe »), il faut un **verrou** (`pg_advisory_xact_lock`) **et** re-jouer la vérification **dans** la transaction, sous ce verrou. Cf. `isLockedOut` / `hasOpenSlot` / `lockCompetitors` dans `routes/matches.ts`.
15. **Verrous multiples → les prendre dans un ORDRE DÉTERMINISTE** (trier les clés). Sinon : A verrouille x puis attend y pendant que B verrouille y puis attend x → **interblocage**. Postgres le détecte et tue une transaction → **500 sur un conflit métier normal**. C'est arrivé sur l'acceptation croisée (alice prend le slot de bob pendant que bob prend celui d'alice). L'acquisition ordonnée est le remède canonique.
16. **Les fenêtres de temps se comparent avec des inégalités STRICTES** (`<`, jamais `<=`) — cf. `hasConflictingMatch()`. Deux matchs qui se **touchent** (21h–22h puis 22h–23h) ne se chevauchent **pas** : c'est ce qui autorise l'enchaînement dos à dos, le cas d'usage central de B5d. Écrire `<=` par réflexe casse la feature sans rien faire échouer d'évident.
17. **Un slot périmé ne doit bloquer personne.** Le job d'expiration tourne à la minute : il existe donc toujours une fenêtre où un slot est **mort mais encore `pending`** en base. Tout ce qui compte les slots (check de conflit, plafond, liste publique) doit **les ignorer** — sinon un slot mort empêche son propre créateur d'en rouvrir un. Ne jamais se reposer sur le seul statut en base.
18. **Tester une course sans barrière ne prouve RIEN.** Deux threads lancés à la suite démarrent en décalé et ne se croisent jamais : le test **passe** alors que le bug est bien là. Faux négatif — pire qu'aucun test. Utiliser `threading.Barrier` et **répéter** (une course ne se déclenche pas à tous les coups). L'interblocage ci-dessus a été masqué comme ça au premier essai.

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
docker compose up -d              # démarrer l'infra
docker compose ps                 # état
docker compose logs -f <service>  # logs
docker compose exec <service> sh  # entrer dans un conteneur
docker compose down               # arrêter (garde les données)
docker compose down -v            # DANGER : supprime les volumes
docker compose up -d --build <service>  # rebuild après modif Dockerfile
```

**UIs locales** : Front (5173), Adminer (8080), redis-commander (8081), MinIO console (9001), Backend API (3000, HTTPS).

---

## 🎯 Prochaine action immédiate

**Backend — Ticket B5c terminé sur `feature/b5c-accept-match`** (accept / annuler / mes matchs / détail enrichi ; **164 tests verts** ; openapi à jour). Deux passes de review absorbées : courses concurrentes + fuite d'autorisation.

- Reste hors code : review locale par un coéquipier, puis merge sur `master` (Trello → Done). Penser à intégrer `origin/master` avant (le front a bougé).
- **Ticket backend suivant : B6 — soumission de résultats** (§5.3/§5.4). Les deux camps déclarent un score ; accord → `completed` ; désaccord → `disputed` ; timeout. Puis **calcul ELO** (K=32, départ 1000) → `rankings` (la table est encore vide, donc le leaderboard renvoie `[]`).

**Frontend — F0-B (routing TanStack + home + garde de route) implémenté** sur `feature/f0b-routeur-base-home`.

- Routing branché, home/landing + login UI en place, garde `/dashboard` fonctionnelle. Reste le **câblage auth des formulaires** (login/register non soumis au back).
- Ticket suivant : **câbler le formulaire de login** (`login` → `setSession` → `redirect`), puis register/2FA, puis les vraies pages profil/social.
- Les stubs `/home`, `/register`, `/privacy`, `/terms`, `/dashboard` restent à remplir.
- ⚠️ **Types d'API côté front** : le front **écrit ses propres types à la main**, dans un fichier de contrat unique (`frontend/src/types/api.ts`). **Ne jamais importer les types du backend** : ils décrivent la DB, pas le JSON (`scheduledAt` est un `Date` côté back mais arrive en **`string` ISO** au front — le type partagé mentirait). Une codegen depuis `openapi.yaml` (`openapi-typescript`) est un **ticket futur back+front**, à faire seulement **après** avoir passé les réponses du YAML en `components/schemas` réutilisables.

---

_Dernière mise à jour : 13 juillet 2026_
