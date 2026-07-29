# Frontend — détail par ticket

> Extrait de CLAUDE.md (refacto 25/07). Détail par ticket front, du socle F0 à la fiche de match.
>
> **Ordre de lecture** : le socle (F0/F0-A/B/C/D, FR1, FR2, FL et la **première** version de F-Nav) est décrit dans la longue section ci-dessous ; les tickets à partir de FT-1 ont chacun leur section datée, en ordre chronologique. À jour au **29/07/2026** (dernier ticket documenté : **FT-4B**).

### Frontend — F0 + F0-A + F0-B + F0-C + FR1 + F0-D + F-Nav + FR2 (Login + 2FA)

**Fondation design F0 mergée** :

- `frontend/src/index.css` est la **source de vérité visuelle** : tokens Tailwind v4 couleurs, polices, radius, shadows, styles globaux et utilitaires DA
- DA retenue : fond sombre compétitif et sobre ; rappels rouge/bleu ; action principale **indigo nocturne** `action-primary` ; pas de texte courant en gradient
- Composants UI de base : `Button` (`primary`, `secondary`, `ghost` ; le variant primaire porte son style complet), `Input`, `Label`, `Card` translucide à 84 % + `CardHeader`/`CardContent`/`CardFooter`, `FormMessage` et `PasswordInput`
- Setup shadcn-like : `frontend/components.json`, alias `@/*`, `src/lib/utils.ts` avec `cn()`
- ⚠️ `App.tsx` (ex-écran de validation DA) a été **supprimé** en F0-B : le bootstrap se fait via le routeur (`main.tsx` → `RouterProvider`) et `pages/login.tsx`

**Client API + auth store F0-A implémenté/testé** :

- Store Zustand dans `frontend/src/stores/auth-store.ts` : `user`, `accessToken`, `ready`, `setSession`, `setAccessToken`, `clearSession`, `restoreSession`, `logout`
- Client API dans `frontend/src/lib/api.ts` : base **relative `/api`** (I4, `lib/api-config.ts` — le navigateur ne connaît que l'origine `https://localhost:5173`, Vite proxifie), `credentials: 'include'`, Bearer automatique depuis le store, erreurs typées `ApiError`
- Refresh transparent : sur `401`, `POST /auth/refresh`, mise à jour du token, replay de l'appel **une seule fois** ; si refresh échoue → session locale vidée + logout backend best-effort
- Types auth dans `frontend/src/types/auth.ts`, config base URL dans `frontend/src/lib/api-config.ts`
- Testé avec backend réel : register/login manuel en console navigateur, `apiFetch('/auth/me')` (route supprimée depuis — T3), token invalide → refresh/retry OK, reload page → session restaurée
- Vérifications passées : `npm run build`, `npm run lint`, `git diff --check`

**Routing + home F0-B mergé (Trello Done)** :

- **TanStack Router file-based** : plugin `@tanstack/router-plugin/vite` (`tanstackRouter({ target: 'react', autoCodeSplitting: true })`) génère `src/routeTree.gen.ts` (**PAS versionné** — gitignoré depuis `0df06ef`, régénéré au démarrage de Vite ; ne jamais l'éditer à la main) ; `main.tsx` monte `createRouter({ routeTree })` + `<RouterProvider>` avec augmentation de module TS (`Register`)
- **Pattern route/page** : `src/routes/*.tsx` = wrappers minces `createFileRoute` (config routeur) ; `src/pages/*.tsx` = vrais composants. `__root.tsx` importe le `RootLayout` global, qui rend `<Outlet/>` + `<TanStackRouterDevtools/>` et gère uniquement le titre de page : la restauration de session n'y est plus lancée globalement.
- ✅ **Correctif Fast Refresh** (`fix/frontend-fast-refresh-routes`) : composants extraits des fichiers de routes ; `npm run lint` passe désormais avec 0 erreur et 0 warning, `npm run build` passe
- **F0-C — zone authentifiée centralisée** : `routes/_authenticated.tsx` est une route layout *pathless*. Son unique `beforeLoad` attend `restoreSession()` si `!ready`, relit ensuite le store Zustand et redirige un visiteur vers `/`. Ses enfants protégés sont `/home`, `/games`, `/profile`, `/teams`, `/teams/$teamId` et `/ladders/$ladderId` (`/ranking` supprimée par FT-3) ; ajouter une future page privée sous ce parent évite de recopier la garde.
- **Shell authentifié partagé** : `AuthenticatedLayout` rend trois colonnes (`LeftRail`, centre `<Outlet/>` + `SiteFooter`, `RightRail`). Les rails F0-C sont volontairement vides pour l'instant, visibles et sticky sur desktop. L'ancien `/dashboard`, le layout local de Teams et les rails/footer dupliqués dans Ranking ont été supprimés.
- **Garde des routes visiteur** : la landing `/`, `/login` et `/register` restaurent la session dans leur `beforeLoad`, puis redirigent un utilisateur déjà connecté vers `/home`. La landing n'est donc affichée qu'aux visiteurs déconnectés.
- **Chargement visuel** : `index.html` fixe le titre initial à `VS MODE`, annonce un color-scheme sombre et pose immédiatement le fond `#070a12`; le navigateur n'affiche ainsi plus de flash blanc avant le démarrage de React.
- **Home / landing (`pages/index.tsx`)** : layout arène complet — rails flottants fixes `LeftNav` (nav + sélecteur langue + `AuthNav`) et `RightNav` (avatar + icônes), viewport central scrollable avec `HeroBanner` (asset `bg.webp`) + `GameRail` (rail scroll-snap de cartes jeu, **données en dur** pour l'instant) + `SiteFooter` (liens Terms/Privacy)
- **Nouveaux composants UI** : `avatar` (sans dépendance radix), `menu-item` (rend un `<Link>` TanStack si prop `to`, sinon `<button>`), `icon-menu-item` (bouton icône + tooltip)
- **Nouveaux `@utility` dans `index.css`** : `panel` (surface carte des rails flottants), `label-caps` (gras/majuscules/tracking), `focus-ring` (outline violet clavier, a11y). Utilitaires arène (`arena-background`, `text-arena-gradient`, `arena-wordmark`…) déjà présents

**Register FR1 implémenté, testé et mergé** :

- **DA Register finalisée** : carte sombre translucide, wordmark géant `V/S` Geist 900 découpé par une barre oblique responsive, teintes rouge/bleu en fondu, titre `VS MODE`, interface en anglais par défaut, layout fixe `100dvh` avec fallback de scroll interne seulement si la hauteur est insuffisante
- **Formulaire** : `pseudo`, `email`, `password` avec toggle afficher/masquer ; React Hook Form + schéma Zod dans `lib/register-schema.ts`, validation initiale `onTouched` puis interactive, erreurs visibles seulement après saisie ou submit, espaces d'erreur stables et styles accessibles `aria-invalid` ; `pseudo` trimé et mot de passe limité à 72 caractères comme le backend
- **Inscription classique** : `POST /auth/register` via `apiFetch`, `setSession()` Zustand, état de chargement, gestion `400`/`409`/`429`/réseau, puis redirection vers `/home`
- **Google OAuth** : composant réutilisable `GoogleAuthButton` avec logo officiel ; redirection navigateur vers `/auth/oauth/google/start` ; callback backend corrigé pour poser le refresh cookie puis rediriger vers `${FRONTEND_URL}/home` ; la garde F0-C de `/home` restaure alors la session (`refresh → me`)
- **Navigation** : `VS MODE` renvoie vers `/`, lien `/login`, sélecteur EN/FR/ES (traduction différée), liens `/terms` et `/privacy` sous la carte ; `RootLayout` adapte le titre à la route TanStack résolue (`VS MODE Connect` sur `/login` et `/register`, `VS MODE` ailleurs), sans flash de titre lors d'une redirection ; un utilisateur déjà connecté qui demande `/login` ou `/register` est redirigé vers `/home`
- **Tokens** : couleur primaire globale passée à l'indigo nocturne (`#343579`) ; aucune couleur/police/radius/shadow écrite en dur dans `pages/register.tsx`
- **Testé avec backend réel** : inscription + session, validation sans requête backend, doublon `409`, OAuth Google, retour `/home` et restauration de session. Vérifications : build/lint frontend, type-check + 12 tests Vitest backend, `git diff --check`

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

> ⚠️ **CETTE VERSION DU RAIL EST SUPERSÉDÉE.** Le rail a été **recodé le 29/07** d'après la maquette (`4a5c4bb`) et `LeftRail` a **absorbé `LeftNav`** — il existait en double. Voir la section **[F-Nav — rail gauche conforme à la maquette (29/07/2026)]** plus bas ; ce qui suit décrit l'état d'origine et reste utile pour les pages et les données qu'il a apportées, pas pour la structure du rail.

- 🧭 **Coquille de navigation (F-Nav)** : rail gauche flottant `LeftNav` (`Logo` + menu `MenuItem` : play [stub], my teams → `/teams`, ~~ranking → `/ranking`~~ (retirée par FT-3), find party [stub], games → `/games`) avec `AuthNav` épinglé en bas — sélecteur de langue EN/FR/ES **non câblé** + actions auth **réelles** (login/sign up hors session, profile/logout en session ; `logout` du store puis redirect `/`). Rail droit `RightNav` réutilisé de F0-B.
- 🗂️ **Layout de section `/teams`** (`pages/teams/route.tsx`) : porte les rails + `SiteFooter` et rend un `<Outlet/>`, pour que liste et détail ne répètent pas la coquille. Wrappers file-based : `routes/teams/route.tsx` (layout), `routes/teams/index.tsx`, `routes/teams/$teamId.tsx`.
- 👥 **Mes équipes (`pages/teams/index.tsx`)** : `GET /teams` puis **un `GET /teams/:id` par équipe en parallèle** (`Promise.all`) pour les visages du roster (un échec isolé → roster vide, jamais de page blanche). Filtre par jeu via `LadderSelect` mode `game`, bouton **Créer une équipe** → `TeamCreation`. Chaque `TeamCard` est un `<Link to="/teams/$teamId">`.
- 🛡️ **Détail équipe (`pages/teams/team-detail.tsx`)** : rôle spectateur (`Guest`/`Stranger`/`Member`/`Captain`), roster + couronne capitaine, **kick / quitter / dissoudre** (`leaveTeam` : dissolution `DELETE /teams/:id` capitaine → redirect `/teams` ; `DELETE /teams/:id/members/:userId` pour kick/quit — quitter soi-même → redirect, kick → maj optimiste du roster), bouton **Upload Avatar** (stub `alert` — pas d'endpoint logo team), retour `/teams`. ⚠️ **Ajout de membre via `SearchBar` COMMENTÉ** (dépend d'une recherche partielle de pseudo côté back non mergée — cf. bloc « tenu à l'écart »).
- ➕ **Création d'équipe (`TeamCreation`)** : `LadderSelect excludeSolo` + nom, `POST /teams`, erreurs mappées (409 nom pris / déjà dans une équipe sur ce ladder ; 400 Zod).
- 🎛️ **`LadderSelect`** : sélecteur jeu+format contrôlé, deux modes (`ladder` défaut → émet un ladderId ; `game` → émet un gameId), options `excludeSolo` et `all`. Charge `/games` + `/ladders` **une fois** et filtre en mémoire.
- 🏆 ~~**Ranking (`pages/ranking.tsx`, routes `/ranking` ET `/games`)**~~ — ⚠️ **SUPPRIMÉ par [FT-3] le 28/07** : `/ranking`, `pages/ranking.tsx`, `routes/_authenticated.ranking.tsx` et `components/home/RankingTable.tsx` n'existent plus. Décision de David : le classement se consulte sur la page d'un ladder (`/ladders/$ladderId`), et le point d'entrée passera par **`/games`** (pas encore codé — carte à ouvrir). Pour mémoire, ce qu'elle faisait : `LadderSelect` + `RankingTable` (consomme **B2** : `GET /ladders/:id/rankings`, tri ELO, avatar/pseudo ou nom/logo team, médailles top 3, états loading/erreur/vide). ⚠️ **Lignes non cliquables** : le leaderboard ne renvoie **pas d'id** de compétiteur (`shapeRankings` le jette) → pas de lien `/teams/:id` sans changement back.
- 🔤 **Codegen OpenAPI EN PLACE** : `frontend/src/lib/api-types.gen.ts` (généré via `openapi-typescript` depuis `openapi.yaml`) ; les pages importent `components['schemas']['TeamDetail' | 'TeamListItem' | 'Ladder' | 'Game' | …]`. **Remplace le contrat manuel** pour tout ce qui vient du YAML. ⚠️ La mise en garde `Date`→`string` ISO **reste vraie** (un `scheduledAt` arrive en string, ne pas le traiter comme un `Date`).
- ⚠️ **Stubs / non câblé** : `/profile` (« a faire mdr »), `LinkAccountBanner` (composant §5.1 prêt mais monté nulle part), sélecteur de langue, boutons `play` / `find party`, Upload Avatar team.
- ✅ `npm run build`, `tsc --noEmit` et `npm run lint` passent (2 **warnings** Fast Refresh non bloquants, préexistants à FR2, sur `routes/games.tsx` et `routes/profile.tsx`).

**Tenu à l'écart de ce commit (local uniquement, PAS sur origin)** : `SearchBar` (recherche partielle de pseudo, `components/home/SearchBar.tsx` untracked), l'endpoint back `GET /users?search=` (`ilike`, dans un `git stash`) et le type manuel `types/api.ts`. À reprendre quand le back de recherche sera prêt : décommenter l'import + le bloc « Add member » + la fonction `addMember` dans `team-detail.tsx`, puis committer les fichiers tenus à l'écart.

**FL — Landing publique (MERGÉE sur `master`, merge `85e1c76`) : vitrine `/` avant connexion** :

- **Objectif carte Trello [FL]** : vitrine publique `/` (cartes de jeux alimentées par le back, CTA login/register, footer PP/ToS). **DoD faite** : `/` public pour les visiteurs déconnectés, cartes `GET /games`, CTA login/register, footer PP/ToS, composants icônes/logos. F0-C complète la garde : un utilisateur déjà connecté qui demande `/` est redirigé vers `/home`.
- 🧭 **`LandingNav` (`components/landing/`) — nav PROPRE à la landing, distincte de `LeftNav`.** C'est la décision structurante de la branche : `LeftNav` est le rail de la **zone connectée** (routes `/teams` `/games`, `/ranking` retirée par FT-3, positionnement `fixed`) et **n'est plus touché par la landing**. `LandingNav` ne garde que les entrées qui ont un sens sans session (pas de `play`, `find party`, `club`). ⚠️ **Réduit au logo + `AuthNav`** : les entrées `ranking`/`games` ont été retirées avant merge parce qu'elles étaient **sans `to`**, donc des `<button>` inertes. `/ranking` et `/games` existent sur master → à recâbler quand la landing aura sa nav définitive (voir barre mobile).
- ♿ **Le landmark est le rail lui-même** : `<nav aria-label="Main">` à la racine de `LandingNav`, pas un `<nav>` interne — le logo et les liens login/sign-up d'`AuthNav` sont **aussi** de la navigation. Le libellé distingue ce nav de celui du footer (`aria-label="Legal"`).
- 📐 **`SiteLogo` mis à l'échelle du rail** via **container query** : `@container` sur le `<nav>` + `text-[length:23cqw]` sur le logo — les `cqw` se résolvent contre la largeur du **rail**, pas du viewport (un `vw` déborderait dès que `max-w-[300px]` plafonne). ⚠️ `--font-display` est une **pile système** (pas Geist) : le rendu du wordmark diffère d'un poste à l'autre, la proportion est nominale.
- 📱 **Responsive partiel (assumé)** : `LandingNav` est `hidden md:flex` → **plus de nav ni de logo sous 768px**, les CTA du hero sont le seul accès à l'authentification. La barre horizontale mobile reste à faire. ⚠️ **Vrai bloqueur mobile non traité** : l'overlay `GameInfo` ne se révèle qu'en `group-hover`/`group-focus-within` → **infos des jeux inatteignables au tactile**.
- **Layout `pages/index.tsx`** : deux colonnes flex — `LandingNav` + colonne corps scrollable. **`h-dvh`** (et non `h-screen`) : `100vh` est calculé barre d'URL rétractée, donc avec `overflow-hidden` le bas de page devenait inatteignable sur mobile. Landmarks frères : nav / `<main>` (hero + cartes) / `<footer>`.
- **`GamesCards`** : cartes **fixes 300px** (`w-[300px] shrink-0`, image `aspect-square`) dans un `flex flex-wrap`. **Sémantique de liste** : `<ul role="list">` + `<li>` (le `role` explicite est requis — Safari retire les sémantiques de liste sur un `<ul>` en `display:flex`), et `<section aria-labelledby>` relié au `<h2>` via **`useId()`**. ⚠️ Sous ~332px de large, les cartes débordent (prix de la taille fixe).
- **Données (`lib/games.ts`)** : `useGames()` (`GET /games`) + `useLadders()` (`GET /ladders`), `staleTime` 1 h ; helpers purs `sortGames` (ordre `data/games.ts`), `formatsForGame`, `useSortedGames`. ⚠️ **Types `Game`/`Ladder` écrits à la main** — à basculer sur `lib/api-types.gen.ts` (codegen OpenAPI, arrivée avec F-Nav) : **dette identifiée, non traitée**.
- **`buttonClasses` (`components/ui/button-variants.ts`)** : style extrait de `button.tsx` (règle Fast Refresh) et partagé par `Button` **et** les `<Link>` stylés bouton du hero. ⚠️ **Fusionné au rebase** avec les apports de master : 4 variantes (`primary`/`secondary`/`ghost`/**`danger`**) et bordure + `font-semibold` sur `primary`.
- **Assets** (`frontend/src/assets/`) : `images/*.webp` (512²), `logos/*.png`, `icons/*.png` — maps `gameImages`/`gameLogos`/`gameIcons` dans `data/games.ts`, **clés = id back**. Renderer unique `GameAsset` → coquilles `GameLogo`/`GameIcon`/`GameImage` ; `GamesFallback` loading/error ; `GameInfo` présentational.
- ⚠️ **`.gitignore` : `data/` → `/data/`** — changement **obligatoire**, pas cosmétique : l'ancien motif attrapait `frontend/src/data/`, donc `data/games.ts` (toutes les maps d'assets) ne pouvait pas être commité.
- ⚠️ **`components/home/` n'a PAS été renommé** : seul `HeroBanner` a migré vers `landing/`. Les composants de F-Nav (`LadderSelect`, `TeamCreation`, `SearchBar`, `LinkAccountBanner` — `RankingTable` a été **supprimé par FT-3**) **restent dans `home/`** — git avait tenté de les emporter par *directory rename detection* pendant le rebase. `home/` est donc mal nommé (il contient du teams/ranking) : **nettoyage à faire, séparément**.
- ⚠️ **`Logo` (master, `<h1>` + italique, prop `to`) et `SiteLogo` (FL, lien auth-aware `/home` ou `/`) coexistent** — deux composants réellement différents, **fusion à arbitrer**, volontairement pas tranchée pendant le rebase.
- ⚠️ **Composants sans consommateur conservés** (décision assumée) : `GamesIcons`, `GamesLogos`, `GamesInfos`, `RightNav`. `GamesInfos` porte encore l'ancienne largeur de carte → **déjà en train de diverger**.
- 🧩 **Architecture deux zones — première moitié codée par F0-C** : la zone app est désormais portée par la route layout *pathless* `routes/_authenticated.tsx`, avec son shell et sa garde centralisés. La zone publique reste pour l'instant directement sous la racine (pas encore de `_public`). Le déterminant reste **la zone, pas la session**. Décision d'équipe du 22/07/2026 : un visiteur demandant une route protégée est redirigé vers la landing `/`, et non vers `/login` ou `/home`. `SiteLogo` purement présentationnel et le shell neutre partagé par `/terms` et `/privacy` restent des évolutions possibles, à traiter seulement avec leur contenu.
- **Reste FL** : barre de nav mobile + overlay tactile, compteur de joueurs — ⏸️ **[B10] EN PAUSE (22/07), carte en Todo** : https://trello.com/c/7UdiDepz. 🚨 **Le code est ÉCRIT, FINI et VÉRIFIÉ** sur la branche **`feature/b10-player-count`** (commit `80c675b`) — **NON mergée**, donc `games.ts` sur master est inchangé. **NE PAS RECODER la feature : reprendre la branche.** Elle ajoute `playerCount` à `GET /games` et `GET /games/:id` (union `team_members`→`teams` ∪ `match_participants`, `count(DISTINCT user_id)` par jeu), avec un schéma OpenAPI **séparé** `GameWithPlayerCount` — ⚠️ ne jamais remettre le champ dans `Game`, partagé avec `GET /ladders/:id` qui ne le renvoie pas. Mise en pause parce qu'elle n'impacte que la landing, non prioritaire. À rebaser avant merge ; conflit sur `api-types.gen.ts` → **régénérer**, ne pas résoudre à la main. La landing affiche donc toujours `—`, `gameHref` (table vide) + `<Link>`, i18n, bascule sur la codegen OpenAPI.
- ✅ **2 défauts corrigés (carte [FIX] Landing)** : `GameAsset` n'affiche plus de texte de debug — un asset manquant rend désormais une surface neutre portant le nom du jeu (même idiome qu'`Avatar`, `role="img"` + `aria-label`, empreinte de l'appelant conservée pour ne pas casser la carte) ; et le hero ne promet plus **« Queue by skill »** — le produit n'a **ni file d'attente ni appariement automatique** (décision du 13/07), le slogan parle maintenant de défi (`Challenge any team, agree on a time…`). ⚠️ Le fallback de `GameAsset` est un chemin **défensif** : les 5 jeux ont leurs 3 assets, il ne se déclenche jamais avec les données actuelles. F0-C harmonise désormais le titre initial et le titre dynamique sur **« VS MODE »**.

**Règles front à respecter dès F0-A et les pages suivantes** :

- importer avec `@/...`, éviter les chemins relatifs longs
- ne pas écrire de couleurs/polices/radius/shadows en dur dans les pages ; ajouter d'abord un token dans `index.css` si nécessaire
- réutiliser les composants `frontend/src/components/ui` autant que possible
- utiliser `lucide-react` pour les icônes standard
- lancer `npm run build` et `npm run lint` dans `frontend/` avant review



---

### FT-1 + FT-1B — page « My teams » et création d'équipe (26/07/2026)

Merge `640248b` (FT-1B : commit `90736e4`). `/teams` liste les équipes du joueur en **grille d'affiches** — la tuile est l'artwork du jeu (le même `.webp` que les cartes de la landing) avec le logo de l'équipe par-dessus, une couronne si le joueur est capitaine, la tuile entière cliquable vers la page détail. **Un seul `GET /teams`** sert toute la grille. Le formulaire de création (nom, ladder, logo optionnel) vit sur la même page et invalide `['teams']` après succès ; `POST /teams` accepte un `logoUrl` optionnel et rend un **409 à code structuré**.

**Livré** — `components/teams/TeamCard.tsx`, `components/teams/TeamsCards.tsx`, `lib/create-team-schema.ts`, helpers de `lib/teams.ts`, `pages/teams/index.tsx` réécrite.

**Retours de review intégrés, à ne pas défaire :**

- **La grille est en `minmax(min(18rem, 100%), 1fr)`** — sans le `min()`, la piste garde un plancher de 288 px et **déborde sur un écran de 320 px**.
- **Le filtre par jeu ne liste que les jeux où le joueur a au moins une équipe**, « All » restant toujours visible : un filtre qui ne filtre rien est un bouton mort.
- **Tri par jeu puis alphabétique** : deux affiches identiques éloignées l'une de l'autre se lisaient comme un doublon.
- **`RightRail` porté à 312 px**, la largeur du rail social de la maquette — pour que les pages soient calées dès maintenant sur la place qu'elles auront vraiment (voir [[reference-home-maquette]] et `project_front_layout_constraints`).

### FT-2A — page détail d'une équipe, consultation (27/07/2026)

`/teams/$teamId` réécrite **de zéro** (le brouillon d'un coéquipier a été jeté, pas nettoyé). Lecture seule : la gestion capitaine est dans **[FT-2B]** (https://trello.com/c/tmgQGBVz), les actions de match dans **[FT-2C]** (https://trello.com/c/LnSfRghd), la page ladder dans **[FT-3]** (https://trello.com/c/6yZLPjpP).

**Livré** — `lib/team-detail.ts` (3 hooks TanStack Query + dérivations pures + formateurs), `pages/teams/team-detail.tsx` (orchestration, rôle, états d'erreur), 8 composants dans `components/teams/detail/`, 3 pages placeholder (`players/`, `matches/`, `ladders/`) avec leurs routes, et le scénario d'audit console réécrit (13 checks).

**Ce qui est structurant pour la suite :**

- **Contrainte de largeur mesurée** : la colonne centrale du shell ne fait que **616 px** à un viewport de 1280 (les deux rails en prennent ~660). Une table qui réclame plus **fait sortir sa dernière colonne du champ** sans rien signaler — c'est arrivé sur la colonne Status de l'historique (810 px réclamés). Vérifier `scrollWidth` vs `clientWidth` du conteneur, **pas à l'œil**.
- **Piège CSS** : déclarer un **seul** axe d'`overflow` force l'autre à `auto` (jamais `visible`). La barre d'onglets portait `overflow-x-auto` « au cas où » ; le `-mb-px` volontaire des onglets suffisait à produire 1 px de débordement vertical, donc une barre de défilement parasite. Ne mettre un `overflow-*` qu'après avoir mesuré un débordement réel.
- **Stratégie d'extraction des composants** (décidée le 27/07) : un composant **sans aucune connaissance du domaine** part tout de suite dans `components/ui/` — c'est le cas de `pill.tsx`, `section-title.tsx`, `tabs.tsx` + `tab-ids.ts`, extraits par ce ticket. Tout le reste suit la **règle de deux** : extraction au **second usage réel**, par le ticket du second consommateur. Restent donc en place, avec leur extraction déléguée : `match-status.ts` / `MatchStatusPill` / `MatchRow` (→ ticket page match, vers `components/matches/`), le `LadderRow` interne à `LadderExcerpt` (→ **fait par FT-3**, vers `components/ladders/` : `LadderRow` + `LadderBoard`, consommés par `LadderExcerpt` ET la page ladder. ⚠️ La consigne d'origine disait de lui faire aussi remplacer `components/home/RankingTable.tsx` ; David a préféré **supprimer** `/ranking`, cf. plus haut), `RosterChips` (→ FT-2B lui ajoute une prop pour le kick, sans le dupliquer).
- **Copie d'interface en anglais** comme le reste de l'app connectée ; seules les **dates** sont formatées en `fr-FR`.
- **Sous-titre de l'en-tête** : ne pas répéter le `ladderName` quand il ne dit rien de plus que le jeu et le format (`Rocket League · 2v2 · Rocket League 2v2`) ; le garder quand il ajoute une information (`Counter-Strike 2 2v2 (Wingman)`). Helper `ladderSubtitle()`.

**Pièges de données traités** (ils reviendront sur la page match) :

- une **équipe neuve est absente du classement** — la ligne de rating naît au **premier résultat de match** (`backend/src/utils/rankings.ts`), pas à la création. D'où l'état « Not ranked yet » (Elo/record/rang à `—`) et l'extrait qui retombe sur le **top du ladder** ;
- `score.self`/`score.opponent` sont `null` **avant clôture ET après un arbitrage admin** — donc `null` possible sur un match `completed`, avec un `eloDelta` renseigné. Jamais « 0-0 » ;
- `scheduledAt`/`completedAt` sont des **strings ISO nullables** (`new Date(null)` rend 1970 en silence) ;
- la clé `lineup` est **absente** (pas `null`) pour un non-membre → dériver l'affichage de sa présence, pas de `isMember` ;
- un ratio sans match joué s'affiche `—` et non `0%`.

**Harnais d'audit console — `expectHttp(motif, raison)` ajouté à `runner.mjs`.** Chrome logge « Failed to load resource » pour tout fetch non-2xx : tester un écran 404 et sortir 0 étaient contradictoires. Trois garde-fous, vérifiés par une sonde vue **rouge** avant d'être verte : seuls les **flux réseau** sont exemptables (une exception ou un `console.error` de notre code reste imputé, même s'il cite l'URL visée) ; l'exemption est **cloisonnée à la phase** de déclaration ; un motif jamais déclenché est **signalé**. Détail dans `frontend/tests/console-audit/README.md`.

➡️ **Conséquence : `npm run audit` sans filtre sort désormais 0** sur les 6 scénarios (48 checks). Trois scénarios antérieurs (FR1, FR2, FT-1B) provoquaient volontairement un 401/409 qu'ils comptaient contre eux-mêmes — une ligne `expectHttp` chacun. Toute entrée console nouvelle est donc immédiatement visible.

**Dette laissée, assumée et mesurée :**

- ⚠️ **`text-text-muted` (#707b94) sur `surface-card` donne 4,23:1**, sous le 4,5:1 de WCAG AA. Ce n'est pas propre à cette page : **45 usages dans 25 fichiers** (login, register, footer, nav gauche, grille `/teams`, tableau de classement…), et la maquette porte la même valeur. Lever `--color-text-muted` vers ~`#7b86a0` donnerait 4,92:1 mais éclaircit le texte secondaire de **toute** l'app → **ticket design system à ouvrir**.
- ⚠️ **À 375 px, l'historique laisse 262 px hors champ** (table 605 px dans 343 px) : Score, Elo et Status ne sont visibles qu'en balayant. L'accès **clavier** est réglé (le conteneur prend le focus et porte un `aria-label`, WCAG 2.1.1), il reste l'ergonomie : le vrai correctif est un rendu **en cartes** sous `sm`. Rejoint la dette mobile FL.
- L'onglet actif vit dans un `useState`, pas dans un search param : on ne peut pas partager un lien vers l'onglet Matches.
- ~~`components/home/SearchBar.tsx` n'a plus de consommateur~~ → **traité par FT-2B** : déplacé en `components/search/UserSearch.tsx` et recâblé sur `GET /search?q=&type=user`.

---

### FT-2B — page détail d'une équipe, gestion capitaine (27/07/2026)

Onglet **Manage** réservé au capitaine (renommer, envoyer et retirer le logo, ajouter un joueur, exclure un membre, dissoudre), **Leave team** en en-tête pour un membre non-capitaine, **aucune action** pour un visiteur. Livré en deux passes (socle, puis UI), review agent passée sans bloquant.

**Livré** — `components/ui/confirm-dialog.tsx`, `lib/team-mutations.ts` (5 `useMutation` + le mapping d'erreurs par statut), `components/search/UserSearch.tsx` (ex-`components/home/SearchBar.tsx`), `components/teams/detail/` : `TeamManage` + `TeamIdentity` / `TeamAddMember` / `TeamDangerZone`, prop `actions` sur `TeamHero`, prop `onKick` sur `RosterChips`, et le scénario d'audit `teams-manage.mjs` (23 checks). **C'est ce ticket qui rend le module File upload démontrable** (voir `docs/modules.md`).

**Ce qui est structurant pour la suite :**

- **`ConfirmDialog` est bâti sur le `<dialog>` natif + `showModal()`**, et c'est un choix à reproduire : la plateforme fournit gratuitement et correctement le piège à focus, `Escape`, l'inertie de la page derrière et **la restauration du focus sur le déclencheur**. Le top-layer échappe en prime à la contrainte des 616 px, donc aucun portal n'est nécessaire. ⚠️ Le preflight Tailwind v4 écrase le `margin: auto` de l'UA sur `::backdrop` et sur tout élément — sans `m-auto` explicite, la modale se colle en haut à gauche.
- **`invalidateQueries` matche les clés PAR PRÉFIXE.** `['team', id]` balaie donc déjà `['team', id, 'matches']` : sans `exact: true`, toute distinction entre « rafraîchir le détail » et « rafraîchir l'historique » est un commentaire mensonger.
- **Après une dissolution, l'ordre est `navigate` PUIS `removeQueries`**, et la navigation doit porter **`replace: true`**. Trois pièges empilés, tous vérifiés : `invalidateQueries` sur l'équipe morte refetche → 404 → console rouge ; `removeQueries` seul ne suffit pas non plus, car un observateur encore monté reconstruit et refetche la requête ; et sans `replace: true`, le bouton **Précédent** du navigateur ramène sur l'URL détruite et produit le même 404 à un clic du parcours nominal.
- **Un `<button>` ne peut pas vivre dans un `<a>`.** Le bouton Kick de `RosterChips` est donc **frère** du `<Link>` dans le `<li>`, la surface de la puce ayant migré sur le `<li>` avec `focus-within`.
- **Ne pas se fier à `excludeIds` seul pour empêcher un doublon** : il ne se met à jour qu'après le refetch, donc une ligne de résultat reste cliquable pendant la mutation. Il faut une garde sur `isPending` **et** un `disabled` visible, sinon deux clics rapides envoient deux `POST` dont le second revient en 409.
- **`buttonClasses` porte `uppercase`** : toute donnée sensible à la casse rendue dans un `Button` (un pseudo, par exemple) doit annuler avec `normal-case`.
- **Écarts assumés vs la carte** : recherche **par préfixe** et non « pseudo exact » ; bouton **`Edit team` retiré** de l'en-tête.

**Dette laissée, assumée :**

- Après un kick, le focus retombe sur `<body>` : la puce qui portait le bouton disparaît avec le membre, le `<dialog>` n'a plus d'élément à qui rendre le focus.
- `<Label>Team logo</Label>` est un `<label>` sans cible (l'`<input type="file">` d'`ImagePicker` garde son `id` en interne). Le corriger demande soit de recopier les classes de `Label` (interdit), soit d'ajouter une prop `as` à un composant partagé.
- Deux trous de recette signalés par la review : la puce de roster **avec** son bouton Kick n'a jamais été mesurée à 375 px, et la bande **640-1023 px** (où la grille `sm:grid-cols-2` de `TeamIdentity` est la plus serrée) n'est couverte par aucun check.
- Le 409 « déjà membre » est **inatteignable par l'UI** (`excludeIds` retire le joueur des résultats) : le scénario le provoque par l'autre cause du même statut, « déjà dans une équipe de ce ladder ».

---

### FT-INV — invitations d'équipe (28/07/2026)

Commit `0108084`, merge `ab9a4c6`. **Mergé dos à dos avec [B-INV]** (commit `ad97df0`, merge `a724fe4`) et branché **sur B-INV**, pas sur `master` : B-INV **supprime** `POST /teams/{id}/members`, la route que le front de FT-2B appelait déjà depuis `master` — mergé seul, `master` n'aurait pas buildé.

Rejoindre une équipe n'est plus un **ajout forcé** : « Add a player » devient « Invite a player », les invitations en attente apparaissent en puces **« Pending »** dans le même `<ul>` que le roster (**annuler ≠ exclure**), le compteur devient **`Roster slots`** et inclut les invitations, et un bloc « Team invitations » (Accept / Decline) est posé sur `/teams`.

**Ce qui est structurant :**

- **Le mapping d'erreurs passe de la prose serveur aux `code` stables** (`TeamInvitationError`). L'ancien code affichait le message serveur *verbatim* faute de code : ce n'est plus une excuse (invariant #8).
- **Trois invalidations de cache volontairement DIFFÉRENTES** : inviter / annuler → `['team', id]` en `exact: true` **sans** les matchs (un invité n'est dans aucune compo) ; **accepter → par PRÉFIXE**, parce que `isMember` de `/teams/{id}/matches` bascule pour moi ; refuser → `['team-invitations','me']` seul.
- **Écart assumé vs la carte** : la réponse aux invitations vit sur **`/teams`** et non sur `/profile`, qui est un stub. Le composant est sans props et fait sa propre query, donc remontable tel quel plus tard.
- **Deux compteurs différents, assumés** : l'en-tête compte les **membres** (il est public — un visiteur ne peut pas compter ce qu'il n'a pas le droit de voir), l'onglet Manage compte le **plafond**. L'ambiguïté est levée par le mot « slots », pas par un chiffre faux.
- `components/ui/callout.tsx` extrait au second usage.

**Leçon de méthode** : la passe a duré 37 min, presque entièrement dans `npm run audit` — d'où la règle de filtrer pendant l'itération (`npm run audit <scénario>`) et de ne lancer la campagne complète **qu'à la fin**.

### FT-2C — ouvrir et annuler un créneau de match (28/07/2026)

Commit `1d74b90`, merge `f0e2369`. Le capitaine ouvre un créneau depuis un **panneau déroulé sous l'en-tête** de `/teams/$teamId` (deux menus : jour puis quart d'heure ; composition à cocher) et annule son slot ouvert depuis « Next match » ou depuis la ligne du tableau, derrière `ConfirmDialog`. C'est le dernier maillon qui rend le cycle challenge/accept atteignable à la souris.

**Livré** — `components/teams/detail/CreateMatchPanel.tsx`, `components/ui/select.tsx`, `components/ui/inline-button.tsx` (extrait au 4ᵉ usage de l'idiome, `RosterChips` refactoré pour le consommer), `components/ui/label-variants.ts`, `lib/create-match-schema.ts`, 5 dérivations pures dans `lib/team-detail.ts`, 2 hooks + 2 mappings d'erreurs dans `lib/team-mutations.ts`, scénario `teams-matchmaking.mjs` (15 checks). **`npm run audit` : 9 scénarios, 107 checks, exit 0.**

**Ce qui est structurant pour la suite :**

- **La règle du lockout est reproduite côté client, à l'identique.** Le back refuse un créneau `t` quand un match engageant `s` vérifie `|t − s| < lockoutMinutes` — **inégalité STRICTE** (`backend/src/routes/matches.ts:107-121`). Donc en 5v5 (lockout 60) : 21h grise 21h30, mais **20h et 22h restent sélectionnables**, deux fenêtres qui se touchent ne se chevauchent pas. Statuts engageants : `pending`, `in_progress`, `awaiting_confirmation`, `disputed`. Et un slot `pending` **périmé** (à moins de 15 min de son heure) **ne bloque plus** son créateur : le filtre client l'exclut aussi, sinon on grise des créneaux que le serveur accepterait.
- **`lockoutMinutes` est exposé par `GET /ladders`** (schéma `Ladder` d'`openapi.yaml`) — c'était le type **écrit à la main** de `lib/games.ts` qui l'omettait. Règle générale : avant de conclure qu'une donnée manque au front, vérifier si c'est la **route** qui ne la renvoie pas ou seulement notre type local qui l'ignore.
- **Deux 409 sans `code` stable.** `POST /matches` renvoie de la prose pour « chevauchement » comme pour « plafond de 5 slots », sans code — contrairement aux invitations de B-INV. L'invariant #8 interdisant de router un message sur la prose, ils sont départagés par un **compteur local** de slots ouverts (miroir de `countOpenSlots`). Les deux cas sont **pré-emptés** par l'UI (créneaux grisés, formulaire démonté à 5 slots), le 409 n'est plus que le filet d'une page périmée.
- **« Pas chargé » n'est pas « vide ».** `matches ?? []` éteignait les deux pré-emptions **en silence** et faisait affirmer la mauvaise cause au message d'erreur. L'inconnu reste `undefined`, se dit à l'écran, et la branche 409 nomme alors les deux causes possibles au lieu d'en choisir une.
- **Une région live doit exister AVANT son texte.** Un `role="status"` inséré dans le DOM avec son contenu n'est pas annoncé de façon fiable : la zone est montée en permanence en `sr-only`, seul son texte change, et le bandeau visible est un élément séparé.
- **`labelClasses()` existe maintenant** (`components/ui/label-variants.ts`, calqué sur `button-variants.ts` pour la même raison Fast Refresh). ⚠️ **Ça débloque la dette de FT-2B** sur `<Label>Team logo</Label>` : le troisième choix qui manquait — ni recopier les classes, ni ajouter une prop `as` — est disponible.

**Deux règles CSS globales, assumées** (`index.css`) :

- **`color-scheme: dark` sur `html`** — sans elle la liste déroulante native d'un `<select>` sort blanc sur blanc, donc illisible. Bénéfice collatéral : barres de défilement et autofill suivent enfin le thème.
- **`scrollbar-gutter: stable` sur `html`** — la colonne centrale est en `flex-1`, donc **fluide** : la barre de défilement apparaissait et disparaissait selon la hauteur de l'onglet affiché, et le rail se resserrait puis réélargissait à chaque changement d'onglet. ⚠️ **Conséquence chiffrée : la colonne centrale mesure désormais 601 px à 1280, plus 616** (check `B2` de `teams-manage`). À budgéter pour toute table large — **[FT-3]** en premier. Bénéfice collatéral : `showModal()` posait `overflow:hidden` sur le document et faisait sauter la page à chaque ouverture de modale, la gouttière réservée supprime aussi ce saut.

**Dette laissée, assumée :**

- Le focus retombe sur `<body>` après une annulation depuis le tableau — **même cause que le kick de FT-2B** : l'élément qui portait le bouton disparaît avec l'action, le `<dialog>` n'a plus à qui rendre le focus. Une carte pour les trois occurrences (kick, annulation d'invitation, annulation de slot).
- Panneau laissé ouvert **au passage de minuit** puis erreur « créneau passé » : le menu jour affiche une valeur absente de la liste régénérée, les heures sortent vides. Se règle en resélectionnant un jour.
- Le **409 « plafond »** est inatteignable par l'UI (à 5 slots le formulaire n'est plus monté) : le scénario teste l'état pré-empté, pas la branche de message. Idem pour 403, 429 et le 400 `unlinkedPlayers`, mappés mais jamais déclenchés.
- ✅ **Le scénario ne laisse plus de comptes en base** (`audit…@example.com`) — réglé le 28/07 par **[BX-DEL]**. La FK `match_participants.user_id` est passée de `restrict` à `cascade` (fin du **500**), et le runner suit maintenant l'ORDRE que la nouvelle garde impose : **annuler les matchs → dissoudre les équipes → supprimer le compte**, sans quoi il se prend un 409 `engaged_in_match` ou `team_engaged_in_match`. C'est le parcours de sortie des vrais utilisateurs, donc `deleteAuditUser()` en est aussi une couverture. Vérifié sur `teams-matchmaking` (5 slots + une équipe) : 0 compte résiduel.

### FT-3 — page complète d'un ladder (28/07/2026)

Commit `715aa9c`, merge `65de356`. Remplace le placeholder posé par FT-2A : le lien « See the full ladder » menait à une coquille vide. La page `/ladders/$ladderId` sert l'identité du ladder (artwork via `GameImage` réutilisé), les **règles en langage clair**, le **pool de maps** et le **classement complet** (joueurs **et** équipes, discriminés par `competitor.type`), lignes cliquables vers `/teams/$teamId` ou `/players/$pseudo`, la ligne de sa propre équipe surlignée et non-cliquable.

**Côté back** — `GET /ladders/{id}` rend désormais le **pool de maps du JEU**, lu dans la **même table que `POST /matches`** : servir la donnée plutôt que la recopier côté front est ce qui empêche la page d'annoncer des maps que le serveur n'attribuera jamais. Un jeu sans pool (lol, rl, chess) rend un tableau vide et la section est masquée — **la règle est portée par la DONNÉE, pas par une liste de jeux en dur** (seuls **cs2 (7)** et **valorant (6)** en ont). `openapi.yaml` mentait sur `lockoutMinutes` (« aussi le délai minimum avant soumission de score » : la seule garde est `scheduledAt`), corrigé et `api-types.gen.ts` régénéré — description seule, aucun type modifié.

**Les 5 règles sont affichées valeurs importées, jamais recopiées** : créneau sur un quart d'heure à 15 min minimum (pour ouvrir **et** pour accepter), Bo3, lockout lu du ladder, **litige ouvert AUTOMATIQUEMENT sur désaccord** — y compris même vainqueur avec un score différent (2-0 vs 2-1) — et slot non accepté annulé dès qu'il passe **sous 15 min de son propre coup d'envoi**.

**Trois écarts assumés, à ne pas « corriger » par erreur :**

1. ⚠️ **La carte Trello ment sur une règle** : elle annonce « slot sans adversaire annulé au bout de 24 h ». **FAUX** — `cancelExpiredSlots` (`jobs/index.ts`) l'annule dès qu'il passe sous `MIN_LEAD_MINUTES` de son propre coup d'envoi, l'instant où plus personne ne peut l'accepter. Les 24 h sont un **autre** mécanisme (match joué mais non rapporté). C'est la règle du **code** qui est affichée.
2. ⚠️ **`/ranking` SUPPRIMÉE** (page, route, `RankingTable`, entrée de nav) au lieu d'être migrée — décision de David. **DETTE OUVERTE** : plus aucun point d'entrée vers un classement pour un compte **sans équipe**.
3. ⚠️ **NI pagination NI conteneur défilant**, décision prise **avec la mesure** : à 200 compétiteurs la page fait **11 431 px (16 écrans)**, 2941 nœuds DOM, 1278 ms. Le coût DOM n'est pas le sujet — on accepte de descendre la page et on garde le **Ctrl+F sur tout le classement** (une pagination ferait atterrir un 137ᵉ sur une page 1 sans lui). Rationale figée dans le docblock de `LadderBoard.tsx`. **Ne pas re-ticketer avant qu'un ladder dépasse la centaine.**

🔑 **Défaut invisible trouvé au passage** : à 375 px le nom du compétiteur était rendu **0 px de large** (tracks fixes + gaps + padding = 268 px d'une boîte de 276, avatar `shrink-0`), **73 px sortaient en silence** car `LadderBoard` clippe. Le check de largeur ne pouvait pas le voir : il mesurait `documentElement`, il était **vert par construction**. Corrigé **le check d'abord** (`L9b` mesure la boîte ET la largeur rendue du nom), le défaut ensuite — sous `sm` les 3 nombres passent sous le nom via **`sm:contents`**, au-dessus la grille à 5 colonnes est restaurée à l'identique.

**Extractions (règle du second usage)** : `LadderRow` + `LadderBoard` sortent de `LadderExcerpt`, qui n'en garde que l'emballage « fenêtre ±2 places » ; helpers de classement dans `lib/ladders.ts` ; `ui/error-panel.tsx` extrait. ⚠️ **Le code venait d'un chat mobile, sans `coder-front` ni review** : le rapport `reviewer-front` a sorti **3 bloquants + 9 non-bloquants**, tous soldés avant merge.

### F-Nav — rail gauche conforme à la maquette (29/07/2026)

Commit `4a5c4bb`, merge `822a6eb`. **`LeftRail` absorbe `LeftNav`** : le rail existait **en double**. Un seul composant porte désormais le wordmark, la recherche, la navigation et le bloc compte.

**Livré une 1ʳᵉ fois sans suivre la maquette, puis RECODÉ.** `vsmode-home-demo.html` (`.left` / `.nav-item` / `.sep`) fait foi pour la **structure et les dimensions**, `index.css` pour couleurs / radius / ombres. Écarts corrigés : 288 → **264 px**, `p-6` → **18/16**, wordmark 48 px italique → **30 px droit**, icônes 20 → **16 px**, et la recherche sortie du `<nav>` (ce n'est pas un lien).

🔑 **La maquette contenait déjà la solution d'un défaut trouvé en review** : l'actif se distingue du survol par la **bordure** (`.nav-item.active` ajoute `border-color`, `:hover:not(.active)` n'y touche pas) — la 1ʳᵉ passe avait gardé le fond et jeté la bordure, rendant les deux états **identiques au pixel**.

- **6 items, tous câblés** : Home, My teams, Solo, Games, Matchmaking, History. **Aucun item grisé** : les 3 pages absentes sont créées **vierges** plutôt que désactivées. ⚠️ `MenuItem` garde `muted`/`disabled` **sans appelant** (l'état `.off` de la maquette, qu'un futur ticket redemandera) ; la prop `params` a été **supprimée** — morte **et** non sûre, le wrapper cassait l'appariement `to`/`params`.
- **`ranking` disparaît du rail** (absent de la maquette) : ça règle du même coup le fait que `to="/ranking"` **cassait `npm run build` de `master`** au merge, la route ayant été supprimée par FT-3 sur une branche partie avant.
- **`SiteLogo` remplace `Logo`** : un seul wordmark, et **plus de `<h1>` dans la nav** (chaque page garde le sien).
- **`UserSearch` devient `SearchBar`** : une seule implémentation du debounce, de l'abort et de la garde anti-réponse-hors-ordre, pilotée par props, réutilisée par le rail **et** `TeamInvitePlayer`. `GET /ladders` n'est émis qu'au **premier focus** du champ, la route étant anonyme donc comptée sur un quota d'**IP partagé par toute la plateforme**.
- ⚠️ **`AuthNav` n'est PAS un composant du rail** : `LandingNav` le monte aussi, sur la **landing publique**. Piège vécu — le `<ConfirmDialog>` de déconnexion était rendu **sans garde**, donc son `<h2>` « Log out » était le **premier titre du DOM** d'un visiteur anonyme, avant le `<h1>`. Il est désormais sous `{isLogged && …}`, et `LandingNav` est passé de `<nav>` à **`<aside>`** (il *contient* une navigation, il n'en est pas une). **Toute modif d'`AuthNav` doit être vérifiée sur `/` autant que sur `/home`.**
- ⚠️ **Lien d'évitement : jamais `sr-only` + `focus:not-sr-only`** — cette paire compile un `padding: 0` de spécificité (0,2,0) qui **bat** `px-4`/`py-2` en (0,1,0) : le lien se rendait en 149 × 22 px, **sous les 24 px** de WCAG 2.5.8. Motif retenu : **translation** (`-translate-y-24` / `focus:translate-y-0`).
- Token de premier plan dédié pour le badge PLAYER/TEAM : **2,53:1 → 4,75:1**.

🔑 **Le scénario `f-nav.mjs` (18 checks) MESURE les 13 dimensions de la maquette** (`N4d`) : l'échelle dynamique de Tailwind v4 accepte n'importe quel nombre, donc `w-66` mal tapé en `w-64` passe lint **et** build en silence. **Un critère visuel non mesuré n'est pas gardé.**

⚠️ **`L7` de `ladder-detail` est scopé à `<main>` depuis ce ticket** : il compte les mots `queue|matchmaking|auto-match` pour garder la décision produit challenge/accept, mais il balayait le **document entier** — et le rail persistant porte un item `Matchmaking` (le nom interne du cycle) sur **toutes** les pages authentifiées. Non scopé, il rendait rouge une page dont la copie est irréprochable. **Même piège pour tout check qui balaie la page : le rail est là aussi maintenant.**

### FT-4A — fiche de match en lecture (29/07/2026)

Commit `5729540`, merge `436531e`. Aucune migration. `/matches/$matchId` n'est plus un placeholder : fiche **en lecture seule** couvrant les **7 états du cycle**, les deux camps face à face (score Bo3, vainqueur, **Elo par CAMP jamais par joueur**), les maps pilotées par la donnée, les lineups avec capitaine, la variante **1v1**, et les écrans 403/404. L'historique d'équipe rend **toutes** ses lignes cliquables pour un membre (le lien passe sur la **date** quand il n'y a pas de nom d'adversaire).

**Livré** — `MatchStatusPill` + `match-status.ts` remontés dans `components/matches/` (2ᵉ consommateur), `GameBanner` extrait au 3ᵉ usage, `RosterChips` rendu générique, ton `danger` ajouté à `Callout`, `lib/match-detail.ts` (hook + dérivations pures).

- 🔑 **LE PIÈGE À NE JAMAIS RÉINTRODUIRE : « ce camp n'a pas d'équipe » ne signifie PAS 1v1.** `match_sides.team_id` est en `set null`, et une équipe dont tous les matchs sont terminés **peut** être dissoute : son camp survit avec `team: null` sur un 5v5 `completed`, lisible par n'importe quel compte depuis B15. Lire ça comme « solo » renommait le camp d'après son 1ᵉʳ joueur et **supprimait la lineup des 5 joueurs**. C'est le **format du ladder** qui tranche (`isSoloMatch`, enum fermé du contrat).
- ⚠️ **Un créneau ANNULÉ a la même forme qu'un créneau ouvert** (un seul camp) : la fiche doit lire le **statut**, jamais déduire « encore acceptable » de l'absence d'adversaire. Elle se titrait « open slot » et annonçait « any team can accept it » **sous une pastille CANCELLED**. Bloquant de review, corrigé, gardé par un check **vu ROUGE avant vert** — et c'est pour lui que le seed porte un **7ᵉ** match cs2.
- 🔑 **Deux checks ne gardaient rien**, trouvés en 2ᵉ review : l'un comptait 2 nœuds (`text=Cancelled` matchait la pastille **et** le mot dans la phrase) et serait resté vert en supprimant ce qu'il surveille ; l'autre lisait un attribut avec `getAttribute()`, qui **lève** quand rien ne matche → `exit 2` (harnais en échec) au lieu d'un rouge imputable au ticket. **Compter avant de lire.**
- ⚠️ **`backend/openapi.yaml` a été modifié par un ticket FRONT** : le payload de B16 ne déclarait aucun `required`, la codegen sortait donc tout en optionnel. Vérifié en review — les `required` décrivent exactement ce que le handler renvoie, aucun handler touché, codegen byte-identique.
- ⚠️ **Le seed sème 8 matchs de démo** (7 cs2 + 1 chess 1v1) et le créneau « accepté, avant l'heure » est à **+2 JOURS**. Il était à +1 h : l'état cessait d'exister une heure après le seed et la campagne partait en `exit 2` l'après-midi. **Ne pas raccourcir** — rien ne plafonne l'avance côté API.

### FT-4B — saisie du score, confirmation, litige (29/07/2026)

Commit `c2f9019`, merge `8a39a92`. Aucune migration. `/matches/$matchId` était en **lecture seule** depuis FT-4A : ce ticket ajoute la seule partie **écrivante** du cycle challenge/accept. Le camp habilité soumet son score, l'adversaire **confirme** (= renvoie le miroir exact de la soumission) ou **conteste**, ce qui met le match en litige. Avec lui, le cycle est bouclable **entièrement à la souris**, de l'ouverture du créneau à l'Elo appliqué.

**Livré** — `components/matches/MatchResultPanel.tsx`, `lib/match-mutations.ts` (hook + mapping d'erreurs), `lib/match-result-schema.ts` (Zod + les 2 dérivations pures `toResultBody` / `mirrorOfOpponentSubmission`), `components/ui/option-tile.tsx`, `canReportResult` + `ReportBlocker` dans `lib/match-detail.ts`, `RATE_LIMITED_MESSAGE` remonté dans `lib/api.ts`, scénario `tests/console-audit/scenarios/match-result.mjs` (17 checks) et `tests/console-audit/sql.mjs`. **`npm run audit` : 13 scénarios, 185 checks, exit 0** (campagne complète rejouée verte deux fois).

**Ce qui est structurant pour la suite :**

- **Le panneau ne rend RIEN à qui ne peut pas agir.** Visiteur, joueur du banc, match hors des statuts scorables, camp ayant déjà soumis, et **avant le coup d'envoi** : dans tous ces cas, aucun contrôle n'est monté. Ce n'est pas de la cosmétique — un bouton que l'API refuserait garantit une ligne rouge en console, qui est un **motif de rejet du projet**. La liste des refus est nommée (`ReportBlocker`) plutôt que déduite d'un `if` composite, pour que le prochain état s'ajoute sans relire toute la condition.
- **Les scores sont RELATIFS au soumetteur** (`scoreSelf` / `scoreOpponent`), jamais indexés sur `sideIndex`. C'est le contrat de `POST /matches/{id}/result` (B6) et c'est ce qui rend « confirmer » exprimable : confirmer, c'est renvoyer le **miroir exact** de la soumission adverse — `mirrorOfOpponentSubmission` croise les deux scores et garde le même `winnerSideId`.
- **`nowMs` vient de `matchQuery.dataUpdatedAt`.** Une horloge figée au mount gardait le formulaire caché tant que l'onglet restait ouvert, avec un rechargement pour seul remède. ⚠️ Elle avance sur un **refetch**, pas sur l'horloge murale : un onglet laissé au premier plan à travers le coup d'envoi n'ouvre pas le formulaire tout seul. Assumé — le parcours qui mène ici est « rapporter des parties jouées **ailleurs** », donc l'onglet est quitté puis repris (`refetchOnWindowFocus`), là où un polling couvrirait les heures ou les jours d'avance qu'un match peut avoir. Et un `nowMs` en retard ne peut que **cacher** le formulaire, jamais offrir un bouton que le serveur refuserait : l'erreur penche du bon côté par construction.
- **Aucun 400/409 de cette route ne porte de `code` stable** (contrairement aux invitations de B-INV) : le mapping d'erreurs route sur le **statut seul**, jamais sur la prose (invariant #8). Le message du 400 nomme les deux causes qu'un humain peut corriger (score illégal, match pas encore commencé) et tait la troisième (`winnerSideId` hors du match), qu'aucun utilisateur ne peut provoquer puisque le vainqueur se **choisit** parmi les deux camps.
- **`OptionTile` (`components/ui/option-tile.tsx`) est l'extraction du 2ᵉ usage** de la tuile à cocher de `CreateMatchPanel` (FT-2C) — mêmes classes, un seul propriétaire, conformément à la stratégie de composants du 27/07.

**Le harnais d'audit sait maintenant faire un appel système :**

`tests/console-audit/sql.mjs` exécute du SQL via `docker compose exec postgres psql` (`spawnSync` **sans shell**, uuid passés par `assertUuid`). C'était la capacité manquante : **reculer `scheduled_at` est la seule opération de la fixture que l'API ne sait pas faire**, et sans elle aucun match ne peut atteindre un état scorable dans un test. Le scénario tourne sur un ladder **1v1** — 2 comptes jetables au lieu de 10 pour deux lineups 5v5. Le teardown force le match hors des statuts engageants (`status='cancelled'`, `winner_side_id = null`) **avant** de le supprimer, sinon la garde de [BX-DEL] refuse la suppression des comptes ; `R15` compte les lignes résiduelles, cascades comprises.

**Deux leçons de la review, gardées par des checks :**

- ⚠️ **`R11b` garde un ORDONNANCEMENT, et c'est pourquoi il est distinct de `R9`.** `ConfirmDialog` ne retombe sur `returnFocusRef` **que si son ouvrant a quitté le DOM** (`opener.isConnected`, cf. `components/ui/confirm-dialog.tsx`). Sur le chemin « Confirmer », la restitution du focus par la plateforme à la fermeture du `<dialog>` court donc contre le démontage du bouton par le refetch. Mesuré vert 4 fois de suite — jamais déduit de `R9`, qui couvre l'autre chemin (aucune boîte ouverte). ⚠️ Au passage : **un `.focus()` appelé pendant qu'un `<dialog>` modal est ouvert est un NO-OP** (la page est inerte, un élément inerte ne prend pas le focus) — le commentaire qui affirmait le contraire était faux.
- ⚠️ **Un plafond d'attente relevé sans mesure est un cache-misère.** `awaitFocusRestored` est passé de 5 s à 15 s pendant ce ticket (instabilité d'`I6-bis` en campagne), mais à 15 s « le focus arrive en 200 ms » et « en 9 s » sont le **même vert**. Le helper trace désormais le délai réel au-delà de 1 s, **sans faire rougir** (un seuil de latence figé en dur rendrait la campagne dépendante de la charge de la machine, soit exactement le non-déterminisme qu'on venait de chasser). Constat des deux campagnes complètes : **aucune ligne « ⏱ »** — le plafond n'est jamais approché.

**Dette laissée, assumée :**

- Le libellé de repli **« Disbanded team »** reste **non couvert** par une donnée ni par un check (hérité de FT-4A) : il faut une équipe dissoute **après** un match terminé pour l'obtenir. À porter au futur ticket « seed propre » plutôt qu'à re-ticketer seul.
- Le **403** et le **429** du mapping d'erreurs sont écrits mais **jamais déclenchés** par le scénario : ils ne sont atteignables que depuis une page périmée (l'équipe a changé de capitaine pendant que l'onglet dormait) ou sous un martèlement. Même situation que les 409 de FT-2C.
- `useCreateMatch` / `useCancelMatch` (FT-2C) vivent toujours dans `lib/team-mutations.ts`, dont le commentaire demande leur déplacement vers `lib/match-mutations.ts` au second consommateur. **Non fait ici** : ce ticket ajoute une route que ce fichier n'avait pas, déplacer quatre exports toucherait la page équipe et ses trois scénarios d'audit sans gain fonctionnel. Un travail d'une ligne pour qui en aura besoin depuis un écran de match.
