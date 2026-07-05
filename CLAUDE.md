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

**Frontend** : Vite 8 + React 19 + TypeScript + Tailwind v4

- ⚠️ **Encore à l'état démo Vite** — aucune lib applicative installée à ce jour
- Libs prévues à installer : TanStack Router + TanStack Query, Zustand, React Hook Form, Zod, shadcn/ui
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
│   ├── schema.md            # design complet du domaine jeu (étape 5.5)
│   └── mockups/             # maquettes UI
│
├── backend/
│   ├── Dockerfile, package.json, tsconfig.json
│   ├── certs/               # cert auto-signé (NON versionné)
│   ├── drizzle/             # migrations 0000 → 0012 (13 migrations) + meta
│   └── src/
│       ├── server.ts        # entry Fastify (HTTPS, registre plugins/routes)
│       ├── db/
│       │   ├── schema.ts     # 15 tables + 5 enums (voir État ci-dessous)
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
│       │   └── external-accounts.ts  # liaison compte in-game (GET/POST/DELETE, prefix /users/me/external-accounts)
│       ├── storage/          # minio.ts, redis.ts
│       ├── utils/            # blocks.ts (helper isBlocked)
│       └── types/            # env.d.ts, fastify-jwt.d.ts, fastify-oauth2.d.ts
│
├── frontend/                # ⚠️ encore la démo Vite (App.tsx, assets) — RIEN de réel
│   └── src/ (main.tsx, App.tsx, App.css, index.css, assets/)
│
└── data/                    # volumes bind-mount Postgres/MinIO (NON versionné)
```

---

## ✅ État d'avancement (au 29 juin 2026)

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
- ✅ **Liaison de compte externe (in-game) faite — B4** : `external-accounts.ts` monté sur prefix `/users/me/external-accounts`, 3 routes authentifiées (validation Zod). `GET /` (liste mes liaisons, `[]` si aucune, projection `provider/externalId/verified`), `POST /` `{ provider, externalId }` (crée, `verified=false` par défaut, **201** ; provider hors enum ou externalId vide → **400** ; doublon `UNIQUE(user_id, provider)` capté via SQLSTATE `23505` → **409**), `DELETE /:provider` (idempotent → **200**, param validé contre l'enum → 400 sinon). Testé à la main (curl) + **openapi.yaml fait** ; ⚠️ **tests Vitest = à écrire** (DoD pas encore complète). Garde §5.1 « liaison requise pour jouer » **PAS ici** (sera dans le ticket création de match B5)
- ✅ **Seed games/ladders fait** : les 5 jeux + 9 ladders sont insérés **dans les migrations `0008`/`0009`** (`INSERT ... ON CONFLICT DO NOTHING`, idempotent) — pas de script `seed.ts` séparé. Un `drizzle-kit migrate` sur clone neuf peuple donc les tables. ⚠️ La table `rankings` reste **vide** (pas encore de matchs → pas d'ELO) : le leaderboard renvoie donc `[]` tant qu'aucun match n'a généré de classement. Pour des faux classements en local : `npm run seed:dev` (script dev-only `backend/src/scripts/seed-dev.ts`, faux users/teams — **jamais** dans une migration).
- ⚠️ **Toutes les règles business §5.1–5.8 du design (`docs/schema.md`) sont à coder** : liaison de compte requise, lockout, soumission de score, accord/dispute, calcul ELO (K=32, départ 1000), dispute timeout. La DB est prête, la logique non.

### Frontend — ❌ NON COMMENCÉ

Encore la démo Vite (`App.tsx` = page démo "wemby"). `package.json` ne contient que React + Tailwind — **aucune** lib applicative (router, query, store, forms, validation). `vite.config.ts` OK (host true, port 5173, polling WSL2). C'est le **gros retard** du projet et la priorité immédiate.

### Reste à faire (backend)

- Routes **teams** (CRUD, membership) ; **vérification** des comptes externes (OAuth Steam/Riot → `verified = true`) — le linking manuel est fait (B4)
- Routes **matches** : création, soumission de résultats, state machine, confirmation
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
- **Review** = PR ouverte ; un coéquipier review (jamais sa propre PR).
- Sur approbation → **merge sur `main`** → carte déplacée en **Done** (Done = code intégré, pas juste "prêt à merger").

**Gabarit de carte** : titre (verbe + objet), description, **Definition of Done**, assigné, label (`backend` / `frontend` / `infra` / `docs`).

**Rituel de planif** : tous les **dimanches**, session avec Claude pour lister les tickets de **la semaine uniquement** (backlog just-in-time — on n'avance pas la liste plus loin, mais on peut enchaîner si on va vite). Les étapes lointaines restent des cartes "epic" jusqu'à la semaine où on les attaque.

**Lien Claude Code ↔ Trello** : possible via MCP (serveur Trello communautaire avec API key + token). Non branché pour l'instant — la planif se fait, le remplissage se fait à la main ou via MCP au choix.

---

## 📋 Conventions du projet

### Code

- **TypeScript strict** partout (`strict`, `noUncheckedIndexedAccess`…)
- **ESM** (`"type": "module"`), **Node 24 LTS**
- Imports nommés > default ; validation systématique **Zod** côté API

### Git

- **Dépôt de travail = Git vogsphere 42** (rendu + collaboration directe, pas de repo miroir). Pas d'interface PR → la "Review" se fait en local (`git diff main..<branche>`, jamais sa propre branche), puis merge sur `main`.
- **Branches** : `feature/<code-ticket>-<sujet-court>` / `fix/<sujet>` — kebab-case, sans accents/espaces. Ex : `feature/f1-scaffolding-front`, `fix/refresh-token`
- **Commits** : Conventional Commits `type(scope): description` — types feat/fix/docs/refactor/chore/test/style, scope optionnel (db, auth, front…). Commits atomiques. Pas de force push sur `main`.
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

**Le frontend est le goulot d'étranglement absolu** (backend très en avance, front à zéro). Objectif semaine du 29 juin : faire décoller le front et prouver le stack end-to-end (register → login +2FA → profil → amis) branché sur le backend existant, + servir les rankings côté back.

Tickets de la semaine (voir Trello) :

- **F1** Scaffolding front + libs (TanStack Router/Query, Zustand, RHF, Zod, shadcn init) ; virer la démo ; layout/routing — _débloque les autres_
- **F2** Client API + store auth (token + refresh auto, store Zustand) — dépend de F1
- **FD** Design system : thème Tailwind + composants shadcn de base + style guide — dépend de F1, débloque le rendu de F3/F4/F5 (bonus possible : module Custom design system)
- **F3** Pages register/login + flow 2FA — dépend de F2 + FD
- **F4** Page profil + upload avatar — dépend de F2 + FD
- **F5** Page amis — dépend de F2 + FD
- **F6** _(stretch)_ UI chat DM temps réel (WebSocket natif) — dépend de F2
- **B1** Endpoint leaderboard/rankings (sert la table `rankings`)
- **B2** _(stretch)_ Seed de données jeu (games/ladders/rankings factices)

⚠️ **Cette semaine on NE touche PAS** : matchmaking, notifications, UI matchs/disputes/teams — ce serait s'éparpiller tant que le front n'existe pas.

---

_Dernière mise à jour : 3 juillet 2026_
