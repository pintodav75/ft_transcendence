# ft_transcendence

Projet final du Common Core 42, en équipe de 4. Sujet libre — on construit une web app qui valide ≥ 14 points via les modules.

## 🎯 Concept

**Plateforme compétitive multi-jeux type GameBattle**

- Profils utilisateurs, équipes
- Ladders par jeu avec ELO
- Matchmaking automatique (file d'attente, matching par skill)
- Soumission de résultats, système de disputes
- Chat, amis, notifications temps réel
- Pattern config-driven pour supporter plusieurs jeux

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

## 🛠️ Stack technique

**Frontend** : Vite 8 + React 19 + TypeScript + TanStack Router + TanStack Query + Zustand + Tailwind v4 + shadcn/ui + React Hook Form + Zod + socket.io-client

**Backend** : Fastify v5 sur Node 24 LTS (TypeScript)

- `@fastify/jwt` + `@fastify/oauth2` + `@fastify/cookie` + `@fastify/multipart` + `@fastify/websocket`
- `speakeasy` + `qrcode` (2FA TOTP)
- Drizzle ORM + postgres-js
- Zod (validation)
- bcryptjs (hash password)
- minio (client S3-compatible)
- redis (présence + cache temps réel)

**DB / Cache / Storage**

- PostgreSQL 17
- Redis (sessions, cache, pub/sub WebSocket)
- MinIO (S3-compatible, fichiers)

**Infra**

- Docker Compose (un seul `up -d` lance tout)
- **Pas de Nginx** — Fastify sert tout (API + frontend statique en prod + HTTPS)
- HTTPS via certificats auto-signés en dev

## 📦 Prérequis

- Docker + Docker Compose v2, ou Podman avec son provider Compose
- Node 24 LTS uniquement pour lancer les applications hors des conteneurs

## 🚀 Setup

### 1. Cloner le repo

```bash
git clone <url-du-repo> transcendence
cd transcendence
```

### 2. Copier le fichier d'environnement et remplir les valeurs

```bash
cp .env.example .env
```

Édite `.env` pour remplacer tous les `changeme` par des vraies valeurs. **Notamment** :

- `POSTGRES_*` : credentials Postgres au choix
- `REDIS_PASSWORD` : password Redis au choix
- `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` : credentials MinIO root (min. 8 caractères)
- `JWT_SECRET` : un secret aléatoire long — génère-en un avec :
  ```bash
  openssl rand -hex 64
  ```

### 3. Lancer l'application

```bash
docker compose up -d --build
```

Avec Podman, la commande équivalente est `podman compose up -d --build`.

Compose construit les images, attend que PostgreSQL, Redis et MinIO soient sains,
génère le certificat HTTPS dans le volume `backend_certs`, applique les migrations
Drizzle puis démarre le backend. Les migrations sont revérifiées automatiquement
à chaque redémarrage du backend.

### 4. Vérifier que ça tourne

```bash
docker compose ps                  # tous les services en "Up"
curl -k https://localhost:3000/ping  # doit renvoyer "pong-from-docker"
```

Dans le navigateur, ouvre aussi `https://localhost:3000/ping` et accepte
l'exception de sécurité du certificat auto-signé avant d'utiliser le front.

## 🌐 UIs locales

| Service         | URL                    | Description                                                |
| --------------- | ---------------------- | ---------------------------------------------------------- |
| Frontend        | http://localhost:5173  | Vite dev server                                            |
| Backend API     | https://localhost:3000 | Fastify (HTTPS auto-signé)                                 |
| Adminer         | http://localhost:8080  | UI Postgres                                                |
| redis-commander | http://localhost:8081  | UI Redis                                                   |
| MinIO console   | http://localhost:9001  | UI MinIO (login = `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`) |
| MinIO API       | http://localhost:9000  | Endpoint S3 pour les avatars                               |

## 🔗 Commandes utiles

```bash
# Démarrer
docker compose up -d --build

# Vérifier l'état
docker compose ps
docker compose logs -f <service>

# Entrer dans un conteneur
docker compose exec backend sh

# Arrêter (sans perdre les données)
docker compose down

# Arrêter + supprimer les volumes gérés (certificat et node_modules)
# Les données bind-mountées dans ./data ne sont pas supprimées.
docker compose down -v

# Rebuild après modification d'une image ou des dépendances
docker compose up -d --build <service>

# Générer une migration après modification du schéma Drizzle
docker compose exec backend npx drizzle-kit generate

# Appliquer manuellement les migrations (normalement automatique au démarrage)
docker compose exec backend npx drizzle-kit migrate
```

## 📁 Structure du projet

```
transcendence/
├── docker-compose.yml
├── .env                    # secrets, NON versionné
├── .env.example            # template versionné
├── .gitignore
├── README.md
│
├── backend/                # Fastify + TS + Drizzle
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle/            # migrations SQL générées
│   ├── docker-entrypoint.sh # dépendances, certificat et migrations au démarrage
│   └── src/
│       ├── server.ts       # entry point Fastify HTTPS
│       ├── routes/
│       │   ├── auth/       # index.ts, google.ts, 2fa.ts
│       │   ├── users.ts    # profil + upload avatar
│       │   ├── friends.ts  # 6 endpoints REST
│       │   ├── messages.ts # historique chat
│       │   └── chat.ts     # WebSocket + présence
│       ├── auth/           # password, tokens (helpers)
│       ├── db/             # schema Drizzle + client
│       ├── storage/        # clients MinIO + Redis
│       └── types/          # augmentations TS (env.d.ts, fastify-jwt.d.ts, fastify-oauth2.d.ts)
│
├── frontend/               # Vite + React 19 + TS + Tailwind v4
│   ├── Dockerfile
│   ├── vite.config.ts
│   └── src/
│
└── data/                   # volumes bind-mount Postgres/MinIO, NON versionné
```

## ✅ État d'avancement

| Étape                                                                  | Statut |
| ---------------------------------------------------------------------- | ------ |
| 1. Fondations Docker (Postgres, Redis, MinIO, frontend, backend HTTPS) | ✅     |
| 2. Auth backend (register, login, refresh, me, logout via JWT)         | ✅     |
| 3. Profil utilisateur + upload avatar MinIO                            | ✅     |
| 4. OAuth (Google) + 2FA TOTP                                           | ✅     |
| 5. Amis + chat WebSocket (DM 1-to-1, présence Redis)                   | ✅     |
| 5.5. Conception du schéma de données du domaine jeu                    | ⏳     |
| 6. Modèle de jeu et matchs (state machine)                             | ⏳     |
| 7. Matchmaking worker                                                  | ⏳     |
| 8. Ladders + stats + match history                                     | ⏳     |
| 9. Notifications système                                               | ⏳     |
| 10. Polish 42 (Privacy Policy, ToS, zéro warning console)              | ⏳     |

## 🔐 Sécurité

- Mots de passe hashés avec bcryptjs (cost 12)
- JWT access token (15 min) + refresh token (7 jours) dans cookie `httpOnly` + `Secure` + `SameSite=Strict`
- OAuth 2.0 (Google) avec linking automatique par email
- 2FA TOTP (speakeasy) avec tempToken court-vie (5 min) scope-limité à `/2fa/verify`
- Backend en HTTPS (exigence sujet)
- `.env` jamais commit (déjà dans `.gitignore`)
- Validation systématique des inputs côté front **et** back (Zod)
- Prévention de l'énumération de comptes (messages d'erreur génériques)
- Strip des champs sensibles (`passwordHash`, `totpSecret`, `email` en profil public) dans toutes les réponses API
- WebSocket : auth via JWT en query string, refus des tempTokens, chat entre amis acceptés uniquement
