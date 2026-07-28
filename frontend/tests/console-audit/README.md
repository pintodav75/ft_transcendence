# Audit console — un scénario par ticket front

Le sujet fait de **« zéro warning ET zéro erreur dans la console Chrome »** un motif de
**rejet du projet**, au même titre qu'une ToS vide. Ce harnais transforme ce critère en
commande : il pilote un vrai Chromium, déroule le parcours du ticket, et **échoue si la
console dit quoi que ce soit** d'imputable à ce ticket.

## Lancer

```bash
docker compose up -d                     # la stack doit tourner
cd frontend/tests/console-audit
npm install                              # une seule fois (playwright-core, ~3 Mo)
npm run audit                            # tous les scénarios
npm run audit ft1c                       # un seul (filtre sur le nom de fichier)
```

Codes de sortie : **0** console propre et tous les checks verts · **1** au moins un
problème imputable au périmètre · **2** le harnais lui-même a échoué (stack éteinte,
sélecteur obsolète). ⚠️ Un **2** ne veut **pas** dire « console propre ».

### Le navigateur

`playwright-core` ne télécharge aucun navigateur : le runner cherche, dans l'ordre,
`$AUDIT_CHROMIUM`, puis `~/.cache/ms-playwright/chromium-*`, puis un Chrome/Chromium
système. Si rien n'est trouvé :

```bash
npx playwright install chromium
```

## Pourquoi trois sources d'écoute

Le panneau Console de DevTools agrège **trois** flux, et un audit qui n'en écoute qu'un
donne un faux vert :

| Flux | Capté par | Ce qu'il apporte |
| --- | --- | --- |
| `Runtime.consoleAPICalled` | `page.on('console')` | les `console.*` du code |
| `Runtime.exceptionThrown` | `page.on('pageerror')` | les exceptions non attrapées |
| `Log.entryAdded` (CDP) | session CDP explicite | **les messages du navigateur** : « Failed to load resource: 404 », CORS, contenu mixte, dépréciations |

La troisième n'a **aucun équivalent** dans l'API haut niveau de Playwright. C'est
pourtant elle qui produit les lignes rouges de 404 d'images — donc précisément ce
qu'un correcteur voit en premier sur une page de teams.

## Écrire le scénario de son ticket

Un fichier dans `scenarios/`, exportant `name`, `surface` et `run()` :

```js
export const name = 'ft2-team-detail';
export const surface = '/teams/:id + édition du logo';

export async function run({ page, setPhase, step, countRequests, fixtures, user, ORIGIN }) {
  setPhase('1. chargement');            // étiquette les entrées console captées ensuite
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });

  const n = await page.locator('…').count();
  step('1.1', n === 1, `détail : ${n} (1 attendu)`);   // un check nommé = une ligne du rapport
}
```

Ce que le runner fournit :

| Outil | Rôle |
| --- | --- |
| `setPhase(label)` | étiquette les entrées console suivantes → le rapport dit **où** ça a parlé |
| `step(id, ok, detail)` | un check nommé, repris dans le décompte final |
| `countRequests(fn, filter?)` | prouve qu'une action n'a déclenché **aucun** aller-retour réseau |
| `fixtures.ok / .big / .bad` | PNG valide · PNG > 2 Mo · GIF (type refusé), **générés à l'exécution** |
| `user` | compte neuf du run (`pseudo`, `email`, `password`, `accessToken`, `stamp`) |
| `expectHttp(motif, raison)` | déclare qu'un échec réseau est **l'objet du test** (id inexistant → écran 404) |

### Tester un état d'erreur : `expectHttp`

Chrome logge « Failed to load resource: … 404 » pour **tout** fetch non-2xx, et le runner
enregistre en plus la réponse ≥ 400. Un scénario qui vérifie l'écran 404 d'une équipe
inconnue ne pourrait donc **jamais** sortir 0. `expectHttp(/motif/, 'raison')`, appelé
**avant** l'action, range ces entrées dans une section à part du rapport (« erreurs réseau
PROVOQUÉES par le scénario ») au lieu de les imputer au ticket.

Trois garde-fous, parce que c'est le **seul** mécanisme capable de faire taire le filet :

1. **Seuls les flux réseau sont exemptables.** Une exception non attrapée ou un `console.*`
   écrit par notre code reste imputé au ticket **même s'il cite l'URL visée** — sans ça, un
   « Uncaught Error: failed to load /api/teams/&lt;uuid&gt; » sortirait vert. Exception à
   l'exception : Chrome remonte le même échec de ressource sur DEUX flux (`Log.entryAdded`
   **et** l'API console), donc le flux console est accepté sur la seule signature
   `Failed to load resource` du navigateur.
2. **L'exemption ne vaut que dans la phase où elle est déclarée** — appeler `expectHttp`
   **après** le `setPhase` concerné, et avant l'action. Sinon elle courrait jusqu'à la fin du
   run et couvrirait en silence des surfaces suivantes (le même uuid réutilisé plus loin comme
   `matchId`, par exemple).
3. **Le motif doit viser l'URL précise testée** (l'uuid bidon) plutôt qu'une route entière.
   Quand la route seule ne discrimine pas (un 401 sur `/auth/login`, un 409 sur `/teams`),
   c'est le cloisonnement par phase du point 2 qui fait le travail.

Un motif déclaré mais **jamais déclenché** est signalé en fin de rapport : une faute de frappe
ou une phase qui a bougé échoue du bon côté (rouge), mais ne doit pas le faire en silence.

Ces entrées restent **comptées et affichées** (`6× raison`) : un motif trop large se voit au
compteur. La dette héritée d'`OUT_OF_SCOPE`, elle, continue d'être comptée séparément.

Le runner se charge seul du reste : compte de test créé par l'API, connexion via l'UI
(étiquetée hors périmètre), suppression du compte via `DELETE /users/me` à la fin,
fixtures supprimées.

### ⚠️ Les numéros de ligne du rapport ne sont pas ceux de la source

Une entrée émise par le navigateur (`Log.entryAdded`) porte la position dans le fichier
**transformé servi par Vite**, pas dans le `.tsx` d'origine — et l'index est à 0. Exemple
constaté : le `console.log` de `pages/teams/team-detail.tsx` est signalé `:39` alors qu'il
est **ligne 51** dans la source.

Conséquence : **ne jamais recopier un `fichier:ligne` du rapport dans un compte rendu**.
Le fichier est fiable, la ligne non — la retrouver au `grep` avant de la citer.

### Deux pièges à connaître avant d'écrire un scénario

1. **`page.goto` recharge toute la SPA.** Le bandeau du serveur de dev est alors
   recompté à chaque tour : tu mesurerais Vite, pas l'application. Pour tester un cycle
   de montage/démontage, utilise une interaction **client** (ouvrir/fermer un
   formulaire, cliquer un lien du routeur).
2. **Les fixtures ne sont pas versionnées.** `big.png` fait 5,6 Mo de bruit aléatoire —
   il est régénéré à chaque run parce qu'une image unie se compresserait à quelques Ko
   et ne testerait plus la limite de 2 Mo.

## La dette connue

`OUT_OF_SCOPE` dans `runner.mjs` liste le bruit que l'audit **constate sans l'imputer**
au ticket en cours. Chaque entrée porte sa raison et son ticket d'origine, et reste
**affichée** dans le rapport — c'est ce qui l'empêche de pourrir en silence. Quand la
dette est payée, on retire la ligne.

Au 27/07/2026 : le bandeau React DevTools + le serveur de dev (absents du build de
prod), et le **401 sur `POST /auth/refresh`** à chaque chargement anonyme (F0 / FR2).

## Un scénario qui laisse des comptes derrière lui

`teams-matchmaking` (FT-2C) est le seul scénario qui **crée de vrais matchs**. Le runner ne
parvient donc pas à supprimer ses deux comptes alignés : `match_participants.user_id` est en
`onDelete: 'restrict'` (`backend/src/db/schema.ts`), et `DELETE /users/me` échoue pour tout
compte ayant été aligné une fois. Ce n'est **pas** un défaut du scénario, c'est une
limitation back à ticketer (en l'état, un joueur ne peut plus jamais supprimer son compte).
En attendant, le rapport nomme les comptes restants et le nettoyage se fait à la main en SQL.
