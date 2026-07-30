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
| `sql(requête)` | une requête SQL dans le conteneur postgres — **forcer un état que l'API interdit**, jamais constater un comportement (voir plus bas) |

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

## `sql.mjs` — la seule sortie du navigateur, et sa règle d'usage

`sql(requête)` exécute `docker compose exec -T postgres psql … -tAq -c <requête>` depuis la
racine du repo. C'est le **seul** endroit du harnais front qui ne passe ni par HTTP ni par
Playwright, d'où un module à part plutôt que quelques lignes noyées dans `runner.mjs`. Les
identifiants sont lus dans le `.env` de la racine (`POSTGRES_USER`, `POSTGRES_DB`) — jamais en
dur, ils diffèrent sur chaque machine.

🚨 **La règle, et c'est elle le vrai garde-fou** : le SQL sert à **FORCER un état que l'API
interdit d'atteindre**. Il ne sert **jamais** à constater un comportement applicatif — un check
qui lit la base au lieu de lire l'écran ne garde pas l'écran, il garde la base, et il resterait
vert le jour où la page cesserait d'afficher ce qu'elle affiche.

Deux pièges, tous deux déjà payés côté Python (`backend/tests/helpers.py`, dont ce module est
la transposition) :

- ⚠️ **`-tAq` n'est pas cosmétique.** Sans `-q`, psql fait suivre le **tag de commande** sur les
  requêtes mutantes : un `UPDATE` rend « UPDATE 3 », un `INSERT … RETURNING id` rend
  « <uuid>\nINSERT 0 1 ». `-t -A` seuls ne suppriment ce tag que pour les SELECT.
- ⚠️ **Une erreur SQL doit planter fort.** Un `ROLLBACK` sur violation de contrainte ne produit
  aucune exception : psql sort en code non nul, que personne ne regarde. Côté Python, avaler ce
  cas a laissé **270 users et 325 matchs** de test s'accumuler pendant trois jours. `sql()`
  inspecte donc `status` et **lève** → le scénario s'interrompt et le rapport sort en **code 2**
  (« le harnais a échoué »), pas en check rouge imputable au ticket.

## `match-result` (FT-4B) — fabriquer un match prêt à être scoré

`scenarios/match-result.mjs` construit, **par l'API**, le seul état que l'API ne sait pas
produire : deux joueurs jetables, comptes `chess_com` liés, un créneau **chess 1v1** créé puis
accepté (`in_progress`) — puis `scheduled_at` reculé **en SQL**. `POST /matches` et
`/accept` exigent un coup d'envoi **dans le futur** (≥ 15 min) tandis que `POST
/matches/:id/result` exige `now() >= scheduled_at` (§5.3) : aucune séquence HTTP ne satisfait
les deux. C'est exactement la recette de `backend/tests/test_matches_result.py`.

**Du 1v1, pas du 5v5** : deux comptes avec un compte externe chacun, contre dix plus dix pour
aligner deux lineups. Le joueur *est* le camp, il n'y a pas de lineup.

**Il ne dépend pas du seed** (contrairement à `match-detail`) : il fabrique sa donnée, donc il
reste rejouable sur une base vierge et deux runs ne se marchent pas dessus. Seul le ladder
chess 1v1 est attendu — il vient des migrations, pas du seed.

⚠️ **Le teardown est la moitié du scénario.** `DELETE /users/me` refuse en 409
`engaged_in_match` tout compte aligné dans un match `pending`/`in_progress`/
`awaiting_confirmation`/`disputed`, et `purgeUserMatches()` du runner ne sait qu'annuler un
slot **encore pending**. Le scénario force donc le match hors des statuts engageants
(`status='cancelled'`) **en toute fin et même si un check a échoué**, puis efface la ligne
(`DELETE /matches/:id` ne fait, lui, que passer le statut à `cancelled` : sans cette seconde
requête, chaque run laisserait une coquille de match de plus). Mesuré teardown neutralisé :
**2 comptes + 1 match** laissés en base et « compte(s) NON supprimé(s) » au rapport.

**17 checks** (`R0` → `R15`, plus `R11b`), qui déroulent le cycle d'écriture en entier :
liaisons des comptes externes, `in_progress` lu par l'API, **aucun contrôle offert avant le
coup d'envoi**, coup d'envoi effectivement reculé, fiche ouverte avec sa pastille, avis
« Kick-off was… » (la preuve **à l'écran** que le backdate a produit l'état visé), formulaire
offert au camp habilité, première soumission + focus rendu, choix « Confirmer / Contester »
côté adverse, confirmation → `completed` avec l'Elo appliqué **par camp** + focus rendu une
seconde fois (`R11b`, chemin `ConfirmDialog`), désaccord → `disputed`, base rendue propre.

⚠️ **`R9` et `R11b` gardent deux ordonnancements DIFFÉRENTS** du même invariant FX-FOCUS, et
l'un ne se déduit pas de l'autre : `R9` couvre la soumission directe (le bouton disparaît sans
qu'aucune boîte ne soit ouverte), `R11b` le chemin où la restitution de la plateforme à la
fermeture du `<dialog>` court contre le démontage de l'ouvrant par le refetch.

## `solo` (F-SOLO) — le check central est un NÉGATIF, doublé de son positif

`scenarios/solo.mjs` audite `/solo` et `/solo/$ladderId` : la liste des ladders 1v1 pour un
compte **neuf** (2 tuiles, « Not ranked yet », page actionnable — l'asymétrie du ticket : on
n'*adhère* pas à un ladder solo, une ligne de `rankings` naît du premier résultat), `ladderId`
malformé (écran d'erreur, **zéro requête**), uuid inconnu (404 déclaré par `expectHttp`),
**ladder d'un autre format** ouvert en `/solo` (écran dédié), le dossier chess 1v1 (en-tête au
pseudo, **2 onglets et pas de Manage**, **une seule** région live), le cycle complet à la
souris (ouvrir un créneau → l'annuler → focus rendu), et 375 px. **18 checks.**

🔑 **`S8` est le check qui garde le motif de rejet** : sans compte externe lié, `validateSide()`
refuse le camp en **400** (§5.1), donc « Open a slot » ne doit pas exister. Un négatif seul
serait vert le jour où le bouton cesserait d'être rendu pour tout le monde (sélecteur périmé,
en-tête cassé) — d'où **`S9`**, qui lie le compte Epic par API, recharge, et exige le bouton.
On ne casse pas le code pour voir rouge : **on retourne la donnée**. Le run délie ensuite.

🔑 **`S13` a été vu VERT PAR CONSTRUCTION avant d'être corrigé**, et c'est la troisième fois que
ce piège tombe dans ce harnais. Il comptait `td span.text-text-muted` pour prouver qu'un créneau
annulé rend un tiret — or **`Pill tone="muted"` porte AUSSI `text-text-muted`**, donc la pastille
« Cancelled » de la même ligne suffisait à le satisfaire : il serait resté vert après suppression
du tiret qu'il surveille. Il lit maintenant la **cellule adversaire** (`td:nth-child(2)`) et la
compare exactement. Vérifié rouge en remplaçant le tiret par « Deleted player ».

⚠️ **`S14` couvre enfin la 4ᵉ cause de `opponent: null`** — celle qu'aucun ticket n'avait pu
garder (voir les passations FT-4A et FT-4B). `opponent` est `null` dans **quatre** situations et
deux d'entre elles signifient qu'un adversaire a réellement joué **puis disparu** : un tiret y
effacerait quelqu'un en silence. Le scénario force l'état par `sql()` — `DELETE /users/me` répond
409 `engaged_in_match` tant qu'un match engage le compte, donc « l'adversaire part pendant un
match » est inatteignable par HTTP, mais `match_participants.user_id` est en **CASCADE** depuis
[BX-DEL] : supprimer la ligne de participant produit **exactement** l'état que laisse une
suppression de compte. C'est l'usage sanctionné de `sql()` (forcer un état, jamais constater un
comportement) — le comportement, lui, est lu à l'écran.

⚠️ **`S3` porte son propre contrôle positif.** « 0 requête » est aussi ce que mesure un filtre qui
ne matche **rien** (route renommée, `/api` oublié). Le même filtre est donc rejoué sur une page
valide, où il doit compter > 0.

⚠️ **Il ne dépend pas du seed** : deux comptes jetables, liés par appel API. Seuls les ladders
**chess 1v1** et **rl 1v1** sont attendus en base — ils viennent des migrations. Les deux sont
nécessaires : il faut un jeu dont on lie le compte **et** un dont on ne le lie pas, pour tenir
les deux faces de `S8`/`S9` sur un seul run.

⚠️ **Teardown obligatoire** : le match de `S14` est `in_progress`, donc il **engage** les deux
comptes et `DELETE /users/me` les refuserait en 409 (`purgeUserMatches()` du runner ne sait
annuler qu'un slot encore `pending`). Le scénario force les matchs en `cancelled` puis efface les
lignes, **même si un check a échoué**.

⚠️ **Ce que `solo` NE couvre PAS** : le rendu d'un classement **existant** (Elo · rang sur la
tuile, bande de stats renseignée). Une ligne de `rankings` exige un match **terminé** — deux
soumissions concordantes et un `scheduled_at` reculé — que ce scénario ne fabrique pas. L'état est
en revanche présent dans le seed : `alice` est **#1 / 1560 / 30–9** sur Chess 1v1, à vérifier à
l'œil.

## `games` (F-GAMES) — deux paires de checks qui se prouvent l'une l'autre

`scenarios/games.mjs` audite `/games` et `/games/$gameId` : la grille des 5 jeux et son
sous-titre **piloté par `GET /ladders`** (comparé à l'API, pas à une liste en dur), un slug
inconnu (**zéro requête** — `games.id` est un slug texte, c'est la LISTE déjà en cache qui
tranche, et un 404 laisserait une ligne rouge), le pool de maps comparé map par map à
`GET /games/cs2`, le CTA **décidé par le format**, le podium comparé à
`GET /ladders/{id}/rankings`, le partage de cache avec la page ladder, le retour qui nomme son
origine, et `?create=`. **19 checks**, et il ne **dépend pas du seed** (les 5 jeux et les 9
ladders viennent des migrations ; le podium est comparé à ce que l'API répond au même instant,
donc juste sur base peuplée comme sur base vide).

🔑 **Trois checks n'existent que pour empêcher leur jumeau d'être vert par construction** —
c'est le motif à reprendre, chacun de ces négatifs serait sinon satisfait par une page cassée :

- **`G6`/`G7`** : le compte du run est neuf, il n'a d'équipe **nulle part**. Sur cs2 5v5 cela
  doit donner « Create a team » et **zéro** « Play solo » ; sur chess 1v1, **le même compte,
  la même absence d'équipe** doit donner « Play solo » et zéro « Create a team ». Lire un
  `null` d'équipe comme « solo » est le bug déjà corrigé deux fois (FT-4A, F-SOLO) : un seul
  des deux checks resterait vert le jour où le CTA cesserait d'être rendu du tout.
- **`G10`/`G10b`** : arrivé **depuis** `/games/cs2`, le retour dit « Back to the game » et
  jamais « Back to my teams » (ce serait faux pour un compte sans équipe) ; arrivé **par URL
  directe**, le repli « Back to my teams » est **inchangé**. Chacun prouve que le sélecteur de
  l'autre matche vraiment quelque chose.
- **`G11`/`G12`** : `?create=<id valide>` ouvre le formulaire pré-sélectionné, `?create=<uuid
  inconnu>` n'ouvre **rien** et ne lève rien. Sans `G11`, « le formulaire n'est pas ouvert »
  serait vert sur une fonctionnalité entièrement morte.
- **`G8`/`G8c`** couvrent les deux états du podium **sur la même page** : cs2 5v5 est classé
  (podium + le `sr-only` « First place », parce qu'une médaille dorée n'est rien pour un
  lecteur d'écran), cs2 2v2 ne l'est pas (« No one ranked yet », **jamais un podium à
  trous**). ⚠️ `G8c` vire au ROUGE si la base finit par classer quelqu'un sur les deux : il
  faudra alors lui trouver un autre ladder, et le message le dit.

⚠️ **`G3` porte son propre contrôle positif** (« 0 requête » est aussi ce que mesure un filtre
qui ne matche rien), et `G9` — « suivre *See the full standings* ne rejoue AUCUN classement »,
le point de perf du ticket — s'appuie sur `G4`, qui compte **2** requêtes avec le **même
filtre** quelques lignes plus haut.

⚠️ **Deux rouges vécus à l'écriture, à connaître** :

1. **`label-caps` met le texte en MAJUSCULES**, donc `innerText()` rend « COUNTER-STRIKE 2 »
   et « ANCIENT » là où le DOM porte « Counter-Strike 2 » et « Ancient » (`G2`, `G5` : la
   comparaison est passée en insensible à la casse). ⚠️ Mais **mesuré dans ce harnais : le
   NOM ACCESSIBLE, lui, n'est pas transformé** — `getByRole(..., { exact: true })` matche
   toujours « 5v5 ». Ne pas confondre les deux lectures.
2. **`LadderSelect` lance sa PROPRE requête** (games + ladders) à son montage : le champ
   « Team name » existe **avant** la rangée de formats. `G11` lisait `aria-pressed` tout de
   suite et comptait 0 boutons — attendre le formulaire n'attend pas le picker.

## `matchmaking` (F-MM) — les six raisons de refus, produites À LA SUITE

`scenarios/matchmaking.mjs` audite `/matchmaking` : le tableau global des créneaux ouverts et
les **deux chemins d'acceptation**, qui n'ont rien en commun (2v2+ par un panneau de
composition inline, 1v1 par une confirmation **sans corps de requête**). **23 checks**, et
**les SIX raisons de refus** du contrat y sont rendues pour de vrai.

🔑 **`MM4` est le check qui garde le motif de rejet** : case décochée, le nombre de boutons
« Accept » à l'écran est comparé au nombre de créneaux dont l'API dit `canAccept: true` — et le
check exige **au moins un créneau refusé à l'écran**, sinon « autant de boutons que
d'acceptables » serait vrai par construction sur un tableau où tout est acceptable.

🔑 **`MM5` → `MM6` → `MM7` → `MM8` sont UNE seule séquence sur LE MÊME créneau**, où seule la
DONNÉE change : le compte du run n'a pas d'équipe (`no_team`), puis en crée une (`roster_too_small`),
puis recrute un joueur non lié (`roster_not_linked`), puis fait lier ce joueur (bouton offert).
C'est ce qui garde la distinction que la carte exige : `roster_too_small` et `roster_not_linked`
ont **deux remèdes différents**, donc deux phrases et deux liens — les fusionner enverrait un
capitaine recruter un 3ᵉ joueur alors qu'il lui suffit de faire lier un compte. `MM8` est le
positif qui prouve que les trois autres peuvent virer au rouge.

🔑 **Les deux dernières raisons ont chacune coûté une pièce de fixture, et elles sont
irréductibles.** `not_captain` (`MM5b`) exige un **SECOND ladder d'équipe** : un joueur ne peut
appartenir qu'à UNE équipe par ladder (`team_members_user_ladder_unique`), donc le compte du run
ne peut pas être à la fois simple membre ici et capitaine là. `schedule_conflict` (`MM15b`) n'est
atteignable qu'**après** `MM15` : il faut que le compte porte un match `in_progress`, et c'est
l'acceptation du créneau chess qui le lui donne — un tiers ouvre alors un créneau sur **exactement
la même heure** (l'instant est retenu dans une variable, jamais recalculé : deux appels à
`futureQuarter(2)` peuvent franchir un quart).

🔑 **`MM16` garde le dernier chemin vers un 4xx offert par un bouton**, et il n'a besoin d'aucune
course : le serveur ne liste que les créneaux à plus de 15 min **au moment où il répond**, un
onglet resté au premier plan ne refetch pas, deux minutes de lecture suffisent. Le créneau est
posé à **T+16 min par `sql()`** (usage sanctionné : `POST /matches` impose la grille des quarts,
aucune séquence HTTP ne produit cet état), puis **l'horloge de la page est pilotée**
(`page.clock.install()` + `fastForward('02:00')`) — c'est la seule façon d'avancer le temps du
client sans avancer celui du serveur. Le pilotage d'horloge est sous `try/catch` : une panne doit
rougir CE check, jamais sortir en exit 2.

⚠️ **`MM10` a été vu ROUGE avant vert, et pour une raison à retenir** : « zéro requête portant
l'uuid inconnu » comptait **1**, sur un front pourtant correct — la **navigation du document**
(`/matchmaking?ladderId=<uuid>`) porte l'uuid elle aussi. Le filtre de `countRequests` doit être
scopé à `/api/`. Il porte en plus son **contrôle positif** (le même filtre sur un ladder valide
doit compter > 0), parce que « 0 requête » est aussi ce que mesure un filtre qui ne matche rien.

⚠️ **`MM13`/`MM14` sont la paire §5.1 en 1v1** : sans compte chess.com lié, le bouton ne doit pas
exister (`POST /accept` répondrait 400) ; on relie le compte, il doit revenir. On ne casse pas le
code pour voir rouge, **on retourne la donnée** — même motif que `S8`/`S9` de `solo`.

⚠️ **`MM3` garde l'anonymat B5b** : le nom de l'équipe qui a ouvert le créneau (connu du
scénario, qui l'a créée) ne doit apparaître **nulle part** dans `<main>`, ni aucune map. Les maps
ne sont même pas dans la charge utile — le check garde donc le **rendu**, pas l'API.

⚠️ **IL N'ACCEPTE JAMAIS LE CRÉNEAU DU SEED.** La base semée porte un créneau cs2 5v5 ouvert
(Team Alpha) qui apparaît sur le tableau et sert même de second créneau refusé ; l'accepter
détruirait un des 7 états cs2 qu'exige `match-detail`. Le scénario fabrique **ses** créneaux
(4 comptes, 2 équipes, 2 ladders) et ne dépend donc pas du seed — tous ses comptages sont
**relatifs à ce que l'API répond au même instant**, jamais à un nombre absolu.

⚠️ **Teardown obligatoire, et il est double** : les deux matchs acceptés sont `in_progress`, donc
ils engagent les comptes (**409 `engaged_in_match`** sur `DELETE /users/me`) **et** les équipes
(**409 `team_engaged_in_match`** sur `DELETE /teams/:id`). Le scénario force les matchs en
`cancelled` puis efface les lignes, **même si un check a échoué** ; le runner enchaîne ensuite
matchs → équipes → comptes.

⚠️ **`MM4b` mesure DEUX choses, et la seconde est la seule qui garde vraiment.**
`scrollWidth - clientWidth` était **vert par construction** sur `LadderBoard` (leçon FT-3 : 73 px
sortaient en silence, nom rendu à **0 px** de large) — un conteneur qui CLIPPE ne déborde jamais.
Le check lit donc aussi la largeur **rendue** du nom de ladder et la cible tactile du bouton
(WCAG 2.5.8). Vu ROUGE en passant le nom en `w-0 overflow-hidden` : « débordement −15 px (≤ 0) »
restait vert, « largeur rendue 0 px » a rougi.

⚠️ **`getByRole('listitem')` est scopé au `<ul aria-label="Open slots">`**, jamais à `<main>` :
`LineupPicker` rend ses candidats en `<li>`, donc un comptage non scopé n'est juste que tant
qu'aucun panneau n'est ouvert — il deviendrait **faux sans devenir rouge**.

⚠️ **`MM11` a rougi sur une course DU CHECK**, pas du code : le panneau charge son propre roster
(`GET /teams/{id}`) et `count()` n'attend rien, là où le `check()` juste en dessous patiente. Il
comptait 0 case pendant que le clic aboutissait. **Attendre la première case avant de les
compter** — même famille que « lire une région live ».

⚠️ **`exact: true` sur « Accept the slot »** : le bouton de la LIGNE porte un `aria-label`
« Accept the slot on <ladder> at <date> », et Playwright matche le nom accessible en
**sous-chaîne** — sans `exact`, le sélecteur du bouton de soumission du panneau attrape les deux.

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
