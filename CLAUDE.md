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

| Module                                         | Type  | Points | État                                   |
| ---------------------------------------------- | ----- | ------ | -------------------------------------- |
| Frameworks front + back                        | Major | 2      | ✅                                     |
| Standard user management                       | Major | 2      | ✅                                     |
| Real-time WebSocket                            | Major | 2      | ✅ (chat)                              |
| User interaction (chat + profil + amis)        | Major | 2      | ✅                                     |
| **Organization system** (= nos **teams**, B5a) | Major | **2**  | ✅ **déjà codé** — remplace Game stats |
| ORM (Drizzle)                                  | Minor | 1      | ✅                                     |
| OAuth 2.0                                      | Minor | 1      | ✅                                     |
| 2FA TOTP                                       | Minor | 1      | ✅                                     |
| File upload                                    | Minor | 1      | ✅ (avatar MinIO)                      |
| Notification system                            | Minor | 1      | ✅ (B9)                                |
| **TOTAL**                                      |       | **15** |                                        |

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

**Frontend** : Vite 8 + React 19 + TypeScript + Tailwind v4 — _fondation F0 + F0-A + F0-B, Register FR1, révision DA F0-D, et coquille **F-Nav** + pages Teams/Ranking (codegen OpenAPI `api-types.gen.ts`) mergés_

- ✅ **Fondation visuelle F0 mergée** : tokens Tailwind v4 dans `src/index.css`, composants UI de base (`Button`, `Input`, `Label`, `Card`), config shadcn-like `components.json`, alias `@/*`, helper `cn()`
- ✅ **F0-A implémenté et testé** : client API `fetch` + store auth Zustand (`user`, `accessToken`, `ready`, restauration `refresh → me`, retry unique sur 401)
- ✅ **F0-B routing + home mergé / Trello Done** : TanStack Router **file-based** branché (plugin Vite génère `routeTree.gen.ts`), pattern route/page, root layout global (restore session au mount), garde de route sur `/dashboard`, page home/landing arène complète + base visuelle de Login
- ✅ **FR1 Register implémenté et testé** : formulaire RHF + Zod, inscription classique, session Zustand, erreurs API, Google OAuth complet et redirection `/home`
- Libs front : **TanStack Router branché** + TanStack Query (installé), Zustand, React Hook Form, Zod + `@hookform/resolvers`, `@fontsource/geist`, `lucide-react`, `clsx`, `tailwind-merge`
- ⚠️ **Pages restantes** : `/`, `/register` et `/login` ont une vraie UI ; **FR2 Login + 2FA est mergé**. `/home`, `/privacy`, `/terms` et `/dashboard` restent des stubs. `App.tsx` supprimé (renommé `pages/login.tsx`)
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
│   ├── openapi.yaml         # contrat d'API (à jour : auth, users, social, teams, matches)
│   ├── tests/               # tests e2e Python (run_all.py — 13 suites, 443 cas) + unit/ (Vitest) + README
│   ├── drizzle/             # migrations 0000 → 0018 (19 migrations) + meta
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
│       │   ├── matches.ts     # cycle complet : créer/lister/accepter/annuler/mes matchs/détail (B5b+B5c) + soumettre résultat (B6)
│       │   ├── notifications.ts  # (B9) mes notifs : liste paginée par curseur + read + read-all
│       │   └── search.ts      # recherche globale préfixe joueurs + teams (prefix /search)
│       ├── jobs/             # planificateur (setInterval) : slots périmés (B5d) + fantômes & auto-confirmation 24h (B6) + auto-cancel disputes (B7) — les 3 jobs 24h notifient les 2 camps (B9)
│       ├── utils/            # rankings.ts (applyMatchElo, completeMatchWithElo — B6), elo.ts (K=32), leaderboard.ts, blocks.ts, notifications.ts (notify/pushNotifications — B9)
│       ├── storage/          # minio.ts, redis.ts
│       └── types/            # env.d.ts, fastify-jwt.d.ts, fastify-oauth2.d.ts
│
├── frontend/                # F0 + F0-A + F0-B + FR1 + FR2 en place (routing, home, register, login + 2FA)
│   ├── Dockerfile, docker-entrypoint.sh
│   ├── components.json       # config shadcn-like
│   ├── package.json          # TanStack Router + Query, Zustand, RHF, Zod/resolvers, Geist, lucide, clsx...
│   └── src/
│       ├── main.tsx          # createRouter(routeTree) + RouterProvider (plus d'App.tsx)
│       ├── routeTree.gen.ts  # généré par le plugin TanStack — PLUS VERSIONNÉ (gitignoré depuis `0df06ef`), régénéré au démarrage de Vite
│       ├── index.css         # source de vérité visuelle : tokens Tailwind + @utility (panel/label-caps/focus-ring) + utilitaires arène
│       ├── routes/           # wrappers file-based createFileRoute : __root, index, home, login, register, privacy, terms, dashboard (gardé)
│       ├── pages/            # composants : index (landing), register (FR1), login (FR2 + 2FA), home/privacy/terms (stubs)
│       ├── stores/           # auth-store.ts (Zustand session — F0-A)
│       ├── lib/              # api.ts, api-config.ts, schémas Zod register/login, utils.ts (cn())
│       ├── types/            # auth.ts
│       ├── data/             # games.ts : maps assets (images/logos/icons) + gameOrder + gameHref, clés = id back
│       ├── assets/           # images/ (bg.webp hero, google-g.png, <jeu>.webp), logos/, icons/
│       └── components/
│           ├── ui/           # button, button-variants (buttonClasses), input, label, card, form-message, password-input, avatar, menu-item, icon-menu-item
│           ├── auth/         # composants partagés Register/Login : layout, carte, formulaire, divider, options, langue, Google
│           ├── layout/       # RootLayout, LeftNav, RightNav, AuthNav, SiteFooter, Logo, SiteLogo (⚠️ deux logos, fusion à arbitrer)
│           ├── landing/      # vitrine publique : HeroBanner, LandingNav
│           ├── games/        # GameAsset + coquilles GameLogo/GameIcon/GameImage, GamesCards, GameInfo, GamesFallback (+ previews non montées)
│           └── home/         # ⚠️ MAL NOMMÉ : contient du teams/ranking (LadderSelect, RankingTable, TeamCreation, SearchBar, LinkAccountBanner)
│
└── data/                    # volumes bind-mount Postgres/MinIO (NON versionné)
```

---

## ✅ État d'avancement (au 18 juillet 2026)

### Infrastructure — I2 + I3 mergés

- ✅ **I2 — images Compose reproductibles** (mergé) : noms de registres complets et tags figés pour PostgreSQL 17.10, Redis 8.8.0, Adminer 5.4.2 et MinIO `RELEASE.2025-09-07T16-13-09Z`. Redis Commander migre de l'ancienne image Docker Hub `0.7.2-rc3` vers l'image officielle maintenue `ghcr.io/joeferner/redis-commander:0.9.1`.
- ✅ **I3 — bootstrap en une commande** (mergé, empilé sur I2) : auth Redis effective, clients backend/Redis Commander authentifiés, healthchecks + `depends_on: service_healthy`, certificat auto-signé dans `backend_certs`, migrations automatiques avant le backend, builds `npm ci` et resynchronisation conditionnelle des volumes selon le hash des lockfiles.
- ✅ Validé avec Podman : deux cycles `podman compose down` puis `podman compose up -d --build`, tous les services sains/accessibles ; Redis refuse sans mot de passe et répond avec authentification ; 12 tests backend passent ; build frontend passe ; lint frontend avec 0 erreur et 0 warning après le correctif Fast Refresh empilé sur I3.
- ⚠️ Le `.env` reste une configuration préalable volontaire : copier `.env.example`, remplacer les `changeme`, puis lancer Compose. Les certificats et migrations ne demandent plus de commande manuelle.

### Backend — TERMINÉ et fonctionnel

**Auth & user** (étapes 1-4) :

- Docker/Podman Compose (Postgres/Redis/MinIO/Adminer + hot reload), HTTPS auto-signé automatique, migrations automatiques, `.env.example`
- Drizzle ORM ; table `users` : id, pseudo, email, password_hash (nullable, OAuth), display_name, bio, avatar_url, oauth_provider/oauth_id (UNIQUE composite), totp_secret, totp_enabled, **is_admin**, created_at, updated_at
- JWT access 15 min + refresh cookie httpOnly/Secure/SameSite=Strict/Path=/auth ; bcryptjs cost 12
- Endpoints auth : `register`, `login`, `me`, `refresh`, `logout`
- **OAuth Google** : linking 3-cas (A déjà lié / B liaison par email / C nouveau compte), `googleOAuth2` plugin ; callback pose le refresh cookie puis redirige vers `${FRONTEND_URL}/home`
- **2FA TOTP** (speakeasy) : `setup`/`enable`/`disable`/`verify` ; tempToken 5 min `{ pending: 'totp' }` ; décorateur `authenticate` rejette les tokens `pending` ; strip `totpSecret`/`totpEnabled` dans tous les handlers
- **Profil** : `GET/PATCH /users/me`, `GET /users/:pseudo` (public, strip privé), `POST /users/me/avatar` (MinIO, validation MIME, 2 MB)

**Social** (étape 5) :

- **Amis** (`/friends`) : 6 endpoints (request avec auto-accept sens inverse, list, requests, accept, reject=DELETE, unfriend)
- **Blocks** (`/blocks`) : bloquer/débloquer un user (supprime l'amitié au passage), helper `isBlocked`
- **Chat DM temps réel** (`/ws/chat?token=`, `chat.ts`) : auth par token en query, garde "amis acceptés uniquement" + check blocks à chaque message, persistance en DB, heartbeat ping/pong 30s. Double mécanisme de présence : **Map mémoire `userSockets`** (routage des sockets, obligatoire) + **Redis `online_users`** (`sAdd`/`sRem`). Events émis : `initial_presence` (à la connexion), `presence` (broadcast aux amis on/offline), `message`/`message_sent`, `error`. Multi-socket par user géré (premier/dernier socket)
- **Historique DM** (`GET /messages/:friendId`) : REST, gardes amis + blocks, 100 derniers messages chronologiques
- ✅ **Recherche globale — `GET /search?q=`** (`search.ts`, prefix `/search`) : recherche **préfixe** joueurs (`pseudo`) + teams (`name`), **insensible à la casse**. 🔑 **La mise en minuscules est faite par POSTGRES des deux côtés** (`lower(col) LIKE lower($1)`), jamais par JS : `toLowerCase()` et `lower()` divergent sur l'Unicode (le `İ` turc devient `i` + point combinant en JS, simple `i` en SQL → le pseudo `İpek` était introuvable). ⚠️ **Un index fonctionnel btree ordinaire n'accélère PAS un `LIKE`** sous la collation `en_US.utf8` de la base : `users_pseudo_lower_unique` (0015) restait inutilisé, `EXPLAIN` donnait un Seq Scan même avec `enable_seqscan=off`. Migration **`0018`** : `users_pseudo_lower_prefix_idx` et `teams_name_lower_prefix_idx` en **`text_pattern_ops`** (comparaison octet par octet → le planificateur réécrit le préfixe en intervalle : `~>=~ 'bob' AND ~<~ 'boc'`, **Index Scan**). ⚠️ **Pas** d'index inverse sur `blocks.blocked_id` : le `NOT EXISTS` étant **corrélé**, `users.id` est fourni au sous-select et `blocks_pair_unique` sert aux **deux** sens (vérifié à l'EXPLAIN) — il aurait été mort. ⚠️ Ces index **ne sont pas dans les snapshots Drizzle** (classe d'opérateurs sur expression, non exprimable) — un commentaire au-dessus de `usersTable` dans `schema.ts` les liste pour qu'un `drizzle-kit generate` ne propose jamais de les supprimer. `q` validé Zod (trim, 2-50 → **400**). **Jokers SQL échappés** (`escapeLike` : `\ % _` → littéraux, sinon `a%` matcherait tout). **Blocages exclus dans les 2 sens** via un **`NOT EXISTS` corrélé** (Postgres s'arrête à la 1re ligne, rien ne remonte dans Node ; teams non filtrées). 🔑 **Une SEULE requête `UNION ALL`** : les deux sources sortent sur une forme commune (`kind/id/sort_key/label/…`), donc le **tri et la pagination sont GLOBAUX** — une team peut précéder un joueur, `limit` borne la **liste finale** et `offset` découpe la liste **fusionnée**. Ordre **total** (`sort_key, kind, id`) : sans départage des ex æquo, deux appels pourraient permuter deux lignes et `offset` sauterait ou dupliquerait un résultat. Réponse : liste taggée `type:'user'|'team'` (union discriminée) + **`hasMore`** (on demande `limit + 1` lignes, la ligne de rab dit qu'il reste une page — pas de `COUNT` global), **projection explicite** (jamais email/hash). 🎯 **Module « Advanced search » (Minor, 1 pt)** : le sujet exige **filters + sorting + pagination** — les 3 portent bien sur le résultat exposé. **Filtre** `?type=user|team` (absent → les deux ; `type=team` n'interroge même pas `blocks`). **Pagination** `?limit=` (1-50, défaut 10) + `?offset=` (≥0, défaut 0) ; sans params le comportement d'origine est préservé. Testé : **`tests/test_search.py` — 46 cas versionnés** (gardes, tri global entrelacé, pagination sans trou ni doublon, filtre, casse, Unicode `İ`, échappement, blocages 2 sens, projection, zéro match). Vérifiés **rouges sur l'ancien code** (12 ❌) avant correction — un test qui ne tombe jamais ne prouve rien. **openapi.yaml fait**, **`api-types.gen.ts` régénéré**. Alimente la barre de recherche du rail gauche (cartes F-Nav) ; la barre « ajouter un ami » reste sur `GET /users/:pseudo` (exacte).
  ⚠️ **Piège de test rencontré** : un `DELETE ... WHERE pseudo LIKE 'zsrch%'` est **sensible à la casse** alors que la recherche, elle, ne l'est pas → un résidu `ZsrchGamma` survivait au nettoyage et faussait les comptages. Nettoyer avec `lower(pseudo) LIKE ...`.
- **Suppression de compte** (`DELETE /users/me`) : exige password (si compte local) + code TOTP (si 2FA), supprime l'avatar MinIO, clear cookie
- ✅ **Changer son mot de passe — BA1** (`PATCH /users/me/password` `{ currentPassword, newPassword }`) : `currentPassword` comparé au hash (**401** si faux), `newPassword` validé par la **même règle Zod que register** (≥8, 1 maj/min/chiffre/spécial → **400**), `hashPassword` (bcrypt cost 12) + update. Compte **OAuth-only** (`passwordHash` null) → **400** (définir un 1er MDP = flux séparé, hors MVP). Rate-limit **5/min** par route. ⚠️ **Sessions/refresh existants NON invalidés** (JWT `{ sub }` sans version/blocklist — pas d'infra de révocation). Testé curl (8 cas + OAuth-only). openapi + CLAUDE faits.
- Sécurité transverse : CORS (5173, credentials), rate-limit global 100/min + limites par route (register 3, login 5, 2fa/verify 5, avatar 3, **password 5**)

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
  - **`POST /:id/accept`** `{ lineup? }` : engage le side 1. **Garde anti-auto-accept** — ⚠️ **par `team_id` en 2v2+**, mais **par `user_id` en 1v1** (les deux sides y ont `team_id = NULL` : comparer les teamId ne détecterait rien et refuserait _tous_ les accepts solo). En **transaction** : update **conditionnel** (`WHERE status='pending'` + `.returning()` → tableau vide = deux accepts simultanés → **409**) posant `status='in_progress'` + **`started_at = now()`**, puis side 1 + participants, puis **annulation des slots `pending` restants des deux camps** (**par team** en 2v2+ — annuler par joueur raterait un slot dont la lineup est disjointe ; **par joueur + filtre ladder** en solo). Sans cette annulation, une 3e équipe accepterait le slot d'un camp déjà en match → **deux matchs actifs, lockout contourné**. Body **facultatif** (`request.body ?? {}` : en 1v1 le client n'envoie rien).
  - 🔑 **Le lockout §5.2 est ENFIN ARMÉ** : `started_at` restait `NULL` partout, donc `started_at + lockout_minutes > now()` ne pouvait jamais être vrai. La règle existait depuis B5b mais était **dormante**. C'est l'accept qui la réveille. ⚠️ **HISTORIQUE — remplacé par B5d** : ce lockout basé sur `started_at` a été abandonné au profit de la **disponibilité par fenêtre** sur `scheduled_at` (voir bloc B5d ci-dessous). `started_at` n'est plus lu par aucune règle.
  - **`DELETE /:id`** : annuler **son** slot ouvert → `status = 'cancelled'` (on **n'efface pas** : historique conservé). Créateur = **side_index 0** (capitaine en 2v2+, joueur en 1v1). Idempotent (200). Update conditionnel → **409** si quelqu'un a accepté entre-temps.
  - **`GET /me`** : mes matchs, **deux sources** — (A) je suis dans `match_participants` (mes solos + les matchs où j'étais **aligné**), (B) une de mes teams est sur un side (→ **le remplaçant sur le banc voit le match de sa team** ; sans B il serait invisible, il n'a aucune ligne participant). Union dédoublonnée (un match d'équipe où j'ai joué remonte des **deux** sources). **Rien n'est masqué** ici (maps visibles). Aucun match → `[]`, pas 404.
  - **`GET /:id` enrichi** : rend l'**objet team** (nom, logo, `captainId` — `null` en 1v1) et les **joueurs** (pseudo, avatar) au lieu d'ids bruts, sides **triés** (0 = créateur, 1 = accepteur). **Deux requêtes seulement** quel que soit le nombre de joueurs (ids collectés → 2 `SELECT` → indexés dans des `Map` → assemblage en mémoire) : **pas de N+1**. Projection **explicite** sur `users` (jamais de `select()` nu : fuite `email`/`passwordHash`). Garde « participants only » inchangée (banc compris).
  - Testé **end-to-end** : **246 cas verts** (`cd backend/tests && python3 run_all.py`) — 10 suites. **openapi.yaml fait**.
- ✅ **Le TEMPS : grille horaire, fenêtres de disponibilité, expiration — B5d** : **aucune migration** (`scheduled_at` et l'index `(status, scheduled_at)` existaient déjà, ils n'étaient juste **jamais lus**).
  - 🔑 **`scheduled_at` est LA référence temporelle.** La plateforme n'a **aucune source de vérité** sur le vrai coup d'envoi (elle ne voit pas la partie Valorant), donc elle ne fait pas semblant : elle se fie à l'heure annoncée. **`started_at` n'enregistre plus que l'instant de l'acceptation — AUCUNE règle ne le lit.** Avant B5d, §5.2 et §5.3 s'appuyaient dessus : un slot à 21h accepté à 20h30 voyait son lockout expirer **au coup d'envoi**, et les équipes redevenaient « libres » **pendant qu'elles jouaient**.
  - **Grille** : `scheduled_at` doit tomber sur un **quart fixe** (`:00`/`:15`/`:30`/`:45`, secondes et ms à 0) et être à **≥ 15 min** dans le futur — pour **créer** comme pour **accepter**. Borne **incluse** (20h45:00 passe, 20h45:01 non).
  - 🔑 **§5.2 réécrit — disponibilité par FENÊTRE.** Chaque match occupe `[scheduled_at, scheduled_at + lockout_minutes]`. Un camp ne peut pas avoir deux matchs dont les fenêtres se **chevauchent**. Les slots `pending` comptent autant que les matchs actifs. **Remplace « un seul slot ouvert » ET le lockout** : `hasOpenSlot()` + `isLockedOut()` **fusionnent** dans `hasConflictingMatch()`.
  - ⚠️ **Le « camp » est PAR LADDER, pas par personne** (décision du 14/07, après une review externe). En 2v2+ = la **team** ; en 1v1 = le couple **(joueur, ladder)**. Conséquence **assumée** : un joueur peut avoir un match d'échecs **et** un match Rocket League à 21h ; un joueur dans deux teams sur deux ladders peut être aligné deux fois. **Ce n'est PAS un bug — ne le « corrigez » pas.** Raison : la plateforme n'observe pas les parties, le mécanisme dispute/forfait corrige déjà l'absence, et c'est une **responsabilité humaine** (le capitaine engage son équipe et doit avoir l'accord de ses joueurs ; si l'un ne vient pas, c'est **sa** team qui perd par forfait). À écrire dans les **Terms of Service** (`/terms`, obligatoire pour le sujet). ⚠️ **Limite connue** : le capitaine ne _voit pas_ qu'un joueur est déjà pris ailleurs → ticket futur « informer sans bloquer » (comme `hasLinkedAccount`).
  - ⚠️ **INÉGALITÉS STRICTES** (`gt`/`lt`, jamais `gte`/`lte`) : deux fenêtres qui se **touchent** (21h–22h puis 22h–23h) **ne se chevauchent pas** → l'enchaînement **dos à dos** est autorisé. C'est le cas d'usage central : une team ouvre **21h, 23h et 01h** en même temps et planifie sa soirée. Écrire `gte`/`lte` casserait la feature.
  - ⚠️ **Option A resserrée** : accepter un match n'annule QUE les slots qui **chevauchent** sa fenêtre. Avant, il les annulait **tous** — accepter le match de 21h aurait détruit les slots de 23h et 01h.
  - 🔑 **Le point le plus subtil : ce qui bloque DÉPEND de l'action.** `hasConflictingMatch()` prend les **statuts en paramètre**. À la **création** → `ENGAGING_STATUSES` (`pending` **+** actifs) : je ne peux pas _proposer_ deux créneaux qui se chevauchent. À l'**accept** → `LOCKING_STATUSES` (**actifs seulement**) : mes slots `pending` qui chevauchent ne me bloquent **pas**, ce ne sont que des propositions — et l'option A va justement les **retirer** quand je m'engage. Les compter reviendrait à me refuser un match à cause d'une offre que je m'apprête moi-même à annuler. _(Bug trouvé par les tests, pas à la relecture.)_
  - **Expiration** : un slot `pending` sous la barre des 15 min est **périmé** → masqué de `GET /matches?ladderId=`, refusé à l'accept (**409**), **ignoré** par le check de conflit et par le plafond (sinon il **bloquerait son propre créateur**), et passé à `cancelled` par le **job**.
  - **Plafond** : **5 slots ouverts max** par camp et par ladder (anti-spam).
  - 🆕 **Planificateur** (`src/jobs/index.ts`) : un `setInterval` à la minute, branché dans `server.ts` après le `listen`. **La seule partie du backend qui tourne sans requête HTTP.** Un `try/catch` autour du tick — un job qui plante ne doit jamais tuer le serveur. ✅ **B6 y a ajouté** `cancelStaleMatches` (fantômes) + `autoConfirmMatches` (confirmation auto 24 h, sous verrou). ✅ **B7 y a ajouté** `autoCancelDisputes` (dispute `open` +24 h → match `cancelled`, ELO inchangé, sous le même verrou).
  - `docs/schema.md` **§5.2 et §5.3 réécrits** — le design était en retard sur l'UX.
- ✅ **Seed games/ladders fait** : les 5 jeux + 9 ladders sont insérés **dans les migrations `0008`/`0009`** (`INSERT ... ON CONFLICT DO NOTHING`, idempotent) — pas de script `seed.ts` séparé. Un `drizzle-kit migrate` sur clone neuf peuple donc les tables. ⚠️ La table `rankings` **se remplit depuis B6** : dès qu'un match passe `completed` (accord des deux camps ou auto-confirmation 24 h), l'ELO est écrit → le leaderboard renvoie de vrais classements. Elle n'est `[]` que sur un ladder où aucun match n'a encore été joué. Pour des faux classements en local sans jouer : `npm run seed:dev` (script dev-only `backend/src/scripts/seed-dev.ts`, faux users/teams — **jamais** dans une migration).
- ✅ **Règles business §5.1 → §5.4 codées** (`docs/schema.md`) : liaison de compte requise pour jouer (§5.1), **disponibilité par fenêtre** (§5.2, **modèle B5d** : `[scheduled_at, scheduled_at + lockout_minutes]`, chevauchement interdit, inégalités strictes ; `started_at` n'est plus lu), et **soumission de score + accord/dispute + ELO** (§5.3/§5.4, **B6** : K=32, départ 1000, écriture dans `rankings`), et **disputes (§B7)** : dépôt preuve+message, arbitrage admin, job 24 h auto-cancel — la sortie de l'état `disputed` est codée.
- ✅ **Tests — deux niveaux, deux outils** (`backend/tests/`) :
  - **Unitaires (Vitest)** — `npm test` (`tests/unit/` : `elo`, `leaderboard`, `password`). Réservés aux **helpers purs**, sans DB ni HTTP.
  - **End-to-end (Python, stdlib seule)** — `cd backend/tests && python3 run_all.py` : **13 suites, 443 cas** (+ cas jobs via `B6_JOBS=1` / `B7_JOBS=1` / `B9_JOBS=1`) qui tapent sur le **vrai** backend et la **vraie** base de dev, sans mocks. Les users de test sont créés puis **supprimés** (motif `^(alice|bob|carol|dave|erin)[0-9a-f]{8}$`) → les données de l'équipe ne sont jamais touchées. `helpers.py` gère le rate-limit de `register` (3/min) et l'accès SQL direct (pour forcer des états que l'API ne permet pas encore d'atteindre). Voir `backend/tests/README.md`.

### Frontend — F0 + F0-A + F0-B + FR1 + F0-D + F-Nav + FR2 (Login + 2FA) mergés

**Fondation design F0 mergée** :

- `frontend/src/index.css` est la **source de vérité visuelle** : tokens Tailwind v4 couleurs, polices, radius, shadows, styles globaux et utilitaires DA
- DA retenue : fond sombre compétitif et sobre ; rappels rouge/bleu ; action principale **indigo nocturne** `action-primary` ; pas de texte courant en gradient
- Composants UI de base : `Button` (`primary`, `secondary`, `ghost` ; le variant primaire porte son style complet), `Input`, `Label`, `Card` translucide à 84 % + `CardHeader`/`CardContent`/`CardFooter`, `FormMessage` et `PasswordInput`
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

**Register FR1 implémenté, testé et mergé** :

- **DA Register finalisée** : carte sombre translucide, wordmark géant `V/S` Geist 900 découpé par une barre oblique responsive, teintes rouge/bleu en fondu, titre `VS MODE`, interface en anglais par défaut, layout fixe `100dvh` avec fallback de scroll interne seulement si la hauteur est insuffisante
- **Formulaire** : `pseudo`, `email`, `password` avec toggle afficher/masquer ; React Hook Form + schéma Zod dans `lib/register-schema.ts`, validation initiale `onTouched` puis interactive, erreurs visibles seulement après saisie ou submit, espaces d'erreur stables et styles accessibles `aria-invalid` ; `pseudo` trimé et mot de passe limité à 72 caractères comme le backend
- **Inscription classique** : `POST /auth/register` via `apiFetch`, `setSession()` Zustand, état de chargement, gestion `400`/`409`/`429`/réseau, puis redirection vers `/home`
- **Google OAuth** : composant réutilisable `GoogleAuthButton` avec logo officiel ; redirection navigateur vers `/auth/oauth/google/start` ; callback backend corrigé pour poser le refresh cookie puis rediriger vers `${FRONTEND_URL}/home` ; session restaurée par le root layout (`refresh → me`)
- **Navigation** : `VS MODE` renvoie vers `/`, lien `/login`, sélecteur EN/FR/ES (traduction différée), liens `/terms` et `/privacy` sous la carte ; `RootLayout` adapte le titre à la route TanStack résolue (`VS MODE Connect` sur `/login` et `/register`, `VS MODE` ailleurs), sans flash de titre lors d'une redirection ; un utilisateur déjà connecté qui demande `/register` est redirigé vers `/`
- **Tokens** : couleur primaire globale passée à l'indigo nocturne (`#343579`) ; aucune couleur/police/radius/shadow écrite en dur dans `pages/register.tsx`
- **Testé avec backend réel** : inscription + session, validation sans requête backend, doublon `409`, OAuth Google, retour `/home`, restauration et accès à `/dashboard`. Vérifications : build/lint frontend, type-check + 12 tests Vitest backend, `git diff --check`

**Révision de la fondation DA F0 pour Register/Login — F0-D (`feature/f0d-register-design-system`)** :

- F0-D réinjecte dans la fondation visuelle du projet les décisions de DA affinées et validées pendant FR1 Register. Il ne constitue pas une nouvelle DA indépendante : il fait évoluer les tokens, variantes et composants partagés issus de F0 afin qu'ils puissent servir aux autres pages, en commençant par Login dans FR2.

- Le style complet du bouton primaire (fond, bordure, graisse et interactions) vit dans `Button` ; la largeur `w-full` reste un choix local du formulaire. L'opacité `bg-surface-card/84` devient le défaut de `Card`.
- `FormMessage` centralise le rendu accessible des erreurs et `PasswordInput` centralise le champ mot de passe avec affichage/masquage, sans embarquer de logique React Hook Form ou Zod.
- Les briques visuelles et interactives communes à **Register et Login** sont extraites dans `components/auth` : `AuthPageLayout` (décor V/S et barre responsive), `AuthCard`, `AuthCardContent`, `AuthCardFooter`, `AuthForm`, `AuthDivider`, `AuthLanguageSelector` et `AuthPageOptions`. Les sélecteurs CSS portent désormais des noms génériques `auth-*`, plus liés à une page précise.
- Register consomme ces composants sans changement de contrat API, de validation, de session ou de redirection. **FR2 réutilise désormais la même structure dans Login** afin que les deux pages partagent la même DA et les mêmes comportements.
- Vérifié en desktop, mobile, faible hauteur et zoom : la page elle-même ne scrolle pas, le fallback de scroll reste interne au shell, la barre continue de découper V/S et les interactions clavier/souris du sélecteur et du mot de passe fonctionnent. `npm run lint`, `npm run build` et `git diff --check` passent.

**Login FR2 mergé** (commit `26f908d`, branche `feature/fr2-login-2fa`) :

- `pages/login.tsx` consomme `AuthPageLayout`, `AuthCard*`, `AuthForm`, `PasswordInput`, `FormMessage`, `AuthDivider`, `GoogleAuthButton` et `AuthPageOptions` issus de F0-D ; l'ancienne duplication du décor et du toggle password est supprimée.
- Formulaire RHF + Zod (`lib/login-schema.ts`) : email uniquement, password, validation accessible et erreurs `400`/`401`/`429`/réseau. **Pas de « Forgot password » ni de « Stay signed in » cosmétique** : la récupération par email est hors périmètre et le backend pose actuellement le même refresh cookie 7 jours dans tous les cas.
- `POST /auth/login` est appelé sans Bearer ni refresh automatique. Réponse directe → `setSession()` + `/home` ; réponse `{ requires2FA, tempToken }` → écran code 6 chiffres dans la même route.
- L'écran 2FA appelle `POST /auth/2fa/verify` sans authentification Bearer ; le `tempToken` reste en mémoire et aucune session n'est écrite avant validation du code. Code invalide, token expiré et rate-limit ont des messages distincts ; retour au formulaire possible.
- Google OAuth reprend le même bouton et la même redirection que Register. `/login` reprend aussi la garde visiteur de `/register` et redirige un user déjà restauré vers `/`.
- Testé avec le backend réel et Chromium headless : mauvais password → message générique ; branche session directe → `/home` ; branche 2FA réelle (setup + TOTP) → vérification puis `/home`. `npm run lint`, `npm run build` et `git diff --check` passent.
- ⚠️ **Observation dev à traiter hors FR2** : dans Chromium headless, le cookie refresh `Secure; SameSite=Strict` posé par `https://localhost:3000` n'est pas conservé lorsque la page vient de `http://localhost:5173` (contexte cross-scheme). La session Zustand fonctionne jusqu'au reload, mais la garde après rechargement ne peut alors pas restaurer l'user. À décider transversalement : frontend HTTPS/proxy same-origin de dev, ou politique de cookie adaptée après revue sécurité. Ne pas corriger uniquement dans Login : Register/OAuth/refresh sont concernés aussi.

**F-Nav — coquille de navigation + pages Teams & Ranking (commit `feat(frontend): partial F-nav`, sur `master` via `test/search-bar-ranking`)** :

- 🧭 **Coquille de navigation (F-Nav)** : rail gauche flottant `LeftNav` (`Logo` + menu `MenuItem` : play [stub], my teams → `/teams`, ranking → `/ranking`, find party [stub], games → `/games`) avec `AuthNav` épinglé en bas — sélecteur de langue EN/FR/ES **non câblé** + actions auth **réelles** (login/sign up hors session, profile/logout en session ; `logout` du store puis redirect `/`). Rail droit `RightNav` réutilisé de F0-B.
- 🗂️ **Layout de section `/teams`** (`pages/teams/route.tsx`) : porte les rails + `SiteFooter` et rend un `<Outlet/>`, pour que liste et détail ne répètent pas la coquille. Wrappers file-based : `routes/teams/route.tsx` (layout), `routes/teams/index.tsx`, `routes/teams/$teamId.tsx`.
- 👥 **Mes équipes (`pages/teams/index.tsx`)** : `GET /teams` puis **un `GET /teams/:id` par équipe en parallèle** (`Promise.all`) pour les visages du roster (un échec isolé → roster vide, jamais de page blanche). Filtre par jeu via `LadderSelect` mode `game`, bouton **Créer une équipe** → `TeamCreation`. Chaque `TeamCard` est un `<Link to="/teams/$teamId">`.
- 🛡️ **Détail équipe (`pages/teams/team-detail.tsx`)** : rôle spectateur (`Guest`/`Stranger`/`Member`/`Captain`), roster + couronne capitaine, **kick / quitter / dissoudre** (`leaveTeam` : dissolution `DELETE /teams/:id` capitaine → redirect `/teams` ; `DELETE /teams/:id/members/:userId` pour kick/quit — quitter soi-même → redirect, kick → maj optimiste du roster), bouton **Upload Avatar** (stub `alert` — pas d'endpoint logo team), retour `/teams`. ⚠️ **Ajout de membre via `SearchBar` COMMENTÉ** (dépend d'une recherche partielle de pseudo côté back non mergée — cf. bloc « tenu à l'écart »).
- ➕ **Création d'équipe (`TeamCreation`)** : `LadderSelect excludeSolo` + nom, `POST /teams`, erreurs mappées (409 nom pris / déjà dans une équipe sur ce ladder ; 400 Zod).
- 🎛️ **`LadderSelect`** : sélecteur jeu+format contrôlé, deux modes (`ladder` défaut → émet un ladderId ; `game` → émet un gameId), options `excludeSolo` et `all`. Charge `/games` + `/ladders` **une fois** et filtre en mémoire.
- 🏆 **Ranking (`pages/ranking.tsx`, routes `/ranking` ET `/games`)** : `LadderSelect` + `RankingTable` (consomme **B2** : `GET /ladders/:id/rankings`, tri ELO, avatar/pseudo ou nom/logo team, médailles top 3, états loading/erreur/vide). ⚠️ **Lignes non cliquables** : le leaderboard ne renvoie **pas d'id** de compétiteur (`shapeRankings` le jette) → pas de lien `/teams/:id` sans changement back.
- 🔤 **Codegen OpenAPI EN PLACE** : `frontend/src/lib/api-types.gen.ts` (généré via `openapi-typescript` depuis `openapi.yaml`) ; les pages importent `components['schemas']['TeamDetail' | 'TeamListItem' | 'Ladder' | 'Game' | …]`. **Remplace le contrat manuel** pour tout ce qui vient du YAML. ⚠️ La mise en garde `Date`→`string` ISO **reste vraie** (un `scheduledAt` arrive en string, ne pas le traiter comme un `Date`).
- ⚠️ **Stubs / non câblé** : `/profile` (« a faire mdr »), `LinkAccountBanner` (composant §5.1 prêt mais monté nulle part), sélecteur de langue, boutons `play` / `find party`, Upload Avatar team.
- ✅ `npm run build`, `tsc --noEmit` et `npm run lint` passent (2 **warnings** Fast Refresh non bloquants, préexistants à FR2, sur `routes/games.tsx` et `routes/profile.tsx`).

**Tenu à l'écart de ce commit (local uniquement, PAS sur origin)** : `SearchBar` (recherche partielle de pseudo, `components/home/SearchBar.tsx` untracked), l'endpoint back `GET /users?search=` (`ilike`, dans un `git stash`) et le type manuel `types/api.ts`. À reprendre quand le back de recherche sera prêt : décommenter l'import + le bloc « Add member » + la fonction `addMember` dans `team-detail.tsx`, puis committer les fichiers tenus à l'écart.

**FL — Landing publique (branche `feature/fl-landing-public`, REBASÉE sur `master` `1c8f7a6`) : vitrine `/` avant connexion** :

- **Objectif carte Trello [FL]** : vitrine publique `/` (cartes de jeux alimentées par le back, CTA login/register, footer PP/ToS, redirect si déjà connecté). **DoD faite** : `/` public, cartes `GET /games`, CTA login/register, footer PP/ToS, composants icônes/logos. **Reste** : **redirect si déjà connecté** → déplacé dans un **ticket garde de route** séparé, avec la structure en deux zones (voir plus bas).
- 🧭 **`LandingNav` (`components/landing/`) — nav PROPRE à la landing, distincte de `LeftNav`.** C'est la décision structurante de la branche : `LeftNav` est le rail de la **zone connectée** (routes `/teams` `/ranking` `/games`, positionnement `fixed`) et **n'est plus touché par la landing**. `LandingNav` ne garde que les entrées qui ont un sens sans session (pas de `play`, `find party`, `club`). ⚠️ **Réduit au logo + `AuthNav`** : les entrées `ranking`/`games` ont été retirées avant merge parce qu'elles étaient **sans `to`**, donc des `<button>` inertes. `/ranking` et `/games` existent sur master → à recâbler quand la landing aura sa nav définitive (voir barre mobile).
- ♿ **Le landmark est le rail lui-même** : `<nav aria-label="Main">` à la racine de `LandingNav`, pas un `<nav>` interne — le logo et les liens login/sign-up d'`AuthNav` sont **aussi** de la navigation. Le libellé distingue ce nav de celui du footer (`aria-label="Legal"`).
- 📐 **`SiteLogo` mis à l'échelle du rail** via **container query** : `@container` sur le `<nav>` + `text-[length:23cqw]` sur le logo — les `cqw` se résolvent contre la largeur du **rail**, pas du viewport (un `vw` déborderait dès que `max-w-[300px]` plafonne). ⚠️ `--font-display` est une **pile système** (pas Geist) : le rendu du wordmark diffère d'un poste à l'autre, la proportion est nominale.
- 📱 **Responsive partiel (assumé)** : `LandingNav` est `hidden md:flex` → **plus de nav ni de logo sous 768px**, les CTA du hero sont le seul accès à l'authentification. La barre horizontale mobile reste à faire. ⚠️ **Vrai bloqueur mobile non traité** : l'overlay `GameInfo` ne se révèle qu'en `group-hover`/`group-focus-within` → **infos des jeux inatteignables au tactile**.
- **Layout `pages/index.tsx`** : deux colonnes flex — `LandingNav` + colonne corps scrollable. **`h-dvh`** (et non `h-screen`) : `100vh` est calculé barre d'URL rétractée, donc avec `overflow-hidden` le bas de page devenait inatteignable sur mobile. Landmarks frères : nav / `<main>` (hero + cartes) / `<footer>`.
- **`GamesCards`** : cartes **fixes 300px** (`w-[300px] shrink-0`, image `aspect-square`) dans un `flex flex-wrap`. **Sémantique de liste** : `<ul role="list">` + `<li>` (le `role` explicite est requis — Safari retire les sémantiques de liste sur un `<ul>` en `display:flex`), et `<section aria-labelledby>` relié au `<h2>` via **`useId()`**. ⚠️ Sous ~332px de large, les cartes débordent (prix de la taille fixe).
- **Données (`lib/games.ts`)** : `useGames()` (`GET /games`) + `useLadders()` (`GET /ladders`), `staleTime` 1 h ; helpers purs `sortGames` (ordre `data/games.ts`), `formatsForGame`, `useSortedGames`. ⚠️ **Types `Game`/`Ladder` écrits à la main** — à basculer sur `lib/api-types.gen.ts` (codegen OpenAPI, arrivée avec F-Nav) : **dette identifiée, non traitée**.
- **`buttonClasses` (`components/ui/button-variants.ts`)** : style extrait de `button.tsx` (règle Fast Refresh) et partagé par `Button` **et** les `<Link>` stylés bouton du hero. ⚠️ **Fusionné au rebase** avec les apports de master : 4 variantes (`primary`/`secondary`/`ghost`/**`danger`**) et bordure + `font-semibold` sur `primary`.
- **Assets** (`frontend/src/assets/`) : `images/*.webp` (512²), `logos/*.png`, `icons/*.png` — maps `gameImages`/`gameLogos`/`gameIcons` dans `data/games.ts`, **clés = id back**. Renderer unique `GameAsset` → coquilles `GameLogo`/`GameIcon`/`GameImage` ; `GamesFallback` loading/error ; `GameInfo` présentational.
- ⚠️ **`.gitignore` : `data/` → `/data/`** — changement **obligatoire**, pas cosmétique : l'ancien motif attrapait `frontend/src/data/`, donc `data/games.ts` (toutes les maps d'assets) ne pouvait pas être commité.
- ⚠️ **`components/home/` n'a PAS été renommé** : seul `HeroBanner` a migré vers `landing/`. Les 5 composants de F-Nav (`LadderSelect`, `RankingTable`, `TeamCreation`, `SearchBar`, `LinkAccountBanner`) **restent dans `home/`** — git avait tenté de les emporter par *directory rename detection* pendant le rebase. `home/` est donc mal nommé (il contient du teams/ranking) : **nettoyage à faire, séparément**.
- ⚠️ **`Logo` (master, `<h1>` + italique, prop `to`) et `SiteLogo` (FL, lien auth-aware `/home` ou `/`) coexistent** — deux composants réellement différents, **fusion à arbitrer**, volontairement pas tranchée pendant le rebase.
- ⚠️ **Composants sans consommateur conservés** (décision assumée) : `GamesIcons`, `GamesLogos`, `GamesInfos`, `RightNav`. `GamesInfos` porte encore l'ancienne largeur de carte → **déjà en train de diverger**.
- 🧩 **Décision d'architecture prise, pas encore codée — le site en DEUX ZONES** : zone publique (landing + pages associées) et zone app (`/home` + ses pages). Le déterminant est **la zone, pas la session** (la session n'en est qu'un proxy, valable tant que les gardes le forcent). Cible : *pathless layout routes* TanStack (`routes/_public.tsx` / `routes/_app.tsx`) portant chacune sa nav **et sa garde** ; `SiteLogo` deviendrait purement présentationnel (`to` obligatoire), chaque nav déclarant sa destination. **Redirection retenue : `/home`.** Étape intermédiaire possible : helpers `requireAnonymous()` / `requireSession()` dans `lib/route-guards.ts`. ⚠️ `/terms` et `/privacy` appartiennent aux **deux** zones → shell neutre à prévoir **le jour où elles auront du contenu** (pas avant).
- **Reste FL** : garde de route (ticket séparé), barre de nav mobile + overlay tactile, compteur de joueurs (aucune route back ne le fournit — piste : `COUNT(DISTINCT user_id)` sur `user_external_accounts` joint par `provider`), `gameHref` (table vide) + `<Link>`, i18n, bascule sur la codegen OpenAPI.
- 🐛 **Défauts connus, non corrigés** : `GameAsset` affiche un texte de debug à l'utilisateur (`"<jeu> — missing image"`) si un asset manque ; le hero promet **« Queue by skill »** alors que le produit n'a **ni file d'attente ni appariement automatique** (contredit la décision du 13/07) ; `index.html` de master écrivait « VS MODE » alors que le reste du code écrit « VSMODE » (résolu en faveur de **VSMODE** au rebase).

**Règles front à respecter dès F0-A et les pages suivantes** :

- importer avec `@/...`, éviter les chemins relatifs longs
- ne pas écrire de couleurs/polices/radius/shadows en dur dans les pages ; ajouter d'abord un token dans `index.css` si nécessaire
- réutiliser les composants `frontend/src/components/ui` autant que possible
- utiliser `lucide-react` pour les icônes standard
- lancer `npm run build` et `npm run lint` dans `frontend/` avant review

### Reste à faire (backend)

- **vérification** des comptes externes (OAuth Steam/Riot → `verified = true`) — le linking manuel est fait (B4) ; les routes teams sont faites (B5a)
- Routes **matches** : ✅ le cycle de matchmaking complet est fait (B5b + B5c : créer / lister / accepter / annuler / mes matchs / détail). ✅ **B6 fait** : **soumission de résultats** (`POST /matches/:id/result` `{ winnerSideId }`) + **ELO** branché. Machine à états §5.4 (1re soumission → `awaiting_confirmation` ; accord → `completed` + `winner_side_id` + `completed_at` + ELO ; désaccord → `disputed` + ligne `disputes`), §5.3 (rejet si `now() < scheduled_at`), garde « winnerSideId ∈ sides du match ». **ELO K=32 / départ 1000** dans `utils/rankings.ts` (`applyMatchElo` = lit/crée la ligne à 1000 + applique `updateElo` + wins/losses ; `completeMatchWithElo` = clôt le match + ELO, **helper partagé** route / job / futur B7). **2 jobs 24 h** dans `jobs/index.ts`, **tous deux candidat par candidat sous le même verrou consultatif que la route** (`cancelStaleMatches` = fantôme `in_progress` → `cancelled` sur `scheduled_at` ; `autoConfirmMatches` = confirmation auto sur `submitted_at` → `completed` + ELO). Le partage du verrou route/jobs empêche toute course (double ELO, ou annulation d'un fantôme pendant qu'on soumet). Testé : `tests/test_matches_result.py` (**40 cas ; 46 avec les jobs** via `B6_JOBS=1`). **openapi.yaml fait** (soumission + sémantique de re-soumission). ⚠️ **Review Walid traitée (2 passes)** : side IDs/état de soumission exposés dans `GET /:id`, job auto-confirm relit sous verrou (re-soumission), ELO sérialisé par compétiteur, 500→409, `last_match_at`, job fantôme sérialisé.
- ✅ **Routes disputes faites — B7 (review Walid traitée)** : `disputes.ts` sur prefix `/disputes`, **4 routes** (Zod). `GET /` (**file d'arbitrage admin only** : disputes `open`, tri ancienneté croissante, `evidenceCount` par dispute), `POST /:id/evidence` (dépôt preuve image obligatoire + message via multipart ; capitaine/joueur d'un camp ; **garde de camp AVANT de révéler open/resolved** — pas d'oracle d'état ; fichier **validé en mémoire AVANT tout upload** → zéro orphelin ; **bucket MinIO privé** ; insert **sous verrou `matchId` + re-check `open`** → pas de course avec resolve/job ; >5 Mo → **413**), `GET /:id` (état + **`sides` = déclarations des deux camps** : `sideIndex`, identité team/joueur, `submittedWinnerSideId` → ce qui rend l'arbitrage possible ; fil trié + auteurs ; garde participant/banc = **miroir de `GET /matches/:id`** **ou** admin ; **`evidenceUrl` = URL présignée courte durée** du bucket privé, générée après la garde ; zéro fuite), `POST /:id/resolve` (**admin `is_admin`** ; `side_0_wins`/`side_1_wins` → `completed` + ELO via `completeMatchWithElo` ; `cancelled` → annulé, ELO figé ; sous le **verrou matchId** + re-check). Extension `GET /matches/:id` → `disputeId` quand `disputed`. Job `autoCancelDisputes` (24 h, **annulation NEUTRE** : même avec une preuve d'un seul camp — le robot ne juge jamais une preuve, seul l'admin le fait). Pas d'endpoint « ouvrir une dispute » (B6 crée le `disputed`). **Bucket privé** : `storage/minio.ts` crée un 2e bucket `evidence` sans policy public-read + un **client de signature** configuré sur l'hôte PUBLIC (region fixée `us-east-1` → pas de lookup réseau). Testé : `tests/test_disputes.py` (**80 cas ; 84 avec `B7_JOBS=1`**), suite complète **326 ✅ / 0 ❌**. **openapi.yaml fait**. **2ᵉ/3ᵉ passe review** : bornes multipart strictes (`files:1/fields:1/parts:2`, erreurs limite → 400), bucket privé rendu idempotent **et fail-closed** (le démarrage échoue si la privatisation échoue, plus de `.catch()` silencieux), refus anonyme automatisé, chemin 2v2 testé, POST n'expose plus la clé d'objet. ⚠️ **Décisions produit actées** (à répercuter carte + ToS) : timeout = annulation neutre (PAS les 3 branches de la carte d'origine) ; dépôt = capitaine seul (joueur en 1v1) ; MIME déclaré client = limite connue (comme l'avatar).
- ✅ **Notifications système faites — B9** : migration `0016` (enum `notification_type` 8 valeurs + table `notifications` : `user_id` FK cascade, `data` **jsonb display-safe** — ids/heure, jamais email/hash —, `read_at` nullable = non-lu, index `(user_id, created_at desc)`). **2 couches** : la table = **source de vérité** (survit à l'offline, alimente la cloche F-Social) ; push WS **best-effort** par-dessus — event `{ type: 'notification', notification: {...} }` sur le socket **existant** `/ws/chat` (`sendToUser` exporté de `chat.ts`, PAS de 2e WebSocket). 🔑 **Pilier anti-bug** : `notify(tx, userIds, type, data)` (`utils/notifications.ts`) INSÈRE **dans la transaction métier**, et `pushNotifications()` pousse **APRÈS le commit** — un rollback ne notifie jamais un événement annulé ; le push ne peut jamais faire échouer la requête. **8 déclencheurs** (règle : on notifie le camp concerné, **JAMAIS l'acteur** — mais ses coéquipiers si ; 2v2+ = les joueurs **ALIGNÉS** (`match_participants`), **banc exclu**) : `match_accepted` (accept → side créateur), `result_submitted` (1re soumission → l'autre camp seulement), `result_confirmed` (accord → les 2 camps sauf acteur ; job auto-confirm → les 2 camps, soumetteur inclus), `dispute_opened` + `dispute_needs_admin` (désaccord → les 2 camps sauf acteur + **tous les `is_admin`** → l'arbitrage devient push, pas pull), `dispute_resolved` (arbitrage → les 2 camps, pas l'arbitre), `dispute_auto_cancelled` / `match_ghost_cancelled` (jobs 24 h → les 2 camps). **3 routes REST** (`/notifications`, Zod) : `GET /?limit=&cursor=` (keyset `(created_at, id)` desc — pas d'offset, la liste bouge —, `unreadCount` global, `nextCursor` ; curseur inconnu OU d'un autre user → **même 400**, pas d'oracle ; projection sans `user_id`), `PATCH /:id/read` (mienne only, pas-à-moi → **même 404** qu'inexistante, **idempotente** — `read_at` de la 1re lecture conservé), `PATCH /read-all` (idempotente, rend `updated`). **AUCUNE route de création** (100 % système → zéro spam client). Testé : `test_notifications.py` (**81 cas avec `B9_JOBS=1`**, destinataires 1v1 ET 2v2 + banc) + **push live vérifié** (listener node `ws` sur `/ws/chat` pendant un accept). ⚠️ cleanup des tests : purge de `notifications` **par matchId de test** (`data->>'matchId'`) — `dispute_needs_admin` peut toucher de **vrais** admins de la base dev, la cascade user ne suffit pas. **openapi.yaml fait** (3 routes + format de l'event WS). Dette assumée (carte) : pas de purge des notifs en MVP (ticket futur).
- ✅ **Notifications sociales faites — #53** (complète le module « Notification system » : le sujet exige des notifs pour **TOUTES** les actions, B9 ne couvrait que le cœur match/dispute) : migration `0017` (2 valeurs d'enum en plus → `friend_request_received`, `friend_request_accepted`), 2 schémas Zod dans `notification-schemas.ts`, et **3 points de déclenchement** dans `friends.ts` — ⚠️ **3, pas 2** : `POST /friends` a **deux** issues distinctes (nouvelle demande **ou** auto-accept quand l'autre m'avait déjà sollicité), plus `POST /:id/accept`. Destinataires : demande → l'**addressee** ; accept (explicite ou auto) → le **demandeur d'origine** ; **jamais l'acteur** (règle B9). Payload display-safe : `friendshipId` (le front peut accepter/refuser depuis la notif) + auteur (`fromUserId`/`fromPseudo` ou `byUserId`/`byPseudo`). 🔑 `friends.ts` n'avait **aucune transaction** → les 3 écritures concernées sont désormais enveloppées dans `db.transaction` pour respecter l'invariant B9 (notif dans la tx, push après commit) : sans ça, un `notify()` qui échoue laissait l'amitié créée + un 500. **Pas de notif sur reject/unfriend** (choix produit assumé). Testé : 18 cas e2e (les 3 chemins, acteur exclu, payload, pas de fuite) + Vitest 20/20. **openapi.yaml fait**.

**Review traitée (20/07)** — 3 correctifs :
1. **Spam sur re-soumission (bloquant)** : tant que l'adversaire n'avait pas soumis, CHAQUE re-soumission du même camp renvoyait une notif `result_submitted` en plus. Fix : la notif ne part que si `currentMatch.status === 'in_progress'` (lu sous verrou avant écriture) — vrai uniquement à la toute première soumission.
2. **`data` display-safe pas garanti à l'écriture** : schémas Zod `strictObject` par type (rejette aussi tout champ EN TROP) extraits dans `utils/notification-schemas.ts` — fichier **à part**, sans import de `db/index.ts`, pour rester testable en Vitest pur (`db/index.ts` exige `DATABASE_URL` au chargement, ce qui cassait `tests/unit/notifications.test.ts` tant que tout vivait dans le même fichier). `notify<T>()` est générique : erreur de compilation **et** `.parse()` avant l'INSERT si le payload ne correspond pas au type.
3. **Pagination sur multiple exact de `limit`** : `nextCursor` pointait vers une page vide quand le total restant valait pile `limit`. Fix : fetch `limit + 1`, coupe à `limit`, `hasMore = résultat.length > limit`.

⚠️ **2 bugs annexes trouvés en creusant, corrigés au passage** :
- `helpers.py` `cleanup()` était **cassé depuis des jours** (contrainte FK circulaire `matches.winner_side_id ↔ match_sides.id` : supprimer les sides avant de casser ce lien fait ROLLBACK toute la transaction, en silence — `subprocess.run` n'inspectait pas le code retour). Résultat : **270 users et 325 matchs de test jamais nettoyés** depuis le 17/07. Fix : `UPDATE matches SET winner_side_id = NULL` avant de supprimer les sides, **et** `cleanup()` lève maintenant une exception si le SQL échoue (ne plus jamais avaler un échec en silence).
- Le test de pagination (`register("carol")` + 3 matchs futurs) utilisait `bob` comme accepteur, monopolisant son planning (§5.2) → les matchs de la section Jobs (heure par défaut `future()`, même créneau) ne pouvaient plus être acceptés, restaient `pending`, et étaient ramassés par le job d'expiration de slot au lieu des jobs testés — les 3 assertions de jobs ne testaient donc rien. Fix : accepteur dédié (`register("dave")`) pour ce test.

Tests re-vérifiés après tous les correctifs : `tsc` propre, Vitest **19/19** (7 nouveaux dont la validation Zod), `test_notifications.py` **81 ✅ / 0 ❌**, `test_matches_result.py` + `test_disputes.py` intacts (120 ✅ / 0 ❌, non affectés).

**2e passe de review (Walid, 20/07 soir) — 4 points, 3 traités** :
1. **Important, sécurité (corrigé)** : `/ws/chat` (`chat.ts`) vérifiait le JWT mais **n'excluait pas les `tempToken` 2FA** (`{ sub, pending: 'totp' }`) — contrairement à `server.authenticate` utilisé partout ailleurs. Quiconque avait le mot de passe (mais pas le code TOTP) pouvait ouvrir le socket avec son tempToken et recevoir chat **et** notifications live du compte. **Bug préexistant, pas causé par B9** — mais aggravé puisque les notifs passent maintenant par ce même socket. Fix : même garde que `server.authenticate`, `payload.pending` → `close(1008)`. Vérifié manuellement (script Node avec `speakeasy`, un vrai TOTP) : tempToken → fermé 1008 immédiatement ; accessToken réel → accepté, reçoit `initial_presence`. Pas de test automatisé (Python e2e = stdlib seule, pas de lib WebSocket dispo).
2. **Mineur, doc (corrigé)** : `openapi.yaml` ne déclarait que `Error` pour le 400 de `GET /notifications`, alors que la route renvoie aussi la forme `ValidationError` (Zod). Fix : `oneOf` Error/ValidationError, même pattern que les autres routes à 400 multi-formes.
3. **Mineur, compteurs (corrigé)** : `CLAUDE.md` disait encore 11 suites/391 cas — corrigé en 12 suites/397 cas (vérifié : `test_notifications.py` fait **71** cas sans `B9_JOBS`, 326 (avant B9) + 71 = 397).
4. **À arbitrer (tranché — carte à reformuler, PAS de changement de code)** : `GET /notifications` fait 3 requêtes avec un `cursor` (résolution du curseur + liste + count), pas "1 liste + 1 count" comme dit la carte. Décision de David : on garde la résolution du curseur en base (elle sert aussi de contrôle de propriété — 400 propre sur curseur inconnu/d'un autre user, déjà testé) plutôt que de passer à un curseur opaque qui ferait gagner une requête mais perdrait ce comportement d'erreur. La carte doit juste être reformulée pour dire la vérité (3 requêtes fixes, pas de N+1).
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

**Infrastructure — I2 et I3 mergés sur `master`** : images Compose figées et lancement autonome avec `docker compose up -d --build`. Prévenir l'équipe que le premier démarrage après mise à jour peut lancer un `npm ci` plus long pour resynchroniser les anciens volumes `node_modules` ; les démarrages suivants redeviennent rapides.

**Backend — B5d et B6 mergés sur `master`** (B6 : merge `f9128bf`, review Walid approuvée, 246 ✅ / 0 ❌ ; 46 avec les jobs). Disponibilité par fenêtre (B5d) et soumission de résultats + ELO + jobs 24 h (B6) en place. La table `rankings` **se remplit désormais** dès qu'un match est `completed` → le leaderboard renvoie de vrais classements. Aussi mergé : `fix/cors-methods` (CORS `methods` explicite → débloque tous les DELETE/PATCH depuis le navigateur).

- ✅ **B7 — disputes : MERGÉ sur master** (merge `15238e7`, commit `5900d23`, 3 passes de review Walid traitées). Décisions actées : timeout neutre, dépôt capitaine-seul, MIME = limite connue → la règle du timeout reste **à écrire dans la ToS ([FT])**.
- **B9 — notifications : MERGÉ** (merge `88c33e8`, commit `eca332d`, carte Trello #51). Livré : migration `0016` (enum + table `notifications`), `utils/notification-schemas.ts` (schémas Zod par type, purs/sans DB) + `utils/notifications.ts` (`notify<T>` validé + dans la tx / `pushNotifications` après commit), `routes/notifications.ts` (3 routes : liste paginée par curseur + `unreadCount`, read idempotent sans oracle, read-all), event WS `notification` sur `/ws/chat` (`sendToUser` exporté), **8 déclencheurs** câblés dans `matches.ts` (accept, result × 3 issues), `disputes.ts` (resolve) et les 3 jobs 24 h, `openapi.yaml`. **3 correctifs de review appliqués** (spam re-soumission, validation Zod à l'écriture, pagination sur multiple exact) — détail dans la section Notifications ci-dessus. `test_notifications.py` (**81 ✅ / 0 ❌ avec `B9_JOBS=1`**), Vitest **19/19**. Au passage : fix d'un bug `helpers.py cleanup()` cassé depuis des jours (270 users/325 matchs de test jamais nettoyés). Le module **Notification system (1 pt)** passe au vert → **15 pts atteints** (sous réserve de la vérif PDF « Organization system »).

**Frontend — F0-B, Fast Refresh, FR1 Register, F0-D, F-Nav et FR2 Login + 2FA mergés.**

- Register complet et mergé : validation, inscription classique, erreurs backend, Google OAuth, session et redirection `/home` testés avec le backend réel.
- **F-Nav mergé** (commit `feat(frontend): partial F-nav`) : coquille de navigation (rails `LeftNav`/`RightNav`, `AuthNav`, `Logo`), pages **Mes équipes** + **Détail équipe** (création, roster, kick/quit/dissolve — consomme B5a), page **Ranking** (`RankingTable` consomme B2), sélecteur `LadderSelect`, et **codegen OpenAPI** (`api-types.gen.ts`). Détail dans la section Frontend plus haut.
- **Tickets frontend suivants** :
  - **Recherche + ajout de membre** : le back de recherche est **fait** — c'est **`GET /search?q=`** (préfixe joueurs + teams, réponse taggée `type`), **pas** `GET /users?search=`. Câbler `SearchBar` (tenu à l'écart, local) dessus → décommenter le bloc « Add member » + `addMember` de `team-detail.tsx`. ⚠️ Le `SearchBar` stashé tapait `GET /users?search=` : adapter l'URL + le parsing (la réponse est `{ results: [...] }` taggée, pas une liste d'users brute).
  - **Page `/profile`** (stub « a faire mdr »), **flux de liaison de compte** (`LinkAccountBanner` → external-accounts), rendre les lignes de ranking cliquables (**bloqué** : le back ne renvoie pas d'id de compétiteur), Upload Avatar (user : back prêt ; team : endpoint à créer).
  - **Après FR2** : pages match et notifications.
- Les stubs `/home`, `/privacy`, `/terms`, `/dashboard`, `/profile` restent à remplir.
- ⚠️ **Types d'API côté front** : **codegen en place** — `frontend/src/lib/api-types.gen.ts` généré via `openapi-typescript` depuis `openapi.yaml` ; importer `components['schemas'][...]`, **ne jamais importer les types du backend** (ils décrivent la DB, pas le JSON). ⚠️ La codegen **ne corrige pas** le piège `Date`→`string` : `scheduledAt` est un `Date` côté back mais arrive en **`string` ISO** — ne pas le traiter comme un `Date`. **Régénérer `api-types.gen.ts` après toute modif de `openapi.yaml`.**

---

_Dernière mise à jour : 21 juillet 2026 — **B7 (disputes) mergé** (`15238e7`) ; **B9 (notifications) mergé** (`88c33e8`, commit `eca332d` — 12 suites / 397 cas, Vitest 19/19, push live vérifié) ; **FR2 Login + 2FA mergé après review** (commit `26f908d`, parcours classique et TOTP testés avec le backend réel ; observation cookie cross-scheme dev documentée ci-dessus). **BA1 (changer son mot de passe) mergé** (merge `37c4e8c`, commit `9c1ae0b` — review Walid approuvée) : rebasé sur `master` `85e1c76` **sans conflit** (aucun commit de master n'avait touché `users.ts` ni `openapi.yaml` depuis son point de départ), `tsc --noEmit` vert avant merge._

_21 juillet 2026 — **FL (landing publique) rebasée sur `master` `1c8f7a6`** (trois fois : `88c33e8`, puis le sommet après FR2, puis celui après `b-notif-social` + `get-search` — les 2e et 3e passes n'ont conflicté que sur ce bloc, la 3e résolue automatiquement par `git rerere`). Résolutions retenues : `LeftNav` et le corps de `CLAUDE.md` gardent master, `index.html` garde le titre descriptif FL, `button.tsx` **fusionné** (structure FL + 4 variantes master dont `danger`), les 5 composants F-Nav remis dans `components/home/` (git avait tenté de les emporter par *directory rename detection*). Un commit est devenu vide et a été supprimé par git : il ne portait que `CLAUDE.md`. `tsc -b` et lint verts (2 warnings hérités de master sur `routes/profile.tsx`). **À faire avant merge** : `git push --force-with-lease` (historique réécrit → prévenir l'équipe), corriger les 2 défauts visibles restants (texte de debug de `GameAsset`, « Queue by skill » du hero), arbitrer `Logo` / `SiteLogo`._
