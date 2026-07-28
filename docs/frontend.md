# Frontend — détail par ticket

> Extrait de CLAUDE.md (refacto 25/07). F0/F0-A/B/C/D, FR1, FR2, F-Nav, FL + règles front et dette connue.

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
- **F0-C — zone authentifiée centralisée** : `routes/_authenticated.tsx` est une route layout *pathless*. Son unique `beforeLoad` attend `restoreSession()` si `!ready`, relit ensuite le store Zustand et redirige un visiteur vers `/`. Ses enfants protégés sont `/home`, `/games`, `/profile`, `/ranking`, `/teams` et `/teams/$teamId` ; ajouter une future page privée sous ce parent évite de recopier la garde.
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

**FL — Landing publique (MERGÉE sur `master`, merge `85e1c76`) : vitrine `/` avant connexion** :

- **Objectif carte Trello [FL]** : vitrine publique `/` (cartes de jeux alimentées par le back, CTA login/register, footer PP/ToS). **DoD faite** : `/` public pour les visiteurs déconnectés, cartes `GET /games`, CTA login/register, footer PP/ToS, composants icônes/logos. F0-C complète la garde : un utilisateur déjà connecté qui demande `/` est redirigé vers `/home`.
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

### FT-2A — page détail d'une équipe, consultation (27/07/2026)

`/teams/$teamId` réécrite **de zéro** (le brouillon d'un coéquipier a été jeté, pas nettoyé). Lecture seule : la gestion capitaine est dans **[FT-2B]** (https://trello.com/c/tmgQGBVz), les actions de match dans **[FT-2C]** (https://trello.com/c/LnSfRghd), la page ladder dans **[FT-3]** (https://trello.com/c/6yZLPjpP).

**Livré** — `lib/team-detail.ts` (3 hooks TanStack Query + dérivations pures + formateurs), `pages/teams/team-detail.tsx` (orchestration, rôle, états d'erreur), 8 composants dans `components/teams/detail/`, 3 pages placeholder (`players/`, `matches/`, `ladders/`) avec leurs routes, et le scénario d'audit console réécrit (13 checks).

**Ce qui est structurant pour la suite :**

- **Contrainte de largeur mesurée** : la colonne centrale du shell ne fait que **616 px** à un viewport de 1280 (les deux rails en prennent ~660). Une table qui réclame plus **fait sortir sa dernière colonne du champ** sans rien signaler — c'est arrivé sur la colonne Status de l'historique (810 px réclamés). Vérifier `scrollWidth` vs `clientWidth` du conteneur, **pas à l'œil**.
- **Piège CSS** : déclarer un **seul** axe d'`overflow` force l'autre à `auto` (jamais `visible`). La barre d'onglets portait `overflow-x-auto` « au cas où » ; le `-mb-px` volontaire des onglets suffisait à produire 1 px de débordement vertical, donc une barre de défilement parasite. Ne mettre un `overflow-*` qu'après avoir mesuré un débordement réel.
- **Stratégie d'extraction des composants** (décidée le 27/07) : un composant **sans aucune connaissance du domaine** part tout de suite dans `components/ui/` — c'est le cas de `pill.tsx`, `section-title.tsx`, `tabs.tsx` + `tab-ids.ts`, extraits par ce ticket. Tout le reste suit la **règle de deux** : extraction au **second usage réel**, par le ticket du second consommateur. Restent donc en place, avec leur extraction déléguée : `match-status.ts` / `MatchStatusPill` / `MatchRow` (→ ticket page match, vers `components/matches/`), le `LadderRow` interne à `LadderExcerpt` (→ FT-3, vers `components/ladders/`, et il doit aussi remplacer `components/home/RankingTable.tsx` qui fait la même chose en `useState`/`useEffect`), `RosterChips` (→ FT-2B lui ajoute une prop pour le kick, sans le dupliquer).
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
- ⚠️ **Le scénario laisse 2 comptes en base à chaque run** (`audit…@example.com`) : `DELETE /users/me` répond **500** dès qu'un joueur a été aligné dans un match, `match_participants.user_id` étant en `onDelete: 'restrict'` **sans condition de statut**. Bug back à part entière — un joueur ayant joué une fois ne peut plus jamais supprimer son compte.
