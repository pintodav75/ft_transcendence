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

## ✅ État d'avancement (résumé — 31 juillet 2026)

> ⚠️ **LE DÉTAIL PAR TICKET NE VIT PAS ICI.** Chaque ligne pointe vers son fichier `docs/` : c'est toute la raison d'être du refacto du 25/07, et le fichier était repassé de 9 à **89 Ko** pour l'avoir oublié (le récit de chaque ticket recopié ici *en plus* de `docs/`). **Une ligne de résumé ici, le récit dans `docs/`.** → voir [[feedback-claude-md-use-docs-redirections]].

- **Infra** : I2 + I3 + I4 mergés. Origine unique HTTPS, proxy Vite, certs auto, migrations auto, validation d'env Zod. → `docs/infra.md`
- **Backend** : **terminé et fonctionnel**. Auth (JWT typés, OAuth Google, 2FA TOTP, profil, avatar, suppression de compte), social (amis, blocks, chat WS, DM, conversations), teams (CRUD + cycle d'invitation), matchmaking complet (challenge/accept, créneaux, score Bo3, Elo, historiques d'équipe et solo, parcours global des créneaux ouverts avec verdict `canAccept`), disputes + arbitrage, notifications (14 types), recherche avancée, jobs 24 h. **Reste** : vérification des comptes externes (OAuth Steam/Riot → `verified=true`) et présence chat vers Redis, tous deux **optionnels**. → **`docs/backend.md`**
- **Frontend** : **toutes les pages du rail sont remplies** — `/home`, `/teams`, `/teams/$teamId`, `/solo`, `/solo/$ladderId`, `/games`, `/games/$gameId`, `/ladders/$ladderId`, `/matches/$matchId`, `/matchmaking`, `/history`, `/disputes/$disputeId`, `/admin/disputes` (admin). **Plus aucune page vierge, plus aucun cul-de-sac.** 🔑 **Règle produit : tout nom d'équipe et tout joueur est cliquable vers sa page** — sauf compte supprimé, équipe dissoute, ou ligne déjà entièrement cliquable (pas de lien dans un lien). Le cycle challenge/accept est bouclable **de bout en bout à la souris** depuis F-MM. **Restent à remplir** : `/profile` (F4, Adrien), `/privacy`, `/terms`. → **`docs/frontend.md`**
- **Tests** : `npm run audit` (audit console Chrome) sort **0 sans filtre** depuis FT-2A — dernière campagne complète **27 scénarios, exit 0** (1er août, après [F-PLAYER] et le correctif d'`Avatar`). ⚠️ Le décompte de checks n'a pas été relevé ce jour-là : `exit 0` **est** le critère (1 = un check rouge, 2 = harnais en échec). Vitest 40/40 (helpers purs) + **22 suites e2e Python** sur la vraie base de dev. → **`backend/tests/README.md`** et `frontend/tests/console-audit/README.md`

📄 Historique daté des merges, décisions et pièges de chaque ticket → **`docs/journal.md`**

### Prochaines actions

- 🎯 **POINT DE REPRISE — 1er août.** ✅ **LE RAIL SOCIAL EST TERMINÉ** (6 cartes FS-0→FS-5, + 2 correctifs), campagne **26 scénarios / 399 checks / exit 0**, console 0. Détail par carte → `docs/frontend.md`, récit daté → `docs/journal.md`. **Il n'y a PLUS de chantier en cours.** **[F-PLAYER] a été mergée le 1er août** (voir plus bas) ; la seule branche encore hors de master est **[F4]** (Adrien, renvoyée en correction). Ne restent ci-dessous que les conséquences des merges précédents qu'on doit connaître **sans avoir pensé à les demander** :
  - ⚠️ **[BX-LEAVE] apporte la migration `0024`** → **`docker compose restart backend` au prochain pull**, pour toute l'équipe.
  - 🚨 **`oauthProvider` NE DIT PAS si un compte a un mot de passe** ([BX-HASPWD]) : Google se rattache à un compte existant retrouvé par email **sans toucher au hash**, ce compte a donc les deux. C'est **`hasPassword`** qui tranche, produit par **`toAuthUser()` (`backend/src/utils/user.ts`), seule fabrique autorisée du user authentifié**. **Ne jamais re-déduire l'un de l'autre.**
  - 🔴 **2 lignes restent à appliquer sur la branche [F4] d'Adrien** : la garde de « Change password » se fonde sur `hasPassword === false` (plus sur `oauthProvider`), et son commentaire « KNOWN LIMIT » devient faux.
  - 🚨 **Quitter une équipe ≠ la dissoudre, et les statuts refusés diffèrent** ([BX-LEAVE]) : retirer un membre refuse sur `LOCKING_STATUSES` (un créneau `pending` est **annulé**, pas bloquant) ; dissoudre refuse sur `ENGAGING_STATUSES`, **`pending` inclus**. Les deux messages front disent donc des choses différentes — **ne pas les uniformiser**.
  - ⚠️ **[FX-TABLE] a été mergé sans validation visuelle** : 3 points d'apparence à regarder un jour sur un écran étroit, listés sur sa carte.

  🚨 **LES COMPTES ADMIN SE CRÉENT À LA MAIN EN BASE** (`update users set is_admin = true where pseudo = '…'`) : il n'y a **aucun** écran de promotion et il n'y en aura pas. Décision de David — à terme, un compte admin par membre de l'équipe. ⚠️ **Un admin laissé en base casse deux scénarios d'audit** : `f-nav` compte exactement 6 liens de rail, et `dispute` trouve 2 zones de texte au lieu d'1 quand le compte testé est à la fois partie prenante et arbitre. **Remettre `is_admin = false` avant toute campagne.**

- ✅ **[F-PLAYER] MERGÉ le 1er août** (https://trello.com/c/AZ3U4BZl, branche de William, signée à son identité `Omshinwa <fynmorph@gmail.com>`) : `/players/$pseudo` sert le profil, ses classements avec **rang et taille du ladder**, ses équipes, et les actions de relation. Récit, review et correctifs → `docs/frontend.md` + `docs/journal.md`. Ne restent ici que trois règles :
  - 🚨 **PAS d'historique de matchs ni de comptes de jeu liés sur le profil d'un inconnu** — décision de David (vie privée) : ça se consulte sur **son propre** compte. **Ne pas le reproposer.**
  - 🔑 **LES MUTATIONS DE RELATION N'ONT QU'UNE MAISON, `lib/friend-mutations.ts`** (celle du rail). Amitié, demande, blocage : chacun de ces actes change une liste que le rail affiche ailleurs, et ces hooks sont les seuls à savoir laquelle. La fiche joueur en a eu une copie privée qui n'invalidait rien du rail — **ne jamais recommencer** ; seule la **formulation** des erreurs est propre à une page.
  - 🚨 **UNE ROUTE À PARAMÈTRE N'EST PAS REMONTÉE QUAND LE PARAMÈTRE CHANGE** : l'état local passe d'un joueur au suivant (bandeau, région vocale, écran de blocage). La fiche est montée sur `key={pseudo}`. **Tout écran `/x/$id` porteur d'état local a le même piège.**
  - 🚨 **UN COMPOSANT `ui/` SE PLIE, IL NE SE RÉÉCRIT PAS.** [F-PLAYER] avait cassé `ui/avatar.tsx` pour un appelant (20 en dépendaient) et **dupliqué `ui/stat-strip.tsx`**. Annulé. Le besoin, lui, était réel : réglé en rendant la taille **surchargeable** (`cn` = tailwind-merge). ⚠️ **`TeamHero`/`SoloHero` gardent 12 px d'initiales dans 80 px** — une classe le jour où on le décide.
  - ⚠️ **RESTE OUVERT** : ① `player.mjs` (9 checks, 4 défauts vus rouges) ne couvre **pas** « Refuser » / « Annuler ma demande » / « Retirer des amis » ; ② **bande du hero** = ~130 px de dégradé vide, choix produit à trancher.

- 🚨 **[F4] est la DERNIÈRE branche de coéquipier hors de master.** `feature/f4-profil-page` (Adrien, https://trello.com/c/73sIH2T8) : `/profile` = **page de réglages**. **Reviewée et renvoyée à l'auteur le 30/07** (5 bloquants ; la couche métier tient, les 7 endpoints sont justes). Détail de la review → `docs/journal.md`. ✅ **Le conflit sur `/profile` avec la page joueur n'existe plus** : [F-PLAYER] a été mergée sans sa redirection.
  - 🔑 **Ça conditionne [F4B]** (https://trello.com/c/WBWaXu34, Todo) : **liaison de compte externe + suppression de compte**, les deux seuls trous front qui empêchent un utilisateur réel d'utiliser la fonctionnalité centrale (`GET`/`POST`/`DELETE /users/me/external-accounts` existent, le front ne les appelle **jamais**, et la garde est active → un vrai joueur cs2 ne peut pas lier son Steam, donc ne peut aligner personne). ⛓️ **Ne démarre QUE quand [F4] est mergé** (elle ajoute 2 sections à sa page). ⚠️ `components/home/LinkAccountBanner.tsx` existe **sans appelant** et **sa copie viole la décision produit** (« enter the queue ») — à réécrire.

- ✅ **RAIL SOCIAL — TERMINÉ le 1er août.** 🚨 **Walid (`wacista`) travaille avec nous sur place : TOUT le rail social se commit, se pousse et se merge à SON identité** — `git -c user.name=wacista -c user.email=wacista@student.42.fr …`. Ne jamais signer une de ces branches autrement. Les 6 cartes ont été faites dans l'ordre `FS-0 → FS-1 → FS-3 → FS-4 → FS-2 → FS-5`, **sans aucun ticket backend** (B-SOC couvrait tout). Carte parapluie https://trello.com/c/NBGs3xNc. Charger la mémoire `project_f_social_decomposition` avant d'y toucher. Récit du rebase et des pièges → `docs/journal.md` + `frontend/tests/console-audit/README.md`.
  - ✅ **LE RAIL SOCIAL EST TERMINÉ** — 6 cartes + 2 correctifs. Campagne **26 scénarios / 399 checks / exit 0**, console 0. **Les décisions, les pièges et les défauts de review sont détaillés carte par carte dans `docs/frontend.md`** ; ne restent ici que les règles qui mordent quelqu'un qui ne travaille PAS sur le rail.
  - 🚨 **BLOQUER SUPPRIME L'AMITIÉ, des deux côtés** (mesuré le 01/08) : plus de conversation, plus d'historique, plus de recherche, et la page du joueur rend **404 aux DEUX** — y compris à celui qui a bloqué. 🔑 **On ne dit JAMAIS à quelqu'un qu'il est bloqué** : le serveur répond « introuvable », le même message que pour un compte inexistant. Une seule fonction porte la règle, **`isBlocked` (`backend/src/utils/blocks.ts`), symétrique**, appelée par profils / équipes / amis / chat / messages / recherche.
  - 🚨 **UNE NOTIFICATION RACONTE UN FAIT PASSÉ** : le droit qu'on avait à l'envoi peut être perdu au clic. **Jamais de lien vers `/teams/$id` ni `/players/$pseudo`** depuis une notification (équipe dissoute, compte supprimé). Et il y a **17 types, pas 16** — toute valeur ajoutée à l'enum serveur doit l'être dans `frontend/src/lib/realtime-schema.ts`, **sinon l'événement est rejeté en silence**.
  - 🚨 **LE RAIL EST MONTÉ SUR TOUTES LES PAGES AUTHENTIFIÉES**, et `AuthenticatedLayout` en monte **DEUX** (colonne + overlay mobile). Trois conséquences pour qui touche au shell : ce que le rail charge, il le charge **partout** (`home.mjs` les exclut de son budget via la liste **`SOCIAL_RAIL`** — **y ajouter une ligne**, jamais remonter le budget) ; tout compteur doit se garder du double montage ; et **une seule région d'annonce** existe, portée par `SocialPanel`.
  - 🔑 **CINQ FAUX VERTS D'AUDIT débusqués sur ce chantier**, dont un check réputé « instable » qui cachait un **vrai** défaut. Seule méthode qui marche : **remettre le défaut dans le code et regarder le check rougir**. ⚠️ `awaitFocusRestored` est désormais **stricte** (focus hors de `<body>` sur 3 frames). → `frontend/tests/console-audit/README.md`
  - 🌱 **`npm run seed:social`** (voir Commandes utiles) : recette du rail en une commande, idempotent, ne purge que sa propre production.

- 📌 **Backlog, aucune carte bloquante** : **3 boutons du rail cliqués par AUCUN scénario** (« Refuser », « Annuler ma demande », « Débloquer ») — ils marchent, rien ne les garde · **[B12B]** (https://trello.com/c/xC70Wqjf, `/2fa/enable` et `/2fa/disable` à 100/min, 20× le quota de `/verify`) · **`server.ts:119` déclare `max: 100` en LITTÉRAL** au lieu de `rlMax(100)` → `RATE_LIMIT_FACTOR` ne s'applique pas au limiteur global, source des 429 en campagne (invariant #13) · **rail en `hidden lg:flex`** : sous 1024 px, ni navigation ni déconnexion · **`landing-public.mjs` L4 est une tautologie** (`step('L4', true, …)`), check mort · **purge des comptes `audit…`** laissés en base par chaque campagne (carte à créer — c'est eux qui ont fait tomber `f-nav` en `exit 2`) · **dette design system** : `text-text-muted` sur carte à 4,23:1 (45 usages) et `--color-rank-bronze` à 4,3:1, tous deux sous AA.

- ⚠️ **La base de dev n'est PAS un décor stable, et deux scénarios en dépendent.** `dispute` et `match-detail` sont les **seuls** à se connecter avec un compte **semé** (`alice`) au lieu d'en créer un : ils sortent `0/0` — donc `exit 2` — dès que le seed s'est périmé (les matchs de démo ont une heure fixe, le job de 24 h annule la dispute) ou que les comptes de fixture ont perdu leur mot de passe. Remède : `docker compose exec backend npm run seed:dev`. 🔑 **Un scénario à `0/0` n'est pas « rien à tester » : il n'a pas démarré, et il accuse la base, pas le ticket.** *(Les données de démo `bbbb2222-…` posées à la main le 30/07 ont disparu d'elles-mêmes — mesuré le 31/07, zéro ligne. La consigne « ne pas les purger » n'a plus d'objet, mais la règle reste : **un scénario ne doit jamais supposer qu'il est seul sur la base de dev**.)*

- ⚠️ **Hygiène du board** : vérifier la colonne **In Progress après chaque merge** — une carte oubliée là fait croire qu'un travail est en cours. ⚠️ **Ne pas confondre `[FT-4B]`** (saisie du score, mergée) **et `[F4B]`** (liaison + suppression de compte, Todo) : la confusion a déjà eu lieu.

- ❌ **[B10] `playerCount` par jeu est ABANDONNÉ** (décision de David, 31/07) : le code était fini et vert sur `feature/b10-player-count`, mais il n'enrichissait que la landing, qui n'est plus un besoin. **Ne pas le relancer, ne pas s'étonner que `GET /games` ne rende pas `playerCount`.** Branche et carte à supprimer.

- 🧩 **Composants** : un composant **sans connaissance du domaine** part tout de suite dans `components/ui/` ; tout le reste est extrait au **second usage réel**, par le ticket du second consommateur. **Chaque brief de `coder-front` doit porter la consigne de réutilisation** (interdiction de recopier les classes Tailwind d'un composant existant). Inventaire → `docs/frontend.md`.

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
10. **`npm run audit` sort 0 sans filtre** depuis FT-2A : une entrée console nouvelle est donc **imputable au ticket en cours**, plus noyée dans le bruit. Une erreur réseau *provoquée volontairement* par un scénario se déclare avec `expectHttp(motif, raison)` — cloisonnée à sa phase, flux réseau uniquement. ⚠️ Un `exit 2` = harnais en échec, **jamais** « console propre ». ⚠️ **NE JAMAIS ÉCRIRE UN FICHIER SOUS `frontend/` PENDANT UNE CAMPAGNE** (même un `.md`) : Vite déclenche un full reload, la SPA rebootstrape et un scénario **innocent** échoue — le rapport accuse le **ticket**, jamais l'éditeur. Éditer la doc **après** le run, ou lancer un scénario filtré. → piège #22.

11. **Lire une région live : TOUJOURS `awaitAnnouncement(texte)`** (helper du `runner.mjs`) — jamais un `waitFor` nu, qui rend la main **immédiatement** (la région est montée en permanence) et lit du vide ou **l'annonce précédente**. ⚠️ **`focusLanding()` est un INSTANTANÉ synchrone** : appeler `awaitAnnouncement()` **avant** lui. 🔑 **Un rouge qui apparaît en campagne mais reste vert en isolation est une course du harnais, pas une régression du ticket** — chercher un `waitFor` qui n'attend rien avant d'accuser le code applicatif. → piège #23.
12. **`routeTree.gen.ts` et `api-types.gen.ts` sont générés, jamais édités à la main** — mais leur statut git diffère : `routeTree.gen.ts` est **gitignoré** (régénéré au build) ; `api-types.gen.ts` est **tracké** et doit être **committé à chaque régénération** (invariant #8). ⚠️ Erreur vécue : cette ligne affirmait à tort les deux gitignorés, ce qui a fait sauter la régénération sur B14 — vérifier avec `git ls-files`/`git check-ignore` avant de faire confiance à un souvenir sur le statut d'un fichier généré.

13. **`RATE_LIMIT_FACTOR` multiplie TOUS les quotas de l'API** (défaut 1, commit `9f5cdec`) — confort du harnais, **pas** un interrupteur off (la mécanique reste démontrable en soutenance). Toute route qui déclare un quota **doit** passer par `rlMax()` (`backend/src/utils/rate-limit.ts`). ⚠️ **DOIT valoir 1 à la livraison** : `.env.example` est à 1, compose retombe sur 1 si la variable est absente, et le backend écrit un WARN à chaque démarrage tant que ce n'est pas le cas (`console.warn`, **pas** `server.log.warn` — le serveur est instancié sans `logger`, `server.log` est muet). ⚠️ Le `.env` local de David est à **1000** ; changer la valeur exige `docker compose up -d backend` (**recréation**), pas un `restart`. ⚠️ **Effet de bord** : plus de pause de quota = plus de repos entre scénarios → suspect n°1 devant un rouge **en campagne mais vert en isolation** (invariant #11). → piège #24.

📄 Les 24 pièges rencontrés, version longue et expliquée → **`docs/pieges.md`** (TOCTOU/verrous, ordre des verrous, tests de course **sans barrière ET sans balayage de décalage**, écritures par **cascade** hors inventaire, slots périmés, `.env`, WSL2, Drizzle…)

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
docker compose exec backend npm run seed:dev     # fixtures JEU (joueurs, équipes, 8 matchs de démo)
docker compose exec backend npm run seed:social  # fixtures RAIL SOCIAL sur alice@dev.local (amis, demandes, blocage, messages, notifs) — exige seed:dev
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
| `docs/pieges.md`          | Les 24 pièges rencontrés, version longue                                                                     |
| `docs/journal.md`         | Historique daté des merges et décisions                                                                      |
| `backend/tests/README.md` | Les suites e2e Python : ce que couvre chacune, helpers disponibles                                           |
| `frontend/tests/console-audit/README.md` | Audit console Chrome automatisé : lancer, écrire le scénario d'un ticket, la dette connue |

---

## ✂️ Règle de taille de ce fichier — À RESPECTER À CHAQUE TICKET

**Refacto du 25 juillet 2026** : `CLAUDE.md` était passé de 116 Ko à ~9 Ko, et `docs/` a été créé **exactement pour ça**.
**Second refacto, 31 juillet 2026** : le fichier avait ré-atteint **89,4 Ko** — 97 % du chemin de retour. Ramené à **~24 Ko**, rien perdu, tout déporté vers `docs/`.
**Troisième refacto, 31 juillet 2026 au soir** : **29,6 → 25,3 Ko**, en une seule soirée. Deux causes, les mêmes que d'habitude — ⓵ les **5 tickets mergés dans la soirée** avaient chacun gardé ici un paragraphe de récit **en plus** de `docs/journal.md` (5,5 Ko à eux seuls) ; ⓶ trois **invariants** (#10, #11, #13) traînaient leur **histoire vécue** — dates, noms de checks, mesures — au lieu de garder la règle et de renvoyer vers `docs/pieges.md` (devenu #22, #23, #24). 🔑 **Un invariant, c'est la règle et le pointeur. Le vécu qui l'a produite vit dans `docs/pieges.md`.**

🚨 **La cause n'était pas un oubli d'écrire dans `docs/` : c'était d'écrire dans `docs/` ET de garder le récit ici.** On a dupliqué au lieu de déporter. Trois lignes portaient à elles seules **33,7 Ko** (Frontend 17,5 · Backend 11 · Tests 5,2), écrites en **un seul paragraphe sur une seule ligne** — donc invisibles au `wc -l`.

**La règle, pour tout ticket mergé :**

1. **`CLAUDE.md` reçoit UNE ligne de résumé** + le pointeur vers son fichier `docs/`. Rien de plus.
2. **Le récit va dans `docs/`** : `docs/journal.md` (le daté), `docs/frontend.md`, `docs/backend.md`, `backend/tests/README.md`.
3. **Ne reste ici que ce qu'on doit lire SANS avoir pensé à le demander** : décisions produit verrouillées, invariants, motifs de rejet, point de reprise, branches en travers.
4. **Mesurer après édition** : `wc -c CLAUDE.md`. Au-delà de **~30 Ko**, refactorer avant d'ajouter quoi que ce soit.

_Ce fichier est chargé en entier à chaque session, par chacun : ce qu'on y ajoute, toute l'équipe le paie à chaque fois._
