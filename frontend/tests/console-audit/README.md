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

## `home` (F-HOME) — le budget de requêtes est un check, pas un commentaire

`scenarios/home.mjs` audite `/home` : le **budget de 5 requêtes** et le **zéro `GET /ladders`**,
le rappel §5.1 piloté par `games.required_provider`, sa fermeture **définitive** (rechargement
compris), le focus rendu au `<h1>`, l'**échéance de retrait** d'un créneau ouvert, la condition
d'affichage de l'onboarding **dans les deux sens**, le partage d'entrée de cache avec `/games`, la
**panne partielle** qui doit se dire même sur une page pleine, et les **deux largeurs** qui
comptent. **18 checks**, et il ne **dépend pas du seed** : le compte du
run est neuf — ce qui est exactement l'état par défaut qu'on veut auditer — et le seul état peuplé
est fabriqué par l'API (deux comptes chess.com liés, un créneau ouvert par un **tiers** puis trois
créneaux à moi, sur **chess 1v1**, ladder issu des migrations `0009`).

🚨 **QUATRE CHECKS EXISTENT PARCE QUE 12 CHECKS VERTS N'ONT RIEN VU ET QU'UN COUP D'ŒIL A TOUT
TROUVÉ.** La première livraison sortait 12/12 et console 0 ; une relecture des captures à 1280 et
375 px a sorti **quatre défauts réels**, tous invisibles à l'automatisation parce qu'un check ne
garde que ce à quoi on a pensé :

| Check | Le défaut qu'il garde |
| --- | --- |
| `H11` | le compte à rebours portait un format d'**horloge** — « in 18 h 43 » se lit 18:43, et « in 18 h 03 » n'en est pas distinguable, sur une page qui affiche de **vraies heures** juste à côté (coup d'envoi `22:00`, retrait `21:45`). Le check exige l'unité (`in 18h 43m`) **et refuse** l'ancien format |
| `H10` | la pastille de statut n'existait **que** sur la carte vedette : sur une page faite de créneaux ouverts, « OPEN SLOT » apparaissait une seule fois, et un match accepté ne se distinguait d'un créneau que par la présence d'un adversaire |
| `H12` | la date et le rebours étaient **inversés** entre la carte et les lignes — l'œil zigzaguait. Mesuré sur les **positions rendues**, pas sur l'ordre du DOM |
| `H8` | l'onboarding exigeait que **tout** soit vide : un compte de 4 équipes, 0 match, qui voyait deux créneaux acceptables ne l'avait donc pas — alors qu'il est le lecteur visé. Le signal est « **aucun match** », pas « page vide » |

Les quatre ont été **vus rouges avant vert** (sabotage des quatre en un seul run, chacun rouge
pour sa propre raison, `H13` restant vert — il garde autre chose). **La leçon vaut pour tout
ticket front : réclamer la capture, et la lire.**

⚠️ **`H8` et `H13` sont une paire et aucun ne se déduit de l'autre** : `H8` exige l'onboarding
**présent** alors que « Slots you can take » est rempli (0 match), `H13` l'exige **absent** dès
qu'un match existe. Sans `H13`, un bloc affiché en permanence passerait `H8` ; sans `H8`, la
condition trop stricte d'origine passait `H13`.

🚨 **UN CINQUIÈME DÉFAUT EST SORTI DE LA CAPTURE SUIVANTE, APRÈS LE HERO.** Le `<h1>` vit dans un
conteneur **`overflow-hidden`** (l'art du hero est en `absolute inset-0`, il le faut), et un pseudo
est un **token insécable de 30 caractères max** : à 375 px, « WELCOME BACK, PROBE5461829 » perdait
**63 px de son propre texte** hors champ — **mesuré** — pendant que le document ne débordait pas et
que les 16 autres checks restaient verts. C'est la leçon FT-3 appliquée à un titre : **un conteneur
qui CLIPPE ne déborde jamais**, donc le seul moyen de le voir est de mesurer l'ÉLÉMENT
(`h1.scrollWidth - h1.clientWidth`), ce que font désormais `H15` et `H16`. Correctif : `break-words`
sur le `<h1>`. Vu **rouge à 63 px avant** le correctif, vert (0 px) après.

⚠️ **`H15` mesure la colonne CENTRALE, pas la fenêtre.** `RightRail` est monté en `w-78` (312 px)
même vide, donc la colonne à 1280 px vaut déjà **625 px** — ce qu'elle vaudra une fois le rail
social rempli. Concevoir une ligne en pleine largeur et découvrir le débordement au merge du rail
est exactement ce que ce check empêche, d'autant que la ligne porte **cinq** éléments depuis
`H10`. Il mesure **trois** choses : débordement du document, débordement de **la ligne**, et la
**largeur rendue** du nom de ladder — le troisième parce qu'un conteneur qui CLIPPE ne déborde
jamais (leçon FT-3, 73 px sortis en silence).

🔑 **`H2` existe pour protéger `N5` de `f-nav`, et c'est la vraie leçon de ce scénario.** `N5`
exige que `/home` ne demande pas les ladders ; tant que `/home` était un stub, c'était gratuit et
le check avait déjà été **re-ciblé trois fois**. [F-HOME] en fait une vraie page (5 requêtes) mais
**pas** une consommatrice de `GET /ladders` : nommer le ladder d'une ligne coûterait une 6ᵉ
requête, et `matchLabeller(undefined, games)` retombe déjà sur `<jeu> <format>`. `H2` écrit cette
contrainte **du côté de la page**, si bien qu'un futur ticket qui ajouterait `useLadders()` ici
rougit sur `home` — au lieu de faire tomber `N5` sur un scénario qui parle de la barre de
recherche et n'a rien à voir avec la cause.

⚠️ **Le chemin doit être comparé EXACTEMENT** : `/api/teams/invitations/me` **commence par**
`/api/teams`, donc un `includes('/api/teams')` rendrait `H2` faux **sans le rendre rouge**.

⚠️ **« Zéro requête en navigant depuis `/home` » n'est vrai que pour les données de référence.**
Le `QueryClient` de l'app est construit sans defaults (`staleTime: 0`), donc `GET /matches/me`,
`/teams/invitations/me` et `/users/me/external-accounts` sont **refetchés en fond** au montage de
l'écran suivant. Ce qui est partagé — et ce qui compte pour l'utilisateur — c'est **l'entrée de
cache** : la page suivante peint instantanément, sans spinner. Seul `['games']` (1 h de fraîcheur)
donne un vrai zéro requête, et c'est donc lui que mesure `H14`, avec son témoin positif (le même
filtre à froid doit compter ≥ 1). Poser un `staleTime` sur `matches/me` pour élargir le check
servirait un historique **périmé** sur `/history` : mauvais échange, refusé.

🔑 **`H17` a été vu ROUGE avant vert**, et il garde une clé, pas du code : on jongle entre
`alice`/`bob`/`carol` dans le même Chrome toute la journée (l'audit compris), donc la clé
`localStorage` de la fermeture du rappel est **préfixée par l'userId**. Sur une clé partagée, la
fermeture par un compte masquerait le bandeau de **tous** les suivants — un défaut qui ne se
reproduit qu'une fois et qu'on impute alors au rendu. Vérifié en remplaçant le préfixe par une
constante : `H17` rouge, **`H7` toujours vert** — les deux gardent bien des choses différentes
(persistance d'un côté, portée de l'autre), aucun ne rend l'autre superflu.

⚠️ **`H13` est le contrôle positif de l'état vide.** « L'onboarding est affiché » resterait vert sur
un bloc qui s'afficherait **toujours** : ce qui compte est qu'il **disparaisse** dès que l'historique
contient un match, et c'est ça que `H13` mesure, sur le même run.

⚠️ **`H5` ne cherche PAS le mot « queue » tout seul.** L'onboarding dit légitimement « there is no
queue and no automatic pairing » — c'est même le point. Le check vise les **deux formulations
précises** de l'ancienne copie de `LinkAccountBanner` (« enter the queue », « matchmatching »),
que ce ticket a réécrites.

🚨 **`H5` porte son contrôle positif depuis la review, parce qu'un check qui ne cherche qu'une
ABSENCE est vert sur une page qu'on n'a pas lue.** Il faisait `innerText()` puis « 0 formulation
interdite » : un `<main>` qui ne résout plus, ou un `innerText` rendant `''`, sortait vert **sans
avoir rien regardé** — la forme exacte que ce scénario corrige déjà ailleurs (`H14` et son témoin à
froid, `H8` et son `slotsShown`, `H10` qui compte avant de lire). Il exige désormais de retrouver la
phrase d'intro de la page (inconditionnelle, elle est dans le hero) **avant** de conclure sur ce
qu'il n'y a pas trouvé, et le `.catch(() => '')` fait ROUGIR un sélecteur périmé au lieu de sortir en
**exit 2**. Vu rouge en visant `main#nope`, vert ensuite.

⚠️ **`H9` lit l'écran ET l'`aria-label` de la carte vedette.** Un `aria-label` **remplace** le
contenu du lien : qui parcourt la page par liens n'entendait que « Next match: Chess 1v1, in 6h 6m »
et **jamais** « withdrawn at 09:45 » — la seule information que [F-HOME] ajoute à l'app. Trouvé en
review, pas par un check. Les deux rendus lisent maintenant la **même** fonction
(`withdrawalText`), deux phrases tenues à la main divergeraient.

🚨 **`H18` garde la promesse « la page n'est jamais muette », qui n'était tenue qu'à moitié.**
L'encadré « Part of this page could not be loaded » était conditionné à une page **vide**
(`!hasSomething`) : avec un match à venir à l'écran et `GET /teams/invitations/me` en 500, le
compteur d'invitations retombe à `0` (dégradation volontaire — `/teams` porte l'erreur réelle et les
actions), le bloc ne rend rien, **aucun** encadré n'apparaît, et une invitation en attente disparaît
sans le moindre signal. Le cas exact où le silence coûte quelque chose était donc le seul non
couvert. La condition ne dépend plus que de `hasFailed` (moins `matchesQuery.isError`, qui a déjà son
propre `Callout` — deux phrases pour un fait, c'est ainsi qu'on apprend à sauter les deux), et
l'encadré est remonté **en tête de page** : il ne s'affichait qu'un écran vide, donc sa place n'avait
aucune importance ; sur une page pleine, le pied d'une page qui défile est le seul endroit où il ne
serait jamais lu. La panne est fabriquée par **`page.route`** et déclarée par **`expectHttp`**
(cloisonnée à sa phase, sinon le 500 voulu compterait comme une entrée console du ticket). ⚠️ Le
check exige AUSSI que la carte « Next up » soit rendue : sans ce contrôle positif il re-mesurerait
l'ancien comportement (page vide → encadré), c'est-à-dire rien. Vu **rouge** avec l'ancienne
condition, vert après. ⚠️ On attend le message, on ne le compte pas à `networkidle` : TanStack
réessaie (1 s, 2 s, 4 s) et l'absence d'encadré pendant les réessais est légitime.

⚠️ **`H18` s'exécute AVANT `H17` dans le rapport, ce n'est pas un défaut** : il vit en §5b et `H17`
en §6, qui **bascule de compte** et doit donc rester le dernier pas du scénario. `H18` a besoin d'un
compte qui a des matchs (son contrôle positif), le nouveau compte de `H17` n'en a aucun.

⚠️ **`H17` bascule de compte, donc `clearCookies()` d'abord** : `/login` **redirige** vers `/home`
tant qu'une session existe, et `login()` expirerait sur un `#email` introuvable — soit un
**exit 2** au lieu d'un rouge. Vider les cookies ne touche pas le `localStorage`, ce qui est
exactement la situation que le check veut éprouver.

⚠️ **Pas de teardown particulier** : le créneau reste `pending`, donc `purgeUserMatches()` du
runner l'annule seul avant `DELETE /users/me`. Contrairement à `history` ou `match-result`, ce
scénario ne produit aucun match **engageant**, donc rien à forcer en SQL.

## `admin-disputes` (F-ADMIN) — le scénario qui peut faire rougir un AUTRE fichier

`scenarios/admin-disputes.mjs` audite l'onglet **Arbitration** du rail, la file `/admin/disputes`
et le panneau d'arbitrage du dossier de litige. **15 checks**, et il ne **dépend pas du seed** :
il fabrique **ses deux** disputes chess 1v1 jetables (deux comptes, `chess_com` liés par API,
recette de `match-result`). Seul le ladder chess 1v1 est attendu, il vient des migrations.

### 🚨🚨 `is_admin = false` DANS LE `finally`, ET C'EST LE PIÈGE N°1

Ce scénario **PROMEUT le compte du run en admin** par `sql()` : les comptes admin sont créés à la
main en base, il n'existe **aucun** écran de promotion et il n'y en aura pas — c'est l'usage
sanctionné du SQL (forcer un état que l'API interdit d'atteindre).

Un flag laissé en base fait **7 liens** dans le rail. Or `f-nav.mjs:51` assert qu'il y en a
**exactement 6**, avec une liste de libellés figée : le scénario suivant sort donc ROUGE, sur une
surface qui n'a **rien à voir** avec ce ticket — et le diagnostic coûte cher, parce que le rapport
accuse `f-nav`. Le `finally` retire donc le flag **avant toute autre opération de nettoyage**, et
son échec est un check ROUGE explicite (`A13`) plutôt qu'une exception avalée. ⚠️ On ne peut pas
compter sur la suppression du compte par le runner : `DELETE /users/me` refuse un compte engagé
dans un match.

### 🚨 Il ne touche jamais la dispute semée

`match-detail` exige les 7 états cs2 et `dispute` exige que la dispute de démo reste **ouverte** :
la résoudre casserait les deux. D'où deux disputes jetables — **une arbitrée**, l'autre **laissée
ouverte**. Ce n'est pas du confort : le négatif « un participant non-admin ne voit aucun contrôle »
(`A12`) rejoué sur le dossier déjà arbitré aurait été vert pour la **mauvaise** raison (« le
dossier est clos ») au lieu de la bonne (« ce compte n'arbitre pas »), et serait resté vert le jour
où la garde `isAdmin` sauterait.

### Chaque négatif a son positif DANS LE MÊME RUN

C'est la discipline `G6`/`G7` et `S8`/`S9` : un check qui ne garde qu'une ABSENCE est vert sur une
page qu'on n'a pas regardée.

| Négatif | Son jumeau positif |
| --- | --- |
| `A1` — un joueur ordinaire n'a pas l'onglet (6 liens) | `A3` — un admin l'a, en 7ᵉ position, sous History |
| `A2` — un non-admin sur `/admin/disputes` : **0 requête** `/api/disputes` | `A2b` — même filtre côté admin : > 0 |
| `A12` — un participant non-admin : 0 contrôle d'arbitrage | `A8` — l'admin en a 3, sur un dossier **ouvert** |
| `A7` — file vide : aucune liste, aucun badge | `A5` — file pleine : autant de lignes que l'API |

⚠️ **`A3b` compare la couleur au TOKEN RÉSOLU PAR LA PAGE**, jamais à un `rgb(...)` en dur : on
insère une sonde `color: var(--color-arena-red)`, on lit sa couleur calculée, et on la compare à
celle de l'onglet. Une valeur figée dans le scénario se périmerait au premier retouche du design
system, et le check deviendrait faux **sans devenir rouge**.

⚠️ **`A5` garde l'ORDRE, qui est celui du serveur** : `GET /disputes` trie de la plus ANCIENNE à la
plus récente, c'est-à-dire par proximité de l'annulation automatique — l'ordre de traitement d'un
arbitre. Le href de la 1ʳᵉ ligne est comparé au 1ᵉʳ id que l'API rend au même instant, jamais à un
uuid en dur.

⚠️ **`A10` mesure l'invalidation CROISÉE**, le point technique du ticket : arbitrer doit rafraîchir
le dossier **et** la file. Le badge du rail et la page lisent la même clé, donc le badge décroît —
sans ça un arbitre relirait une file qui liste du travail déjà fait.

### Deux rouges vécus à l'écriture, tous deux dans le CHECK et pas dans le code

1. **`innerText` contre `textContent`.** `label-caps` met le RENDU en capitales : `innerText`
   rendait « 3\nOPEN DISPUTES » là où le DOM porte « 3 open disputes ». Un `=== '3'` était un check
   faux, pas un défaut du rail. ⚠️ Au passage, un **vrai** correctif en est sorti : deux nœuds de
   texte adjacents se concatènent **sans séparateur**, donc le badge valait littéralement
   « 3open disputes ». L'espace est désormais **dans la chaîne** du `sr-only` — la spec laisse à
   l'implémentation le soin d'en insérer une au calcul du nom accessible, on ne le suppose pas.
2. **`form textarea` a résolu 2 éléments -> exit 2.** Le compte du run est à la fois **admin ET
   partie prenante** (c'est lui qui a ouvert le créneau) : la page porte donc le formulaire de
   dépôt de preuve **et** celui d'arbitrage. État parfaitement légitime — un admin reste un joueur
   ordinaire — mais les sélecteurs doivent viser le `name` du champ, jamais sa forme. `A8` assert
   désormais que le formulaire de preuve est **toujours offert** : le panneau d'arbitrage AJOUTE,
   il ne remplace rien.

### L'état vide est fabriqué par `page.route`, pas en vidant la base

Idiome `H18` de `home`. La table des disputes porte la dispute de démo dont `dispute` et
`match-detail` dépendent : on stube la réponse (200, `{disputes: []}`), donc **rien à déclarer en
`expectHttp`**. ⚠️ Le prédicat vise le **chemin exact** (`url.pathname === '/api/disputes'`) :
`/api/disputes/{id}` commence par la même chaîne, un `startsWith` détournerait aussi les dossiers
individuels.

## `dispute` (F-DISPUTE) — et le check qui était vert par construction

`scenarios/dispute.mjs` audite `/disputes/$disputeId` : id malformé (écran d'erreur, **zéro
requête** + témoin positif), uuid inconnu (404 déclaré par `expectHttp`), **non-participant**
(403 déclaré), une dispute **résolue par un admin** en lecture seule (verdict **nommé**, jamais
l'enum brut ; note d'arbitre, puis son repli quand `resolutionNotes` est `null` ; **zéro
contrôle**), une dispute **close par le job** (aucune attribution à un arbitre, aucune ligne de
log servie), le dossier
**ouvert** (pastille, les deux déclarations contradictoires, échéance des 24 h, fil **vide
lisible**), la paire **capitaine / non-capitaine aligné**, les deux refus **clients** (type non
supporté, > 5 Mo) **sans aucune requête**, un dépôt réel **image** puis **PDF**, les portes
d'entrée (fiche de match, `ActionRequired` de `/history`), le **non-changement de « Next up »**,
375 px, et l'**échéance de 24 h qui retire le formulaire toute seule**. **26 checks.**

### 🚨 `D6b` garde le CAS COURANT, celui que le job produit tout seul

⚠️ **CETTE SECTION DISAIT « [F-ADMIN] n'existe pas ».** Elle a été écrite quand aucun écran
n'appelait `POST /disputes/{id}/resolve` ; **[F-ADMIN] a livré cet écran** (voir plus haut,
`admin-disputes`), donc `resolved` a désormais **deux** chemins et non plus un. ⚠️ Les mêmes
phrases périmées subsistent dans les commentaires de `scenarios/dispute.mjs` (l. 52 et 410) : elles
appartiennent au ticket F-DISPUTE et n'ont pas été touchées ici, mais elles **mentent** au prochain
lecteur. Ce qui suit reste vrai et reste la raison d'être de `D6b`.

Le **timeout du job B7 est le chemin le plus COURANT vers `resolved`** — c'est le seul qu'une
dispute prenne sans que personne n'intervienne, et la dispute de démo l'emprunte toute seule 24 h
après un `seed:dev`. Or le job écrit les **mêmes colonnes** qu'un
arbitre (`status`, `resolution`, `resolvedAt`) plus une `resolutionNotes` qui est une **ligne de
log interne en français**. La page annonçait donc « Settled by an admin », « the admin could not
separate the two camps », et servait cette ligne sous le libellé « Admin's note ».

La 1ʳᵉ version du scénario **ne pouvait pas le voir** : elle forgeait la résolution avec sa propre
note anglaise et sans `resolved_by_user_id`, donc `D4`/`D6` étaient verts sur un état que le
produit ne fabrique jamais. `D6b` forge l'état **exactement comme `timeoutDisputes()` l'écrit** et
exige que le bloc de verdict n'attribue rien à un admin, que le bloc « Admin's note » **n'existe
pas**, et que la chaîne française n'apparaisse nulle part. ⚠️ **Il vise le bloc de verdict, pas
`<main>` entier** : le pied de page dit légitimement « Only an admin can settle a dispute », donc
un balayage global du mot « admin » rougirait sur une copie irréprochable.

🔑 Côté front la distinction passe par **`settledByTimeout()`**, et son test est
`resolution === 'cancelled' && settledBy !== 'admin'` — **pas** `settledBy !== 'admin'` seul : le
job n'écrit jamais autre chose que `cancelled`, donc un **vainqueur** désigné vient toujours d'un
humain, y compris quand `settledBy` dit `timeout` parce que cet admin a depuis supprimé son compte
(`resolved_by_user_id` est en `set null`).

🔑 **`D23` est le dernier chemin vers un 4xx offert par un bouton, et il n'a besoin d'aucune
course** : le job B7 annule la dispute 24 h après son ouverture, un onglet resté ouvert traverse
l'échéance avec un `status: 'open'` **périmé en cache**, et le clic répond **409**. C'est
`Math.max(useSlotClock(), dataUpdatedAt)` qui le ferme — `dataUpdatedAt` seul en serait incapable
(c'est l'instant où le serveur a appliqué la même règle, il ne peut pas contredire sa propre
réponse). Le check **pilote l'horloge du CLIENT** (`clock.install()` + `setSystemTime(+25 h)` +
`runFor(31 s)`, un tick de `useSlotClock`), donc le serveur ne voit rien et la donnée de démo n'est
pas touchée. ⚠️ **Reculer `created_at` en SQL aurait été le mauvais réflexe** : le job (`TICK_MS`
= 60 s) aurait annulé la dispute semée en moins d'une minute — donc cassé `match-detail` **et**
rendu le check flaky. ⚠️ **Il est en TOUTE DERNIÈRE phase à dessein** : une horloge factice ne se
désinstalle pas, et `resume()` repartirait de « +25 h ». Sous `try/catch` (idiome `MM16`) : une
panne du pilotage rougit CE check, elle ne sort pas le harnais en exit 2. **Vu rouge** en retirant
la garde `window_closed`.

⚠️ **Il EXIGE la base semée** (`docker compose exec backend npm run seed:dev`). La dispute de démo
cs2 5v5 est le seul état qui donne un camp de **5 joueurs**, donc un **non-capitaine aligné** —
qu'un ladder 1v1 ne peut pas produire par construction. Sans seed le scénario **lève** (exit 2),
plutôt que de sortir des checks verts par accident.

⚠️ **Et le seed se périme tout seul, ici plus vite qu'ailleurs** : le job B7 annule la dispute
**24 h après son ouverture**, semée à `kick-off − 8 h + 82 min`, soit ~**17 h** de marge. Reséminer
avant toute campagne.

### Deux usages sanctionnés de `sql()`, tous deux réversibles

1. **Le mot de passe de `dave`.** Le seed ne donne un hash qu'à `alice`/`bob`/`carol` et le
   **retire activement** aux figurants : le seul non-capitaine aligné de la dispute est donc
   **inconnectable**. On lui recopie le hash d'alice, remis à `NULL` au teardown **même si un check
   échoue**. (Vérifié dans la fixture : `dave` est bien aligné côté Team Alpha et capitaine
   **d'aucun** des deux camps de ce match.)
2. **La résolution.** `POST /disputes/:id/resolve` est **admin only** et il n'existe **aucun compte
   admin dans les fixtures** : aucune séquence HTTP ne mène à `resolved`. Le scénario fabrique donc
   sa **propre** dispute chess 1v1 (2 comptes jetables, recette de `match-result`) et force la
   ligne — **en repassant le match en `completed` dans le même geste**, parce qu'une dispute
   `resolved` sur un match resté `disputed` est un état que le domaine ne produit jamais.

🚨 **Il ne résout JAMAIS la dispute semée** : `match-detail` exige les 7 états cs2, la résoudre
ferait tomber un autre scénario. Les preuves déposées sur elle sont en revanche nettoyées par
**delta** (les ids préexistants sont relevés avant, et préservés) — un coéquipier qui travaillerait
sur le même dossier ne perd rien.

### 🔑 `D15` a été vu **VERT PAR CONSTRUCTION**, et c'est la 4ᵉ fois que ce piège tombe ici

Le check garde la règle asymétrique du rendu : un PDF ne doit **jamais** être rendu dans un
`<img>`. Sa première version comptait les `<img>` de la ligne PDF — et sur un build volontairement
cassé (`isImage = true` pour tout), elle est **restée verte** : `EvidenceAttachment` porte un
`onError` qui **retire l'image** dès qu'elle échoue à se décoder, donc le check lisait le DOM
**après** la bascule. Il serait resté vert le jour où la règle aurait sauté.

Il compte désormais la **requête** vers l'objet `.pdf`, qu'aucun gestionnaire d'erreur ne peut
reprendre : le lien n'est pas suivi, le fichier ne doit donc jamais être demandé au chargement.
**Vu rouge** sur le même sabotage, vert après restauration. `D15b` est son témoin positif (la
vignette PNG, elle, **doit** être demandée) — sans lui, « 0 requête » ne serait que la mesure d'un
filtre qui ne matche rien.

⚠️ **Au passage, une croyance corrigée** : un PDF dans un `<img>` **n'écrit AUCUNE ligne console**.
MinIO répond 200, la requête réussit, seul le **décodage** échoue — Chrome le signale silencieusement
par l'événement `error` de l'élément. Ce que ça coûte reste réel (une image cassée et le
téléchargement inutile du fichier), mais **le vrai risque console de cet écran est ailleurs** : une
URL présignée **périmée** répond 403, et celle-là est bien rouge. Elle est fermée par le
`gcTime: 0` de `useDispute`, pas par le rendu.

### ⚠️ `D1` a rougi sur un filtre trop large, pas sur le code

« L'id malformé ne coûte aucune requête » comptait **2** sur un front pourtant correct : un
`page.goto` recharge toute la SPA, qui rejoue son bootstrap de session (`POST /auth/refresh` +
`GET /users/me`). Le filtre doit viser **`/api/disputes`**, pas `/api/`. Même famille que `MM10`
(l'uuid porté par la navigation du document), et il porte le même témoin positif.

⚠️ **`D19` garde un NON-changement, et il a fallu deux versions.** [F-DISPUTE] a généralisé la
destination de `MatchLineLink` (union discriminée `match` / `dispute`) ; « Next up » de `/home` ne
doit **rien** en voir. `D19` l'exige, et `D18` exige à l'inverse — sur `/history`, pas sur la même
page — qu'une ligne en litige de `ActionRequired` pointe sur `/disputes/…`. Les deux ensemble
prouvent que la généralisation a été appliquée là où il fallait et **seulement** là.

🔑 **Sa 1ʳᵉ version portait un sélecteur MORT** : `h2:has-text("Next up") ~ a` résout **0 élément**,
parce que `SectionTitle` enferme son `<h2>` dans un `<div>` — la carte vedette est sœur de ce
`<div>`, jamais du `<h2>`. Conséquence : **la carte vedette n'était jamais inspectée**, alors
qu'elle est le premier des deux sites d'appel modifiés et **le seul qui porte un `ariaLabel`**. Elle
est désormais ciblée par une relation réelle — son **nom accessible**, qui commence par
« Next match: ». ⚠️ Et la liste « Later matches » est devenue **facultative** : l'ancienne version
exigeait au moins un lien, donc elle serait sortie rouge le jour où alice n'a qu'un seul match à
venir. Le run qui la voyait verte ne tenait que grâce à des créneaux de démo posés **à la main par
un coéquipier** — exactement la dépendance que [FX-AUDIT] interdit.

## ⚠️ `login()` attend désormais la quiescence réseau (F-HOME)

`login()` rendait la main sur `waitForURL('**/home')`. C'était sûr tant que `/home` était un stub
**sans aucune requête** ; depuis [F-HOME] elle en émet **5**, et le `page.goto` que l'appelant
enchaîne aussitôt les **avorte** — Playwright émet alors un `requestfailed`
(`net::ERR_ABORTED`) que le runner enregistre en `netfail`, **après** le `setPhase` du scénario,
donc **imputé à un ticket innocent**. `login()` fait maintenant suivre un
`waitForLoadState('networkidle')` (sous `catch`, et **dans** la phase « login », donc hors
périmètre). Concerne les 7 appels de `match-result`, `match-detail`, `teams-detail` et
`teams-manage`.
## `fs2-notifications` (FS-2) — les fixtures sont produites par de VRAIES actions

`scenarios/fs2-notifications.mjs`, **8 checks**.

🔑 **Aucune notification n'est écrite en base.** Un compte tiers envoie une vraie demande d'ami
(→ `friend_request_received`), et c'est cette notification-là qui est lue à l'écran. Motif : une
fixture écrite à la main peut avoir une forme que le vrai code n'émet **jamais** — on auditerait
alors un rendu qui ne se produit pas en usage réel. Le prix est la couverture : seuls 2 des 17
types sont atteignables ainsi, les autres se regardent à l'œil avec `seed:social`.

🚨 **`N2` refuse la TECHNIQUE, il n'exige pas une phrase précise.** Il cherche un uuid, une
accolade ou un nom de champ dans la ligne rendue : leur présence signifie qu'un payload est
affiché brut. Asserter une formulation exacte aurait rendu le check faux au premier
réajustement de copie, sans rien garder de plus.

⚠️ **`N1` sépare deux appels que le serveur sert par la MÊME route.** Le compteur (`limit=1`) a
le droit de partir sur chaque page — c'est la pastille. La **liste** ne doit partir qu'à
l'ouverture du panneau, sinon elle part sur tous les écrans authentifiés. On les distingue par
leur paramètre, et le check navigue entre deux pages avant d'ouvrir quoi que ce soit.

⚠️ **`N4` recharge la page exprès.** Sans ce rechargement, le check prouverait un affichage
optimiste et pas une écriture serveur — le défaut serait invisible.

⚠️ **`N6` et `N7` gardent deux défauts de review** : `Escape` ne rendait pas le focus à la
cloche (avant FS-2 le panneau ne contenait aucun élément focalisable, c'est lui qui rend le
problème atteignable), et **rien ne signalait une notification sous 1024 px** — la pastille ne
vit que dans le rail, masqué à cette largeur.

## `fs4-messages` (FS-4) — un check vu FAUX VERT, puis rouge, puis vert

`scenarios/fs4-messages.mjs`, **8 checks**. La liste des conversations et les fenêtres multiples.

🚨 **`M5` garde un clic qui ne faisait rien**, atteignable par un simple `Ctrl +` : au-delà du
maximum de fenêtres, une conversation reste **ouverte dans l'état** mais n'est plus **affichée**,
et la garde « déjà ouverte » renvoyait l'état inchangé — aucune fenêtre, aucun focus, aucune
explication.

🔑 **ET IL A ÉTÉ VU FAUX VERT AVANT DE MARCHER — c'est la leçon de ce fichier.** Première
version : ouvrir un 3ᵉ interlocuteur pour faire céder le plus ancien, puis le recliquer. Ça ne
reproduit **rien** : l'éviction retire l'entrée de l'état lui-même, donc la garde est fausse et
le clic rouvre normalement. Vérifié en **réintroduisant le défaut dans le code** — le check
restait vert. Le seul chemin réel est un **changement de largeur** : l'état garde N
conversations, la largeur n'en affiche plus que M < N. Le check ouvre donc 3 fenêtres à
1600 px, rétrécit à 1280, et reclique la masquée. Il est désormais **rouge avec le défaut,
vert sans** — mesuré dans les deux sens.

⚠️ **La méthode vaut plus que le check** : quand un scénario garde un défaut de review, le
seul moyen de savoir qu'il le garde vraiment est de **remettre le défaut** et de le regarder
rougir. Trois faux verts ont été trouvés comme ça sur ce projet (`D15` de `dispute`, `S8` de
`fs0-social`, `C7` de `fs3-chat`) — celui-ci est le quatrième.

⚠️ **`M7` garde une contrainte, pas une préférence** : aucune fenêtre flottante sous 1024 px.
Le panneau mobile est une fenêtre modale faite main dont le gestionnaire d'`Escape` vit sur
`document` ; empiler une fenêtre par-dessus rejouerait ce piège. Le check compte les fenêtres
**au chargement et après ouverture** — 0 dans les deux cas.

⚠️ **Le harnais tourne à 1280 px par défaut**, donc `M4` (plafond de 2, la plus ancienne cède)
est la largeur nominale, et `M5` est le seul check du repo à changer de viewport **deux fois**.

## `fs3-chat` (FS-3) — compter les occurrences, pas constater une présence

`scenarios/fs3-chat.mjs`, **9 checks**.

🚨 **Le check central est un COMPTAGE, et c'est toute la différence.** Un message atteint
l'écran par **trois** chemins : l'historique REST, l'événement temps réel, et l'accusé d'envoi.
Asserter « le message est affiché » serait donc vert **même sur un doublon franc** — le défaut
n°1 que ce ticket pouvait produire. `C4`, `C5` et `C7` comptent les bulles portant le texte et
exigent **exactement 1**.

🔑 **`C7` A DÛ ÊTRE RÉÉCRIT PARCE QU'IL ÉTAIT VERT PAR CONSTRUCTION.** Sa première version
rouvrait la même conversation depuis la liste d'amis en croyant provoquer un rechargement. Elle
n'en provoquait aucun : depuis la review de FS-3 les trois panneaux du rail restent **montés**,
donc le composant n'est pas remonté et le cache répond. Le check ne mettait à l'épreuve
**aucune fusion**. Il passe désormais par le seul chemin où un message existe réellement dans
les deux sources à la fois — **couper le réseau, le rétablir, attendre le rechargement** — et
vérifie que les deux messages du run, déjà présents dans le tampon temps réel, n'apparaissent
pas deux fois une fois l'historique revenu. Le même check porte la **promesse centrale du
ticket** : le temps réel ne rejoue rien, seul ce rechargement rattrape la coupure. ⚠️ Il attend
le rechargement par son **effet réseau observable**, jamais par un délai fixe.

⚠️ **`C1` garde une propriété du RAIL, pas de l'écran** : le rail est monté sur toutes les pages
authentifiées, donc ce qu'il charge, il le charge partout. Aucune lecture d'historique ne doit
partir tant qu'aucune conversation n'est ouverte — onglet Messages vide compris.

⚠️ **`C3` garde une régression d'accessibilité trouvée en review** : le journal qui défile
n'avait ni `tabindex` ni nom accessible, donc la tabulation sautait de l'en-tête au champ de
saisie et **l'historique était illisible au clavier** — alors que le lire *est* la
fonctionnalité du ticket.

⚠️ **`C6` garde une conséquence de la review** : les trois panneaux restent montés (les
inactifs masqués), sinon un aller-retour vers l'onglet Amis reprenait le brouillon à zéro.

## `fs1-friends` (FS-1) — deux identifiants qu'on ne peut pas distinguer à l'écran

`scenarios/fs1-friends.mjs`, **9 checks**. `fs0-social` prouve le **transport** (une socket, la
présence, la reconnexion, le panneau mobile) et ouvre bien l'onglet Friends, mais il n'y clique
jamais rien : un vert de sa part ne dit rien du contenu de l'onglet.

🚨 **Le check central assert des STATUTS HTTP, pas l'écran, et c'est tout l'intérêt.**
`GET /friends` rend deux identifiants par ligne : celui de **l'ami** et celui de la **relation**.
`DELETE /friends/{id}` exige le second, `POST /blocks/{userId}` exige le premier. Les confondre
donne un 404 ou un 400 — donc une **ligne rouge en console**, motif de rejet du projet. Mais à
l'écran les deux chemins se ressemblent : la ligne peut disparaître sur un refetch alors que la
mutation a échoué. `F6` et `F7` relèvent donc le **statut réel de la réponse** (`200` et `201`),
et `F9` compte **tous** les 4xx du parcours. Un écran qui a l'air juste ne suffit pas ici.

⚠️ **`F5` ne se contente pas de « le focus n'est pas sur `<body>` ».** La première livraison
garait le focus sur un titre `sr-only` : hors de `<body>`, donc vert au critère habituel, mais
**invisible** — un utilisateur clavier voyant regardait l'anneau disparaître sans savoir d'où
repartirait son Tab. Le check mesure aussi que l'élément focalisé occupe une surface à l'écran.

⚠️ **`F8` garde la cohabitation des deux couches d'`Escape`.** Sous 1024 px, le panneau social
est un `aria-modal` fait main dont le gestionnaire d'`Escape` est posé sur `document`, et sa
garde cherche un attribut `[role="dialog"]` **qu'un `<dialog>` natif ne porte pas**. Sans
isolation, un seul `Escape` fermait la confirmation **et** le panneau entier. Le check exige que
la confirmation parte et que le panneau reste.

🔑 **Un rouge vécu à l'écriture, dans le CHECK et pas dans le code** : `F4` lisait
`document.activeElement` **immédiatement** après `Escape`, alors que le menu rend le focus à son
déclencheur à la **frame suivante** — délibérément, pour ne pas poser le focus sur un nœud que
React démonte. Le check attendait donc l'état d'avant et rougissait sur un composant correct.
Même famille que l'invariant #11 : **chercher l'attente manquante avant d'accuser l'application.**

## FS-0 — le chrome persistant doit rester hors des sélecteurs métier

Le rail social ajoute son propre `tablist` et son `tabpanel` sur toutes les pages authentifiées.
Les scénarios qui ciblent les onglets d'une page doivent donc partir de
`page.getByRole('main')`, comme `L7` de `ladder-detail` après F-Nav. Un scénario filtré sert à
itérer ; après un rebase, le ticket rejoue toujours la campagne complète, car de nouveaux
écrans peuvent avoir rejoint le shell depuis sa base précédente.

⚠️ Une attente attendue par un check devient un booléen avec `.catch(() => false)` : le check
rougit, le harnais ne sort pas en `exit 2`. `S1b` simule une rotation de token dans le vrai
store et exige zéro nouvelle socket. `S5` mesure les quatre marges de 12 px du panneau mobile,
son rayon de 8 px, le centrage des notifications, les deux Escape et la restitution du focus.

Après le second rebase, sur le `master` du 31/07 au soir, la campagne compte
**21 scénarios / 359 checks** et sort en **exit 0**, console **0 partout**. `matchmaking`
passe notamment **31/31** avec sa mesure à 375 px : le header mobile persistant de FS-0 ne
crée aucun débordement horizontal sur ce nouvel écran.

### 🚨 Trois pièges de HARNAIS que ce rebase a sortis — à connaître avant d'écrire un scénario

**① Ne jamais naviguer par un lien de la PAGE quand on veut prouver quelque chose sur le
CHROME.** `S1` cliquait `getByRole('link', { name: 'My teams' })` ; [F-HOME] a ajouté un
bouton « Go to my teams » dans le contenu de `/home`, le sélecteur en a trouvé deux et le
harnais est sorti en `exit 2`. Passer par
`page.getByRole('navigation', { name: 'Primary navigation' })`. La règle vaut dans les deux
sens : le chrome hors des sélecteurs métier (voir ci-dessus), **et** la page hors des
sélecteurs de chrome.

**② `import('/src/…')` depuis `page.evaluate()` ne rend PAS le module de l'application.**
C'est le piège le plus coûteux des trois, parce qu'il produit un rouge **intermittent** sur
du code parfaitement sain. Dès que le HMR de Vite a invalidé un module une seule fois depuis
le démarrage du serveur de dev — n'importe quelle écriture sous `frontend/`, un
`git checkout`, un rebase — l'application tourne sur `…/mon-module.ts?t=<horodatage>` tandis
que l'URL nue **construit une seconde instance vierge**. `S1b` lisait donc un store sans
session et échouait sur « access token absent », sur une app dont la session était
parfaitement ouverte. Diagnostic : `performance.getEntriesByType('resource')` montre les
**deux** URLs. Remède : résoudre l'URL réellement chargée (la plus récente) avant d'importer.
🔑 **Si un `page.evaluate` lit un état applicatif et le trouve vide, soupçonner le double
module AVANT de soupçonner l'application.**

**③ Viser un rôle, pas une balise, dès qu'une balise est réutilisable.** `S5` mesurait
`header:visible` ; le hero de `/home` est aussi un `<header>`. `getByRole('banner')` est
sans ambiguïté : le hero est **dans `<main>`**, et un élément sectionnant retire ce rôle à
son `<header>`. Même famille pour `<section>`, `<nav>` et `<aside>`.

### ⚠️ Un scénario qui rend `0/0` accuse la BASE, pas le ticket

`dispute` et `match-detail` sont sortis `0/0` pendant ce rebase. Aucun rapport avec FS-0 :
les comptes de fixture `alice`/`bob`/`carol` avaient perdu leur mot de passe en base, et les
matchs de démo du seed avaient expiré (le job de 24 h avait annulé la dispute, les créneaux
étaient passés). Ces deux scénarios sont **les seuls à se connecter avec un compte semé**
plutôt qu'avec un compte qu'ils créent — donc les seuls que l'état de la base peut mettre à
terre. Remède : `docker compose exec backend npm run seed:dev`. 🔑 **Un `0/0` n'est jamais
« rien à tester » : c'est un scénario qui n'a pas démarré.**

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
