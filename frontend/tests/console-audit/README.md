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

### 🚨 Ne rien écrire sous `frontend/` pendant une campagne

Vite surveille toute l'arborescence : **enregistrer un fichier — même un `.md`, même hors du
graphe de modules — déclenche un rechargement complet de la page**. La SPA rebootstrape
(`/auth/refresh`, `/users/me`, puis toutes les queries de la page) et **retombe sur l'onglet
par défaut**.

Vécu le 28/07 : un README enregistré 55 s avant la fin d'une campagne a donné à `teams-manage`
un `B14b` rouge (« 6 requêtes là où 0 sont attendues ») **puis** un `locator.focus` expiré à
30 s — le bouton « Kick » n'existe que dans l'onglet Manage, disparu au rechargement. Sortie
en **exit 2**. Le même scénario lancé seul : **35/35 en 23,7 s**.

⚠️ Le rapport accuse le **ticket**, jamais l'éditeur : le diagnostic coûte cher. Écrire la doc
**après** le run, ou itérer sur un scénario filtré.

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

### Lire une région live : `awaitAnnouncement(texte)`, jamais `waitFor()` nu

Depuis [FX-FOCUS] il y a **une seule** région live `role="status"` par écran, et elle est
**montée en permanence** (une région insérée en même temps que son texte n'est pas annoncée
de façon fiable). Conséquence :

```js
await page.locator('[role=status]').first().waitFor();   // ❌ rend la main IMMÉDIATEMENT
const texte = await page.locator('[role=status]').first().innerText();
```

…lit soit du **vide**, soit **l'annonce précédente**. Le helper attend le contenu :

```js
await awaitAnnouncement('was created');       // reçu en argument de run({ … })
```

⚠️ **`focusLanding()` est un instantané synchrone** : il ne contient aucune attente, ni pour
le focus ni pour l'annonce. Appeler `awaitAnnouncement()` **avant** lui — attendre un texte
ne déplace pas le focus, donc ne fausse pas la mesure.

Ce piège a produit **2 faux rouges** (`ft1c` 4.1b, `teams-manage` B13c-bis) alors même que la
règle était déjà écrite en prose : c'est pour ça qu'elle est maintenant **outillée**.

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

Au 28/07/2026 il ne reste **qu'une** entrée : le bandeau React DevTools + le serveur de dev
(absents du build de prod). Le **401 sur `POST /auth/refresh`** à chaque chargement anonyme
a été **payé par [B13]** — la route rend désormais 204 quand il n'y a pas de cookie, et
l'exemption a été retirée. Ne pas la remettre : c'est le retrait de cette ligne qui fait
tomber les trois scénarios anonymes si quelqu'un ramène le 401.

## Les quotas partagés par TOUTE la campagne (FT-3)

Deux compteurs du backend sont indexés sur l'**IP**, donc partagés par tous les scénarios :

- **100 req/min, quota global.** Les routes de référence (`/games`, `/ladders`,
  `/ladders/{id}`, `/ladders/{id}/rankings`, `/auth/refresh`) sont **publiques** :
  `request.user` y est vide, donc `rateLimitKey` retombe sur l'IP **même quand un Bearer est
  envoyé**. Chaque `page.goto` rejoue `restoreSession()`, chaque page de teams charge
  `/games` + `/ladders`… Mesuré : à partir du 4ᵉ scénario la campagne dépassait 100 req/min,
  et le 429 qui suit est **indiscernable d'un vrai défaut** dans le rapport (session non
  restaurée → redirection vers la landing → `/games` 429 → 3 réessais de TanStack Query =
  27 entrées imputées à un ticket innocent, choisi par l'ordre alphabétique des fichiers).
  → `run.mjs` appelle `awaitGlobalQuota()` **avant chaque scénario** : un `GET /api/ping`
  (qui porte les en-têtes `x-ratelimit-*` du même compteur) et, si besoin, une attente.
- **3 inscriptions/min.** `awaitRegisterSlot()` modélisait une fenêtre glissante de 61 s là
  où le serveur en tient une **fixe** ; le décalage envoyait de temps en temps une 4ᵉ
  inscription, dont le 429 s'affichait dans le formulaire de `auth-register`. Le modèle
  prend désormais **75 s** de marge.

⚠️ Règle générale : **le harnais ne doit jamais fabriquer le rouge qu'il prétend mesurer.**

### `RATE_LIMIT_FACTOR` — pourquoi ces attentes ont (presque) disparu

Ces deux mécanismes **attendent** au lieu d'encaisser un 429, et c'était le poste de temps
dominant d'un ticket front : ~10 min de sommeil par campagne, plus ~60 s à chaque relance
filtrée (le quota global vient d'être brûlé par la relance précédente).

Le backend multiplie désormais **tous** ses quotas par `RATE_LIMIT_FACTOR` (`.env`, défaut 1,
mis à **1000** en dev). Les deux garde-fous restent en place et **s'alignent tout seuls** :
`awaitRegisterSlot` lit `x-ratelimit-limit` sur la réponse de `register` au lieu de supposer
3/min, et `awaitGlobalQuota` lisait déjà les en-têtes. Rien à configurer côté harnais — le
serveur est seule source de vérité. ⚠️ `RATE_LIMIT_FACTOR` **doit revenir à 1** avant la
livraison ; le backend écrit un WARN à chaque démarrage tant que ce n'est pas le cas.

⚠️ **Conséquence sur le diagnostic, et elle a mordu** : un scénario rouge en campagne mais
vert seul n'est **plus** un quota — c'est presque toujours une **course du harnais** qui se
gagnait grâce aux pauses supprimées. Chercher un `waitFor` qui n'attend rien (voir la section
sur les régions live) **avant** d'accuser le code applicatif.

## `ladder-detail` (FT-3) — et ce qu'il ne peut pas couvrir

`scenarios/ladder-detail.mjs` audite `/ladders/$ladderId` : id malformé (écran d'erreur,
**zéro requête**), uuid inconnu (404 déclaré par `expectHttp`), arrivée **par le lien
« See the full ladder »** d'une page équipe sans rejouer `GET /ladders/{id}/rankings` (même
entrée de cache), titre comparé au JSON de l'API, classement vide, pool de maps comparé
map par map à l'API, section maps **absente** sur un jeu sans pool (chess, lol, rl), absence
de toute formulation de file d'attente, et 375 px sans débordement. **10 checks.**

⚠️ Les **lignes** du classement ne sont jamais montées : une ligne de rating naît d'un match
**terminé** (deux équipes, une acceptation, deux scores concordants, `scheduledAt` passé), ce
qu'un scénario ne sait pas fabriquer. La base de dev en est donc dépourvue et c'est l'état
**vide** qui est couvert. Le rendu des lignes (liens, `aria-label`, 375 px, focus clavier) a
été vérifié par une sonde jetable sur une base semée en SQL, puis nettoyée — refaire ce
détour si `LadderRow` change.

## `match-detail` (FT-4A) — le seul scénario qui EXIGE la base semée

`scenarios/match-detail.mjs` audite `/matches/$matchId` : id malformé (écran d'erreur, **zéro
requête**), uuid inconnu (404 déclaré par `expectHttp`), un **visiteur** sur un match terminé
(titre, vainqueur marqué une seule fois, score comparé au JSON de l'API, maps comparées map
par map, lineups avec capitaine repéré, **Elo par CAMP** — 2 valeurs pour 10 joueurs alignés),
le **match 1v1** (aucun bloc équipe, aucune section maps), un **non-participant** sur un match
non terminé (403 déclaré par `expectHttp`), un **membre** sur un match à venir puis sur un
match en attente de confirmation (**0 bouton, 0 formulaire, 0 champ** — la saisie du score est
[FT-4B]), le litige, le créneau ouvert, le **créneau annulé**, l'historique d'équipe dont
**toutes** les lignes sont cliquables pour un membre, et 375 px sans débordement. **21 checks.**

🔑 **`M12d` garde un défaut réel**, trouvé en review et vu ROUGE avant d'être vert : un créneau
annulé a exactement la MÊME FORME qu'un créneau ouvert (un seul side), et la fiche déduisait
« encore acceptable » de l'absence d'adversaire au lieu de lire le **statut**. Elle se titrait
donc « open slot » et annonçait « any team can accept it » sous une pastille `CANCELLED`, pour
une action que l'API refuse. C'est pour ce check que le seed porte un **7ᵉ** match de démo :
sans donnée dans cet état, rien ne le prouvait.

⚠️ **Il exige `docker compose exec backend npm run seed:dev`.** Les états du cycle ne sont
pas fabricables par un scénario (deux équipes, une acceptation, deux soumissions concordantes,
un `scheduledAt` passé), et le match 1v1 encore moins — `/solo` est une page vierge. Sans seed,
le scénario sort en **exit 2** (erreur de harnais) plutôt qu'en checks verts par accident. Il se
connecte en `alice@dev.local` / `Test1234!` : c'est le seul moyen d'atteindre un match NON
terminé, un tiers y prenant 403 — ce que la phase 5 vérifie justement.

⚠️ **Le créneau « accepté, avant l'heure » est à +2 JOURS du seed, et doit le rester.** Il a été
posé à +1 h : passé cette heure, l'état n'existait plus, le scénario ne trouvait pas sa donnée et
sortait en **exit 2** — une base semée le matin faisait échouer la campagne l'après-midi. Rien ne
plafonne l'avance côté API (seul un minimum de 15 min est imposé), donc un état de démo doit
survivre à la journée qui l'utilise. **Ne pas « rétablir » une valeur courte.**

⚠️ **`:has()` remonte.** `section:has(h2:text-is("Maps"))` matche AUSSI la `<section>` de la
page entière, qui contient ce titre : le check des maps ramassait alors les 10 chips de lineup
en plus des 3 maps (**mesuré : 13 au lieu de 3**). Il faut le chemin DIRECT
(`section:has(> div > h2:…)`) — le `<h2>` d'un `SectionTitle` est enveloppé dans sa ligne de
titre, il n'est donc jamais frère de la liste qui le suit.

## Un scénario qui laissait des comptes derrière lui — réglé par [BX-DEL]

`teams-matchmaking` (FT-2C) est le seul scénario qui **crée de vrais matchs**. Le runner ne
parvenait pas à supprimer ses deux comptes alignés : `match_participants.user_id` était en
`onDelete: 'restrict'`, donc `DELETE /users/me` rendait un 500 pour tout compte ayant été
aligné une fois. **Corrigé le 28/07 par [BX-DEL]** (migration `0023`, la FK passe en
`cascade`) : le nettoyage repasse par la route.

⚠️ **L'ORDRE du nettoyage est devenu contraignant**, et `deleteAuditUser()` le suit
désormais : une équipe engagée dans un match non terminé ne se dissout pas
(409 `team_engaged_in_match`), et un compte aligné dans un tel match ne se supprime pas
(409 `engaged_in_match`). Le runner annule donc **les matchs, puis les équipes, puis le
compte** — exactement le parcours de sortie imposé aux vrais utilisateurs. Vérifié : un run
de `teams-matchmaking`, qui ouvre 5 slots et crée une équipe, ne laisse plus **aucun** compte.
Si un jour le rapport en nomme à nouveau, c'est que le parcours de sortie s'est cassé quelque
part — le message est un signal, pas une corvée.
