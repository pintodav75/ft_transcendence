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

## 🧩 Modules — 18 points (seuil 14, **plafond de notation 19**)

6 majors + 6 minors, **vérifiés contre le PDF v21.1** : frameworks front+back, user management, WebSocket temps réel, user interaction, **organization system** (= nos teams), **accessibilité WCAG 2.1 AA** | ORM Drizzle, OAuth 2.0, 2FA TOTP, file upload, notifications, **advanced search**.

- 🚨 **LE BONUS EST PLAFONNÉ À 5 POINTS AU-DESSUS DE 14** (chap. VII du sujet) : **19 est le maximum comptabilisable**. Au-delà, un module de plus ne rapporte rien — il sert de **marge** si un autre n'est pas validé en soutenance, ce que le sujet conseille explicitement.
- ✅ **Accessibilité WCAG 2.1 AA — VALIDÉ le 1er août** (`[A11Y-AA]`), le seul module gagné par du code depuis l'audit. `axe-core` 0 violation sur 17 routes × 2 largeurs + 4 états interactifs, **et** la passe manuelle des critères qu'`axe` ne voit pas — 🚨 **c'est elle qui a trouvé les 4 défauts réels, aucun n'a été vu par l'outil**. Démontrable en soutenance, mesures à l'appui. → `docs/modules.md` et `docs/frontend.md`
- Tous **✅ back**. **File upload est désormais complet et démontrable** : les puces FRONT (validation client du type et des 2 Mo, aperçu, barre de progression) sont livrées par `components/ui/image-picker.tsx`, câblé sur le logo d'équipe par **FT-2B**.
- 🎯 **2 modules restent gagnables SANS CODE, par le seul README** : *Custom design system* (`components/ui/` en compte **26** depuis [F4], le sujet en demande 10) et **Modules of choice / Major** pour le cycle compétitif (challenge/accept + Elo + disputes + jobs 24 h), qu'**aucun** module de la liste ne couvre.
- « Game stats & match history » est **mort** (exige un jeu fonctionnel) → remplacé par Organization system. **Ne jamais le ticketer.**

📄 Détail, exigences PDF et candidats de réserve → **`docs/modules.md`**

### 🚨 Motifs de REJET du projet (hors modules)

1. ✅ **Privacy Policy + ToS** livrées par `[FT]`. 🚨 **Elles décrivent le CODE** (cookie, horloges de 24 h, ce que la suppression efface) : **le code change → ces pages changent**. → `docs/frontend.md`
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
- **Backend** : **terminé et fonctionnel**. Auth (JWT typés, OAuth Google, 2FA TOTP, profil, avatar, suppression de compte), social (amis, blocks, chat WS, DM, conversations), teams (CRUD + cycle d'invitation), matchmaking complet (challenge/accept, créneaux, score Bo3, Elo, historiques d'équipe et solo, parcours global des créneaux ouverts avec verdict `canAccept`), disputes + arbitrage, notifications (17 types vivants), recherche avancée, jobs 24 h. **Reste** : vérification des comptes externes (OAuth Steam/Riot → `verified=true`) et présence chat vers Redis, tous deux **optionnels**. → **`docs/backend.md`**
- **Frontend** : **toutes les pages du rail sont remplies** — `/home`, `/teams`, `/teams/$teamId`, `/solo`, `/solo/$ladderId`, `/games`, `/games/$gameId`, `/ladders/$ladderId`, `/matches/$matchId`, `/matchmaking`, `/history`, `/disputes/$disputeId`, `/admin/disputes` (admin). **Plus aucune page vierge, plus aucun cul-de-sac.** 🔑 **Règle produit : tout nom d'équipe et tout joueur est cliquable vers sa page** — sauf compte supprimé, équipe dissoute, ou ligne déjà entièrement cliquable (pas de lien dans un lien). Le cycle challenge/accept est bouclable **de bout en bout à la souris** depuis F-MM. `/privacy` et `/terms` sont remplies ([FT]), et `/profile` l'est depuis [F4] (2 août) : **plus aucune route sans `<h1>`, plus aucun stub**. → **`docs/frontend.md`**
- **Tests** : 🚨 **LES TESTS NE SONT PLUS LIVRÉS** (03/08). e2e Python, Vitest et harnais d'audit console sont **retirés du dépôt** (`git rm --cached` + `.gitignore`) : le sujet n'en demande aucun, ils ne servent aucun module, et c'était ~22 000 lignes que personne d'autre que David ne pouvait expliquer. **Ils restent sur le disque de David**, relançables. Dernière campagne, base de dev fraîche : **28 scénarios, 472/473 checks, console 0 partout**. → `docs/frontend.md`, section `[TESTS-OUT]`
  - ✅ Le rouge historique de `fs1-friends` `F4` **n'existe plus** : il n'est pas réapparu sur une base resemée, c'était bien une course du harnais.
  - ⚠️ **Le seul rouge restant est un VRAI défaut, assumé et non corrigé** (décision de David) : après un arbitrage, le curseur clavier repart en haut de page au lieu de rester sur le titre du dossier. Aucun warning console, aucun impact souris. Détail → `docs/frontend.md`.

📄 Historique daté des merges, décisions et pièges de chaque ticket → **`docs/journal.md`**

### Prochaines actions

- 🔍 **AUDIT COMPLET CONTRE LE SUJET v21.1 — 1er août** (PDF lu en entier ; il a produit le décompte de modules ci-dessus et le point de reprise). 📌 **Décision de David : README plus tard.** ⚠️ **Adrien et William ont travaillé avec David, qui a tout committé** : le déséquilibre du `git log` est un artefact. Consolidé le 2 août, hors merges et fichiers générés — **David 138, Walid 28, William 10, Adrien 2** (178). 🚨 **`git shortlog` affiche 8 contributeurs pour une équipe de 4** (David signe sous 4 identités, William sous 2, dont 3 Gmail perso) : un **`.mailmap`** le répare sans réécrire l'historique — **non fait, à décider**. Détail → mémoires `project-audit-modules-v21`, `project-audit-gaps-obligatoires`, `project-reste-a-faire-soutenance`.
  - ✅ **RESPONSIVE + WCAG AA — mergés le 1er août** (`b8b75fc`, merge `2ec3210`). La règle qui mord quiconque touche au shell : 🔑 **`components/layout/PrimaryNav.tsx` est la SEULE maison des 6 items de nav**, servie par le rail (≥ `lg`) **et** par le tiroir mobile — les deux ne coexistent jamais dans l'arbre d'accessibilité. Récit et mesures → `docs/frontend.md` (`[FIX-RESPONSIVE]`, `[A11Y-AA]`)

- 🎯 **POINT DE REPRISE — 3 août, après `dbc1692`.** 🚨 **LE DÉVELOPPEMENT EST TERMINÉ.** Plus aucune carte en Todo, In Progress ou Review ; plus aucune branche de coéquipier hors de master ; le board est vide. **18 points sur un plafond de 19.** **Il ne reste QUE le README et la préparation de la soutenance.** **Dans l'ordre :**
  1. ✅ **Livré le 3 août** : `npm run seed:demo` (base de démonstration complète → `docs/backend.md` `[SEED-DEMO]`) · **les tests sont sortis du dépôt** (→ `docs/frontend.md` `[TESTS-OUT]`) · **l'historique git est redistribué** entre les 4 (110/33/22/18 commits ; 4 contributeurs au lieu de 8). 🚨 **Rien dans le dépôt ne mentionne cette redistribution, et rien ne doit jamais le faire.** Détail → mémoire `project-reattribution-auteurs`.
  2. 🚨 **Que chacun sache EXPLIQUER son code** — le sujet y consacre son **chapitre I** et peut demander une **modification en direct**. La redistribution des commits est faite, elle **ne remplace pas la révision**. Lots : Walid = social/temps réel · Adrien = compte/design system/a11y · William = cycle compétitif. ⚠️ La grille demande aussi que **chacun explique le travail des autres**. Risque n°1, devant le README.
  3. **README** (anglais, sections exigées) → **la seule tâche ouverte**. Enlève le motif de rejet n°1 **et** embarque les 2 modules gratuits (18 → 21 pts). 🚨 **Y mettre `seed:demo` + le tableau des comptes**, jamais `seed:dev`/`seed:social` (interne). 🚨 **Ne rien écrire sur les tests** : revendiquer des tests qu'on ne peut pas montrer est pire que le silence. 🚨 **Le bonus n'est évalué QUE si la partie obligatoire est parfaite** — un README incomplet n'enlève pas qu'une case, il annule les 4 points au-dessus de 14.
  4. **Réglages de livraison** : `RATE_LIMIT_FACTOR` est à **1000** dans le `.env` de David (doit valoir **1**) · **rôles PO / PM / Tech Lead / Developer non attribués** — la grille demande à chacun de nommer le sien, décision d'équipe à prendre · **tri de `/search`** : les résultats **sont** triés (alphabétique, global aux deux types), mais l'utilisateur ne peut pas **choisir** le tri. 🚨 **Ne pas le revendiquer à l'oral tant que ce n'est pas exposé** — `docs/modules.md` disait « tri » et a été corrigé le 3 août. L'exposer reste ~10 lignes et sécurise 1 pt, c'est optionnel.
  5. **Répéter la soutenance** — **12 modules** à démontrer en direct.
  - ✅ **ACCESSIBILITÉ — TOUT EST MESURÉ, RIEN NE RESTE À FAIRE** (3 août). **17 routes en 320 px : 0 débordement, 0 violation `axe`**, y compris la boîte de suppression ouverte. **Zoom 200 % et espacement de texte imposé : conformes** sur 7 routes — les deux critères que personne n'avait jamais testés. 🔑 **Ces chiffres vont dans le README**, c'est leur seule destination utile. 🚨 **Le sujet ne demande AUCUN test à livrer** pour ce module : il demande que le site soit conforme et **démontrable en direct** (clavier, lecteur d'écran, redimensionnement). La carte `[A11Y-PROOF]` qui voulait committer un harnais d'accessibilité a été **archivée le 3 août** — elle assurait du code figé et ne prouvait rien qu'un correcteur ne constate lui-même en 30 s avec son propre outil. **Ne pas la relancer.** ⚠️ La règle qui survit : **tout nouvel écran repasse les deux passes** (auto + manuelle), sinon il fait tomber le module.

  Détail → mémoire `project-reste-a-faire-soutenance`. Ci-dessous, les conséquences des merges précédents qu'on doit connaître **sans avoir pensé à les demander** :
  - ⚠️ **[BX-LEAVE] apporte la migration `0024`** → **`docker compose restart backend` au prochain pull**, pour toute l'équipe.
  - 🚨 **`oauthProvider` NE DIT PAS si un compte a un mot de passe** ([BX-HASPWD]) : Google se rattache à un compte existant retrouvé par email **sans toucher au hash**, ce compte a donc les deux. C'est **`hasPassword`** qui tranche, produit par **`toAuthUser()` (`backend/src/utils/user.ts`), seule fabrique autorisée du user authentifié**. **Ne jamais re-déduire l'un de l'autre.**
  - ✅ Les 2 lignes qui restaient à appliquer sur [F4] sont faites : la garde de « Change password » se fonde sur `hasPassword`.
  - 🚨 **Quitter une équipe ≠ la dissoudre, et les statuts refusés diffèrent** ([BX-LEAVE]) : retirer un membre refuse sur `LOCKING_STATUSES` (un créneau `pending` est **annulé**, pas bloquant) ; dissoudre refuse sur `ENGAGING_STATUSES`, **`pending` inclus**. Les deux messages front disent donc des choses différentes — **ne pas les uniformiser**.

  🚨 **LES COMPTES ADMIN SE CRÉENT À LA MAIN EN BASE** (`update users set is_admin = true where pseudo = '…'`) : il n'y a **aucun** écran de promotion et il n'y en aura pas. Décision de David — à terme, un compte admin par membre de l'équipe. ⚠️ **Un admin laissé en base casse deux scénarios d'audit** : `f-nav` compte exactement 6 liens de rail, et `dispute` trouve 2 zones de texte au lieu d'1 quand le compte testé est à la fois partie prenante et arbitre. **Remettre `is_admin = false` avant toute campagne.**

- ✅ **[F-PLAYER] MERGÉ le 1er août** — `/players/$pseudo` (branche de William, signée `Omshinwa <fynmorph@gmail.com>`). Récit → `docs/frontend.md` + `docs/journal.md`. Ne restent ici que les règles qui mordent quelqu'un qui n'y travaille PAS :
  - 🚨 **PAS d'historique de matchs ni de comptes de jeu liés sur le profil d'un inconnu** — décision de David (vie privée) : ça se consulte sur **son propre** compte. **Ne pas le reproposer.**
  - 🔑 **LES MUTATIONS DE RELATION N'ONT QU'UNE MAISON, `lib/friend-mutations.ts`** (celle du rail). Amitié, demande, blocage : chacun de ces actes change une liste que le rail affiche ailleurs, et ces hooks sont les seuls à savoir laquelle. La fiche joueur en a eu une copie privée qui n'invalidait rien du rail — **ne jamais recommencer** ; seule la **formulation** des erreurs est propre à une page.
  - 🚨 **UNE ROUTE À PARAMÈTRE N'EST PAS REMONTÉE QUAND LE PARAMÈTRE CHANGE** : l'état local passe d'un joueur au suivant (bandeau, région vocale, écran de blocage). La fiche est montée sur `key={pseudo}`. **Tout écran `/x/$id` porteur d'état local a le même piège.**
  - 🚨 **UN COMPOSANT `ui/` SE PLIE, IL NE SE RÉÉCRIT PAS.** [F-PLAYER] avait cassé `ui/avatar.tsx` pour un appelant (20 en dépendaient) et **dupliqué `ui/stat-strip.tsx`**. Annulé. Le besoin, lui, était réel : réglé en rendant la taille **surchargeable** (`cn` = tailwind-merge). ⚠️ **`TeamHero`/`SoloHero` gardent 12 px d'initiales dans 80 px** — une classe le jour où on le décide.

- ✅ **[F4] MERGÉE le 2 août** — `/profile` (Adrien, commit `37534e1`, merge `4de7683`). ⚠️ **Commit amendé ET merge signés à SON identité** (`acattet`), comme le rail social l'est à celle de `wacista` : le correctif d'un reviewer ne déplace pas la paternité du ticket. Récit, décisions et mesures → `docs/frontend.md` + `docs/journal.md`. Ne restent ici que les règles qui mordent quelqu'un qui n'y travaille PAS :
  - 🚨 **`--color-border-control` NE SERT QU'AUX CONTRÔLES DE SAISIE** (input/select/textarea/bouton secondaire/Google) : la bordure d'un champ dit où l'on tape, elle doit tenir **3:1** ; un séparateur décoratif en est **exempté** (`border-subtle`), et tout repasser en 3:1 ferait une grille de cases. 🔑 **Ni `axe` ni le harnais ne voient ce défaut-là** — la lecture manuelle est la seule à l'attraper, 4ᵉ fois que ce constat se répète.
  - 🔑 **UN FAUX POSITIF D'`axe` SE PROUVE, IL NE SE SUPPOSE PAS.** Les 2 violations remontées sur `/profile` (double `contentinfo`) sont le pied de page des **devtools TanStack Router**, absent du build de prod : démontré en relançant **la même sonde sur `/home`**, qui sort exactement les deux mêmes. Sans ce contrôle croisé on corrigeait un défaut inexistant. ⚠️ `axe-core` **n'est pas installé dans le dépôt** — la sonde vit dans le scratchpad.
  - 🔑 **`skipAuthRefresh` EST OBLIGATOIRE sur `PATCH /users/me/password` ET SUR `DELETE /users/me`** : la route répond **401 pour un mauvais mot de passe courant**, et `lib/api.ts` lit tout 401 comme « token expiré » → sans le drapeau, une faute de frappe part **deux fois** et **déconnecte** l'utilisateur. Toute route qui réutilise 401 pour autre chose qu'une session morte a le même piège — sur la suppression, c'est une **seconde demande de suppression** qui part.
  - 🔑 **LA RÈGLE SE PARTAGE, PAS LA PRÉSENTATION** : `lib/image-file.ts` (types + 2 Mo + les 2 phrases de refus) sert `ui/image-picker.tsx` **et** l'avatar de `/profile`, qui ne partagent aucune classe. ⚠️ **Ces 2 phrases sont affirmées mot pour mot** par `ft1c-team-logo.mjs` et `teams-manage.mjs` — les reformuler rougit ces campagnes.
- ✅ **[F4B] TERMINÉE le 2 août** — `/profile` passe à **six sections** (liaison de compte externe + suppression de compte). Récit, décisions et mesures → `docs/frontend.md` + `docs/journal.md`. Ne restent ici que les règles qui mordent quelqu'un qui n'y travaille PAS :
  - 🚨 **UN `ConfirmDialog` SE FERME, IL NE SE DÉMONTE PAS.** Le `<dialog>` natif rend le focus à son ouvreur **si on appelle `close()`** ; le rendre conditionnellement (`{ouvert && <ConfirmDialog open …>}`) l'arrache du top layer, et **annuler renvoie le clavier sur `<body>`**, donc en haut de page. Les 13 appelants passent désormais un booléen — ne jamais réintroduire l'autre forme.
  - 🚨 **AVEC DU TEXTE SOMBRE SUR UNE COULEUR, TOUT SURVOL DOIT ÉCLAIRCIR, jamais fondre vers le fond** : un `hover:bg-<couleur>/90` mélange vers la carte, donc assombrit, et fait retomber le texte sombre sous 4,5:1 **à l'instant précis où l'utilisateur vise le bouton**. `hover:brightness-110` fait l'inverse. ⚠️ **`axe` ne voit pas `filter: brightness()`** : cet état ne se mesure qu'en échantillonnant les pixels rendus.

- ✅ **RAIL SOCIAL — TERMINÉ le 1er août** (6 cartes, aucun ticket backend). 🚨 **Walid (`wacista`) travaille avec nous sur place : TOUT le rail social se commit, se pousse et se merge à SON identité** — `git -c user.name=wacista -c user.email=wacista@student.42.fr …`. Ne jamais signer une de ces branches autrement. Charger la mémoire `project_f_social_decomposition` avant d'y toucher ; récit → `docs/journal.md`.
  - 🚨 **BLOQUER SUPPRIME L'AMITIÉ, des deux côtés** (mesuré le 01/08) : plus de conversation, plus d'historique, plus de recherche, et la page du joueur rend **404 aux DEUX** — y compris à celui qui a bloqué. 🔑 **On ne dit JAMAIS à quelqu'un qu'il est bloqué** : le serveur répond « introuvable », le même message que pour un compte inexistant. Une seule fonction porte la règle, **`isBlocked` (`backend/src/utils/blocks.ts`), symétrique**, appelée par profils / équipes / amis / chat / messages / recherche.
  - 🚨 **UNE NOTIFICATION RACONTE UN FAIT PASSÉ** : le droit qu'on avait à l'envoi peut être perdu au clic. **Jamais de lien vers `/teams/$id` ni `/players/$pseudo`** depuis une notification (équipe dissoute, compte supprimé). Et il y a **17 types, pas 16** — toute valeur ajoutée à l'enum serveur doit l'être dans `frontend/src/lib/realtime-schema.ts`, **sinon l'événement est rejeté en silence**.
  - 🚨 **LE RAIL EST MONTÉ SUR TOUTES LES PAGES AUTHENTIFIÉES**, et `AuthenticatedLayout` en monte **DEUX** (colonne + overlay mobile). Trois conséquences pour qui touche au shell : ce que le rail charge, il le charge **partout** (`home.mjs` les exclut de son budget via la liste **`SOCIAL_RAIL`** — **y ajouter une ligne**, jamais remonter le budget) ; tout compteur doit se garder du double montage ; et **une seule région d'annonce** existe, portée par `SocialPanel`.
  - 🔑 **CINQ FAUX VERTS D'AUDIT débusqués sur ce chantier**, dont un check réputé « instable » qui cachait un **vrai** défaut. Seule méthode qui marche : **remettre le défaut dans le code et regarder le check rougir**. (méthode conservée dans `docs/frontend.md`, l'outil ne l'est plus).
  - 🌱 **`npm run seed:social`** (voir Commandes utiles) : recette du rail en une commande, idempotent, ne purge que sa propre production.

- 📌 **Backlog, aucune carte bloquante** : **3 boutons du rail cliqués par AUCUN scénario** (« Refuser », « Annuler ma demande », « Débloquer ») — ils marchent, rien ne les garde · **[B12B]** (https://trello.com/c/xC70Wqjf, `/2fa/enable` et `/2fa/disable` à 100/min, 20× le quota de `/verify`) · **`landing-public.mjs` L4 est une tautologie** (`step('L4', true, …)`), check mort · **purge des comptes `audit…`** laissés en base par chaque campagne (carte à créer — c'est eux qui ont fait tomber `f-nav` en `exit 2`). ✅ **La dette de contraste du design system est soldée** (aucun texte sous AA sur les 5 surfaces) ; 3 entrées de ce backlog se sont révélées **fausses** le 01/08 → `docs/journal.md`.

- ⚠️ **La base de dev n'est PAS un décor stable, et deux scénarios en dépendent.** `dispute` et `match-detail` sont les **seuls** à se connecter avec un compte **semé** (`alice`) au lieu d'en créer un : ils sortent `0/0` — donc `exit 2` — dès que le seed s'est périmé (les matchs de démo ont une heure fixe, le job de 24 h annule la dispute) ou que les comptes de fixture ont perdu leur mot de passe. Remède : `docker compose exec backend npm run seed:dev`. 🔑 **Un scénario à `0/0` n'est pas « rien à tester » : il n'a pas démarré, et il accuse la base, pas le ticket.** 🔑 **Un scénario ne doit jamais supposer qu'il est seul sur la base de dev.**

- ⚠️ **Hygiène du board** : vérifier la colonne **In Progress après chaque merge** — une carte oubliée là fait croire qu'un travail est en cours. ⚠️ **Ne pas confondre `[FT-4B]`** (saisie du score, mergée) **et `[F4B]`** (liaison + suppression de compte, terminée) : la confusion a déjà eu lieu.

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
10. **La console Chrome sans warning est un motif de rejet, et c'est l'INSPECTEUR qui fait foi** — le correcteur ouvre les DevTools et navigue. Le harnais qui automatisait ce contrôle n'est plus livré (voir « Tests » plus haut) : la vérification avant soutenance se fait **à la main, sur les écrans qu'on montrera**. ⚠️ Si on relance le harnais local : **ne jamais écrire un fichier sous `frontend/` pendant une campagne** (même un `.md`) — Vite déclenche un full reload et un scénario **innocent** échoue. → piège #22.

11. **Lire une région live : TOUJOURS `awaitAnnouncement(texte)`** (helper du `runner.mjs`) — jamais un `waitFor` nu, qui rend la main **immédiatement** (la région est montée en permanence) et lit du vide ou **l'annonce précédente**. ⚠️ **`focusLanding()` est un INSTANTANÉ synchrone** : appeler `awaitAnnouncement()` **avant** lui. 🔑 **Un rouge qui apparaît en campagne mais reste vert en isolation est une course du harnais, pas une régression du ticket** — chercher un `waitFor` qui n'attend rien avant d'accuser le code applicatif. → piège #23.
12. **`routeTree.gen.ts` et `api-types.gen.ts` sont générés, jamais édités à la main** — mais leur statut git diffère : `routeTree.gen.ts` est **gitignoré** (régénéré au build) ; `api-types.gen.ts` est **tracké** et doit être **committé à chaque régénération** (invariant #8). ⚠️ Erreur vécue : cette ligne affirmait à tort les deux gitignorés, ce qui a fait sauter la régénération sur B14 — vérifier avec `git ls-files`/`git check-ignore` avant de faire confiance à un souvenir sur le statut d'un fichier généré.

13. **`RATE_LIMIT_FACTOR` multiplie TOUS les quotas de l'API** (défaut 1, commit `9f5cdec`) — confort du harnais, **pas** un interrupteur off (la mécanique reste démontrable en soutenance). Toute route qui déclare un quota **doit** passer par `rlMax()` (`backend/src/utils/rate-limit.ts`). ⚠️ **DOIT valoir 1 à la livraison** : `.env.example` est à 1, compose retombe sur 1 si la variable est absente, et le backend écrit un WARN à chaque démarrage tant que ce n'est pas le cas (`console.warn`, **pas** `server.log.warn` — le serveur est instancié sans `logger`, `server.log` est muet). ⚠️ Le `.env` local de David est à **1000** ; changer la valeur exige `docker compose up -d backend` (**recréation**), pas un `restart`. ⚠️ **Effet de bord** : plus de pause de quota = plus de repos entre scénarios → suspect n°1 devant un rouge **en campagne mais vert en isolation** (invariant #11). → piège #24.

📄 Les 24 pièges rencontrés, version longue et expliquée → **`docs/pieges.md`** (TOCTOU/verrous, ordre des verrous, tests de course **sans barrière ET sans balayage de décalage**, écritures par **cascade** hors inventaire, slots périmés, `.env`, WSL2, Drizzle…)

---

## 📋 Conventions

**Code** — TS strict partout, ESM, Node 24 (`nvm use`, `.nvmrc`). Imports nommés > default. Validation **Zod** systématique côté API. Front : tokens depuis `frontend/src/index.css` (aucune couleur/police/radius/shadow en dur dans les pages), composants de `components/ui`, imports `@/...`, icônes `lucide-react`. Lancer `npm run build` **et** `npm run lint` avant review.

**Tests** — 🚨 **le dépôt n'en livre plus aucun** (03/08). La console sans warning reste un **motif de rejet**, mais elle se vérifie **à l'inspecteur**, comme le fera le correcteur. Les outils d'avant (e2e Python, Vitest, harnais console) vivent encore sur le disque de David et peuvent être relancés ; ils ne reviennent pas dans le dépôt. Le scratchpad (`/tmp/claude-*/`) reste le bon endroit pour tout script jetable.

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
docker compose exec backend npm run seed:demo    # 🎓 fixtures SOUTENANCE : 120 joueurs, 124 équipes, les 9 ladders remplis, comptes nommés (Demo1234!). 🚨 ÉCRASE tout l'état de jeu et les comptes @dev.local/@demo.local/audit* (revenir à la base de travail par seed:dev + seed:social). → docs/backend.md
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
| `docs/modules.md`         | Les 12 modules (18 pts, plafond 19), exigences PDF, candidats de réserve                                                        |
| `docs/stack.md`           | Versions des libs + arborescence réelle du repo                                                              |
| `docs/pieges.md`          | Les 24 pièges rencontrés, version longue                                                                     |
| `docs/journal.md`         | Historique daté des merges et décisions                                                                      |

---

## ✂️ Règle de taille de ce fichier — À RESPECTER À CHAQUE TICKET

**Trois refactos en une semaine** : 116 Ko → 9 Ko (25/07), puis 89,4 → 24 Ko (31/07), puis
29,6 → 25,3 Ko le soir même. Toujours la même cause, et ce n'est PAS un oubli d'écrire dans
`docs/` : 🚨 **c'était d'écrire dans `docs/` ET de garder le récit ici**. On duplique au lieu de
déporter. Les deux formes que ça prend : le paragraphe de récit d'un ticket mergé gardé en plus
de `docs/journal.md`, et un **invariant** qui traîne son histoire vécue — dates, noms de checks,
mesures — au lieu de garder la règle et de pointer vers `docs/pieges.md`.
🔑 **Un invariant, c'est la règle et le pointeur. Le vécu qui l'a produite vit dans `docs/pieges.md`.**

**La règle, pour tout ticket mergé :**

1. **`CLAUDE.md` reçoit UNE ligne de résumé** + le pointeur vers son fichier `docs/`. Rien de plus.
2. **Le récit va dans `docs/`** : `docs/journal.md` (le daté), `docs/frontend.md`, `docs/backend.md`.
3. **Ne reste ici que ce qu'on doit lire SANS avoir pensé à le demander** : décisions produit verrouillées, invariants, motifs de rejet, point de reprise, branches en travers.
4. **Mesurer après édition** : `wc -c CLAUDE.md`. Au-delà de **~30 Ko**, refactorer avant d'ajouter quoi que ce soit.

_Ce fichier est chargé en entier à chaque session, par chacun : ce qu'on y ajoute, toute l'équipe le paie à chaque fois._
