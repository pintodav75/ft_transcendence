# CLAUDE.md — ft_transcendence

> Contexte de session. **Volontairement court** : le détail vit dans `docs/`, à lire **à la demande** (voir « Index de la doc »).

---

## 🎯 Le projet

Projet final du Common Core 42, équipe de 4, sujet libre : une web app validant ≥ 14 points de modules.

**Concept : plateforme compétitive multi-jeux type GameBattle / LiveNplay** — profils, équipes, ladders ELO, soumission de résultats, disputes, chat/amis/notifications temps réel, pattern config-driven multi-jeux.

> 🚨 **PAS de file d'attente, PAS de worker de matchmaking automatique.** Modèle = **challenge/accept** : un camp ouvre un slot → un autre l'accepte → les deux entrent le score → l'ELO bouge. Aucun bouton « chercher une partie », aucun appariement par ELO. (Décision explicite de David, 13/07 — ne jamais la réintroduire.) Le cycle est **déjà implémenté** (B5b→B6).

> 🚨 **Pas de jeu jouable dans l'app** (décision 13/07) : la plateforme *tracke* des jeux externes (LoL/CS2/chess.com via liaison de compte).

**Statut** : équipe de 4 formée, deadline courte → focus.

---

## 🧩 Modules — 16 points (seuil 14)

5 majors + 6 minors, **vérifiés contre le PDF v21.1** (audit 23/07) : frameworks front+back, user management, WebSocket temps réel, user interaction, **organization system** (= nos teams) | ORM Drizzle, OAuth 2.0, 2FA TOTP, file upload, notifications, **advanced search**.

- Tous **✅ back**, sauf **File upload** dont il reste les **puces FRONT** (validation client, aperçu, progression) → module non démontrable tant qu'elles manquent. Repli possible : « Custom design system » (quasi rien à coder).
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

## ✅ État d'avancement (résumé — 25 juillet 2026)

- **Infra** : I2 + I3 + I4 mergés. Origine unique HTTPS, proxy, certs auto, migrations auto, validation d'env Zod. → `docs/infra.md`
- **Backend** : **terminé et fonctionnel** — auth (JWT typés, OAuth Google, 2FA, profil, avatar), social (amis, blocks, chat WS, DM, conversations), teams (CRUD + membres + édition), matchmaking complet (créer/accepter/annuler/résultat/ELO), disputes + arbitrage, notifications (10 types), recherche avancée, jobs 24 h. → `docs/backend.md`
- **Frontend** : F0, F0-A/B/C/D, FR1 Register, FR2 Login+2FA, F-Nav (teams + ranking), FL landing publique — **mergés**. Restent à remplir : `/home`, `/games`, `/profile`, `/privacy`, `/terms`. → `docs/frontend.md`
- **Tests** : Vitest 21/21 (helpers purs) + **14 suites e2e Python / ~506 cas** (`cd backend/tests && python3 run_all.py`), sans mocks, sur la vraie base de dev.

📄 Historique des merges et décisions datées → **`docs/journal.md`**

### Prochaines actions

- **Front** : puces file upload, `/profile`, câbler `SearchBar` sur **`GET /search?q=`** (⚠️ pas `GET /users?search=`, réponse `{ results }` taggée `type`) → débloque « Add member » dans `team-detail.tsx` ; liaison de compte (`LinkAccountBanner`) ; pages match + notifications ; rail social (voir mémoire F-Social).
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
10. **`routeTree.gen.ts` et `api-types.gen.ts` sont générés** — gitignorés, jamais édités à la main.

📄 Les 20 pièges rencontrés, version longue et expliquée → **`docs/pieges.md`** (TOCTOU/verrous, ordre des verrous, tests de course sans barrière, slots périmés, `.env`, WSL2, Drizzle…)

---

## 📋 Conventions

**Code** — TS strict partout, ESM, Node 24 (`nvm use`, `.nvmrc`). Imports nommés > default. Validation **Zod** systématique côté API. Front : tokens depuis `frontend/src/index.css` (aucune couleur/police/radius/shadow en dur dans les pages), composants de `components/ui`, imports `@/...`, icônes `lucide-react`. Lancer `npm run build` **et** `npm run lint` avant review.

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
cd ~/transcendence
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

| Fichier | Contenu |
| --- | --- |
| `docs/schema.md` | Design complet du domaine jeu (§5.1→§5.4, tables, state machine) |
| `docs/backend.md` | Détail par domaine : auth, social, teams, matchmaking, disputes, notifications, search, jobs + reste à faire |
| `docs/frontend.md` | Détail par ticket : F0/F0-A/B/C/D, FR1, FR2, F-Nav, FL + règles front et dette |
| `docs/infra.md` | I2/I3/I4 : proxy, certs, env, cookie, OAuth, médias |
| `docs/modules.md` | Les 11 modules, exigences PDF, candidats de réserve |
| `docs/stack.md` | Versions des libs + arborescence réelle du repo |
| `docs/pieges.md` | Les 20 pièges rencontrés, version longue |
| `docs/journal.md` | Historique daté des merges et décisions |

_Refacto du 25 juillet 2026 : CLAUDE.md est passé de 116 Ko à ~9 Ko ; rien n'a été perdu, tout le détail est dans `docs/`._
