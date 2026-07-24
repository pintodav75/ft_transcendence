# Stack technique & structure du projet

> Extrait de CLAUDE.md (refacto 25/07). État réel de l'arborescence et des libs.

## 🛠️ Stack technique

**Frontend** : Vite 8 + React 19 + TypeScript + Tailwind v4 — _fondation F0 + F0-A + F0-B, Register FR1, révision DA F0-D, coquille **F-Nav** + pages Teams/Ranking mergées, et **F0-C** (shell authentifié + garde centralisée) implémenté sur sa branche_

- ✅ **Fondation visuelle F0 mergée** : tokens Tailwind v4 dans `src/index.css`, composants UI de base (`Button`, `Input`, `Label`, `Card`), config shadcn-like `components.json`, alias `@/*`, helper `cn()`
- ✅ **F0-A implémenté et testé** : client API `fetch` + store auth Zustand (`user`, `accessToken`, `ready`, restauration `refresh → me`, retry unique sur 401)
- ✅ **F0-B routing + home mergé / Trello Done** : TanStack Router **file-based** branché (plugin Vite génère `routeTree.gen.ts`), pattern route/page, page home/landing arène complète + base visuelle de Login
- ✅ **F0-C implémenté** : route layout pathless `_authenticated` avec garde unique (`restoreSession` si nécessaire puis redirection des visiteurs vers `/`), shell trois colonnes partagé par `/home`, `/games`, `/profile`, `/ranking` et `/teams`; ancien `/dashboard` et layouts dupliqués supprimés
- ✅ **FR1 Register implémenté et testé** : formulaire RHF + Zod, inscription classique, session Zustand, erreurs API, Google OAuth complet et redirection `/home`
- Libs front : **TanStack Router branché** + TanStack Query (installé), Zustand, React Hook Form, Zod + `@hookform/resolvers`, `@fontsource/geist`, `lucide-react`, `clsx`, `tailwind-merge`
- ⚠️ **Pages restantes** : `/`, `/register`, `/login`, `/ranking` et `/teams` ont une vraie UI ; **FR2 Login + 2FA est mergé**. `/home`, `/games`, `/profile`, `/privacy` et `/terms` restent à compléter. `App.tsx` supprimé (renommé `pages/login.tsx`)
- ⚠️ **Client temps réel** : le backend utilise `@fastify/websocket` (lib `ws`), donc côté front ce sera **WebSocket natif** (ou un wrapper compatible `ws`), **PAS socket.io-client**

**Backend** : Fastify v5 sur Node 24 LTS (TypeScript strict, ESM) — _en place et bien avancé_

- `@fastify/websocket` (+ `ws`) — chat temps réel
- `@fastify/multipart` — uploads avatar (limite 2 MB)
- `@fastify/jwt` + `@fastify/cookie` — auth (access 15 min / refresh 7 j en cookie)
- `@fastify/oauth2` — OAuth Google
- `@fastify/cors` (origin lu depuis `FRONTEND_URL` = `https://localhost:5173`, pas de wildcard, credentials) + `@fastify/rate-limit` (100 req/min). En dev proxifié tout est same-origin ; CORS ne sert qu'à l'accès direct au backend (:3000, tests).
- `speakeasy` + `qrcode` — 2FA TOTP
- `bcryptjs` (cost 12) — hash password
- `drizzle-orm` + `postgres` / `pg`, `zod`, `minio`, `redis` (client v6)

**DB / Cache / Storage** :

- PostgreSQL 17.10 (conteneur, image figée)
- Redis 8.8.0 (authentification par mot de passe réellement activée ; client backend authentifié ; cache/pub-sub à exploiter — voir note présence ci-dessous)
- MinIO `RELEASE.2025-09-07T16-13-09Z` (S3-compatible, fichiers ; bucket `avatars` public en lecture)

**Infra** :

- Docker/Podman Compose, images tierces qualifiées et figées (**I2**), **pas de Nginx**. **Origine navigateur UNIQUE `https://localhost:5173`** (serveur de dev Vite, HTTPS) qui **proxifie** `/api/*` → backend et `/media/*` → MinIO sur le réseau Docker interne (**I4**). Le backend Fastify reste en HTTPS sur `:3000` (accès direct diagnostic/tests). ⚠️ Fastify **ne sert PAS** de build statique du front (ce mode n'existe pas — ne pas le réintroduire dans la doc).
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
│   ├── tests/               # tests e2e Python (run_all.py — 14 suites, 501 cas) + unit/ (Vitest) + README
│   ├── drizzle/             # migrations 0000 → 0019 (20 migrations) + meta
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
├── frontend/                # F0 + F0-A + F0-B + F0-C + FR1 + FR2 en place (routing, shell authentifié, register, login + 2FA)
│   ├── Dockerfile, docker-entrypoint.sh
│   ├── components.json       # config shadcn-like
│   ├── package.json          # TanStack Router + Query, Zustand, RHF, Zod/resolvers, Geist, lucide, clsx...
│   └── src/
│       ├── main.tsx          # createRouter(routeTree) + RouterProvider (plus d'App.tsx)
│       ├── routeTree.gen.ts  # généré par le plugin TanStack — PLUS VERSIONNÉ (gitignoré depuis `0df06ef`), régénéré au démarrage de Vite
│       ├── index.css         # source de vérité visuelle : tokens Tailwind + @utility (panel/label-caps/focus-ring) + utilitaires arène
│       ├── routes/           # wrappers file-based : routes publiques + layout pathless `_authenticated` et ses enfants protégés
│       ├── pages/            # index/login/register, home/games/profile/ranking, privacy/terms et pages teams
│       ├── stores/           # auth-store.ts (Zustand session — F0-A)
│       ├── lib/              # api.ts, api-config.ts, schémas Zod register/login, utils.ts (cn())
│       ├── types/            # auth.ts
│       ├── data/             # games.ts : maps assets (images/logos/icons) + gameOrder + gameHref, clés = id back
│       ├── assets/           # images/ (bg.webp hero, google-g.png, <jeu>.webp), logos/, icons/
│       └── components/
│           ├── ui/           # button, button-variants (buttonClasses), input, label, card, form-message, password-input, avatar, menu-item, icon-menu-item
│           ├── auth/         # composants partagés Register/Login : layout, carte, formulaire, divider, options, langue, Google
│           ├── layout/       # RootLayout, AuthenticatedLayout, rails F0-C, navs F-Nav, SiteFooter, Logo/SiteLogo
│           ├── landing/      # vitrine publique : HeroBanner, LandingNav
│           ├── games/        # GameAsset + coquilles GameLogo/GameIcon/GameImage, GamesCards, GameInfo, GamesFallback (+ previews non montées)
│           └── home/         # ⚠️ MAL NOMMÉ : contient du teams/ranking (LadderSelect, RankingTable, TeamCreation, SearchBar, LinkAccountBanner)
│
└── data/                    # volumes bind-mount Postgres/MinIO (NON versionné)
```

---

