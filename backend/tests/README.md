# Tests end-to-end (backend)

Scripts Python qui tapent sur le **vrai backend** et la **vraie base de dev** — pas de mocks.
Ils créent leurs propres utilisateurs et **les suppriment à la fin** : les données de
l'équipe (seed-dev, comptes perso) ne sont **jamais** touchées.

**21 suites** (`test_matches_open_slots.py` ajoutée le 30/07 par B-MM ; les 9 suites matchmaking rejouées vertes ce jour-là, run complet des autres du 27/07). Aucune dépendance à installer : uniquement la
stdlib Python 3.

## Lancer

```bash
docker compose up -d                                   # depuis la racine du repo
docker compose exec backend npx drizzle-kit migrate    # si migrations en retard

cd backend/tests
python3 run_all.py                   # toutes les suites
python3 test_matches_concurrency.py  # une seule suite
```

Les chemins sont déduits de l'emplacement des fichiers : ça tourne **depuis n'importe quel
dossier, sur n'importe quelle machine**. `TEST_BASE_URL` permet de viser un autre backend.

**Le run complet ne dort plus** (il prenait ~15 min, presque uniquement d'attente sur le
rate-limit de `register`). Voir « Détails utiles » pour le pourquoi et ses garde-fous.

## Les suites

| Fichier | Ticket | Ce qui est couvert |
|---|---|---|
| `test_matches_create.py` | B5b | `POST /matches` : les 8 gardes de `validateSide` (§5.1 compte lié, lineup, capitaine, roster, §5.2 lockout), l'anonymat de `GET /matches`, le détail réservé aux participants, le tirage des 3 maps |
| `test_matches_lockout.py` | B5b | §5.2 côté solo : seuls les matchs **actifs** verrouillent ; `completed`/`cancelled` libèrent aussitôt |
| `test_matches_cancel.py` | B5c | `DELETE /matches/:id` : capitaine (team) / participant (solo), 403, 404, 400, 409, idempotence, effets de bord |
| `test_matches_accept.py` | B5c | `POST /matches/:id/accept` : les 2 modes (team / solo), l'**auto-accept refusé dans les deux formats**, le lockout enfin armé, l'annulation des slots ouverts des 2 camps |
| `test_matches_me.py` | B5c · B-SOLO | `GET /matches/me` : les 2 sources (participant **et** team engagée), **le remplaçant sur le banc**, la déduplication, `[]` si aucun match. **B-SOLO** : le payload enrichi (`opponent` polymorphe joueur/équipe, `score`, `result`, `eloDelta`, `format`/`gameId`), le filtre `?ladderId=` (dont 400 sur uuid malformé), et surtout les 2 cas **inatteignables par le seed** — équipe adverse **dissoute** après un 2v2 terminé et adversaire de 1v1 ayant **supprimé son compte**, qui doivent rendre `opponent: null` et **jamais** un joueur |
| `test_matches_detail.py` | B5c/B16 | `GET /matches/:id` enrichi : objet `team` + `players`, `null` en solo, sides triés, garde 403, **aucune fuite** de champ privé. **B16** : objet `ladder` (nom du ladder ET du jeu, lus en base — jamais recopiés dans le test) servi à côté de `ladderId` qui, lui, ne bouge pas ; `submittedScoreSelf`/`submittedScoreOpponent` `null` sur un `in_progress`, renseignés côté soumetteur seulement après un `POST /result` (vus RED avant le fix) |
| `test_matches_concurrency.py` | B5c (review) | **Courses réelles, avec threads** : double accept, acceptation croisée (interblocage), double création, et la fuite d'autorisation du `DELETE` |
| `test_matches_scheduling.py` | B5d | **Le temps** : grille horaire (quart fixe + 15 min), **fenêtres de disponibilité** (chevauchement interdit mais **dos à dos autorisé**), la « soirée gaming » (plusieurs slots qui coexistent), **l'option A resserrée** (les slots non chevauchants SURVIVENT à l'accept), l'expiration, le plafond de 5, et le **job** |
| `test_matches_open_slots.py` | B-MM | `GET /matches` enrichi : `ladderId` devenu **optionnel** (balayage multi-ladders) sans casser le mode d'origine (401 anonyme, 400 malformé, **404** sur un ladderId inconnu), l'**enrichissement** par jointure (`ladderId`/`ladderName`/`gameName`, noms **lus en base** et non recopiés) avec l'**anonymat B5b toujours vérifié en liste noire**, le tri `scheduledAt` croissant, l'exclusion des créneaux **périmés** et des **siens** (par ÉQUIPE en 2v2+ — y compris pour un simple membre —, par JOUEUR en 1v1), et les filtres `gameId` (slug inconnu → liste vide, **pas** 404) / `format` / `acceptable` / `limit` avec leurs 400. 🔑 **Le cœur de la suite : le verdict `canAccept` est confronté à la réalité.** Les **6** codes de l'enum fermé (`account_not_linked`, `no_team`, `not_captain`, `roster_too_small`, `roster_not_linked`, `schedule_conflict` — les deux `roster_*` sont **distincts à dessein** : « recruter » et « faire lier les comptes » sont deux remèdes, et les fusionner faisait lire un conseil inapplicable, défaut trouvé en review et **vu ROUGE avant vert**) sont chacun reproduits en **CAS NÉGATIF** puis suivis d'un `POST /matches/{id}/accept` qui doit rendre le **même** refus (400/403/409) — un `canAccept` qui mentirait est pire que pas de champ du tout. Chaque refus a son **contrôle POSITIF** (accept qui rend 200 après avoir levé la cause : compte lié, roster complété, créneau hors fenêtre), sans quoi un `canAccept` câblé à `False` passerait tous les tests. Couvre aussi le fait qu'un paramètre **présent mais vide** (`?gameId=`, sur les 5) vaut « absent » et rend **200** — un 400 y laisserait une ligne rouge en console — **sans** relâcher les vraies valeurs invalides (`?acceptable=1` reste 400), et que le slot `pending` de **mon propre camp** ne compte pas comme conflit, **en 1v1 ET en 2v2+** (deux sources de conflit distinctes). ⚠️ Aucune assertion sur la **taille** des listes : la base de dev porte les créneaux de `seed-dev` |
| `test_teams_linked.py` | B5c | `hasLinkedAccount` par membre dans `GET /teams/:id` + `unlinkedPlayers` dans le 400 |
| `test_teams_invitations.py` | B-INV | Le cycle **invitation** qui remplace l'ajout forcé : `POST /teams/:id/members` **n'existe plus** (404), inviter / annuler (capitaine), accepter / refuser (l'invité), `GET /teams/invitations/me`. L'invité **n'est pas membre** tant qu'il n'a pas accepté ; l'acceptation **annule** ses autres invitations du ladder (`cancelled`, pas `declined`) — **et `POST /teams` aussi** (créer son équipe rend la place au plafond des équipes qui l'avaient sollicité) ; refus et annulation **libèrent la place** et une ré-invitation redevient possible (index unique **partiel**). Plafond `membres + en attente ≤ 10` refusé à l'invitation **et** re-vérifié **sous verrou** à l'acceptation. `GET /teams/:id` expose `invitations` aux **membres seulement** (`isMember`, champ absent pour un visiteur). Dissolution → cascade. Blocage honoré (`isBlocked` → 404 indistinguable, dans les 2 sens). Un invité **non acceptant n'est pas alignable** en match (400 + contrôle positif après acceptation). **4 courses à `threading.Barrier`, répétées** (une course ne se déclenche pas à tous les coups) : 2 **intra-équipe** — sans le verrou d'équipe le roster monte à **11** —, 1 **inter-équipes** (le même joueur accepté par 2 équipes du même ladder), qui **interbloquait 8/8** avant les verrous TRIÉS `team:` + `user:<id>:<ladder>` → 500 au lieu de 409, et 1 **dissolution × acceptation** qui ⚠️ **ne sort JAMAIS avec une barrière seule** : elle exige de **balayer un décalage** (0 → 11 ms, un tour par pas) et tombe à 5 ms, avec le **capitaine** en victime du 500 (piège #21). Les trois ont été **vues rouges avant d'être vertes**. Contient aussi le **tripwire de `helpers.join_team()`** (portée réelle décrite plus bas) |
| `test_teams_logo.py` | FT-1C | `POST /teams/:id/logo` : garde **capitaine only** (un membre simple est refusé), 401 **avant** 400, les 4 refus d'entrée (uuid, non-multipart, aucun fichier, **PDF refusé** — `IMAGE_MIME` ≠ `EVIDENCE_MIME`), cas nominal + **persistance**, et les **3 chemins qui déréférencent un logo** — remplacement par un nouvel upload, `PATCH {logoUrl: null}`, `DELETE /teams/:id` — dont on vérifie **dans le bucket** que l'objet a bien disparu (les 2 derniers fuyaient) |
| `test_teams_matches.py` | B15 | `GET /teams/:id/matches` : forme **membre** (tout, `lineup` inclus, slot ouvert visible) vs **non-membre** (seuls les matchs à 2 sides, `lineup` **absent**), `disputeId`/`disputeStatus` exposés **sans condition de statut** (badge litige qui survit à l'arbitrage admin), `score` qui reste `null` des 2 côtés après arbitrage (B14), tri `scheduledAt` DESC avec **`NULLS LAST`** (état forcé en SQL), gardes 401/400/404. Couvre aussi la garde **relâchée** de `GET /matches/:id` (403 sauf `completed` → 200) et `competitor.id` exploitable sur `GET /ladders/:id/rankings` (les 2 types `user`/`team`) |
| `test_matches_result.py` | B6/B14 | `POST /matches/:id/result` : machine à états §5.4 (accord → `completed` + ELO, désaccord → `disputed`), §5.3, et les 2 jobs 24 h (`B6_JOBS=1`). **B14** : score Bo3 (`scoreSelf`/`scoreOpponent`, `WINS_REQUIRED=2`) hors bornes ou incohérent avec `winnerSideId` → 400 ; **même vainqueur, score différent (2-0 vs 2-1) → `disputed`** (vérifié RED avant le fix) ; `score`/`eloDelta`/`eloAfter` persistés sur les 2 `match_sides` à l'accord ; re-soumission qui écrase aussi les scores (le dernier score fait foi) ; le job d'auto-confirmation persiste le score du camp silencieux **dans les 2 sens** (soumetteur vainqueur ET soumetteur perdant — `submitterWon` remappé correctement des deux côtés, `jobs/index.ts`) |
| `test_disputes.py` | B7/B14 | Les 4 routes `/disputes` : dépôt de preuve (garde de camp **avant** de révéler l'état, bornes multipart, bucket privé + URL présignée), arbitrage admin, job d'annulation neutre (`B7_JOBS=1`). **B14** : sur l'arbitrage admin, `score` reste `NULL` (l'admin tranche un vainqueur, pas un score) mais `eloDelta`/`eloAfter` sont bien écrits |
| `test_notifications.py` | B9/B14 | Les 8 déclencheurs et leurs **destinataires** (alignés sauf l'acteur, banc exclu, admins), la pagination par curseur, `read`/`read-all` idempotents (`B9_JOBS=1`). Body `POST /matches/:id/result` mis à jour avec `scoreSelf`/`scoreOpponent` (B14) — non-régression des notifs |
| `test_search.py` | SEARCH | `GET /search` : **tri global entrelacé** (une team avant un joueur), pagination de la liste **fusionnée** sans trou ni doublon, filtre `type`, casse et **Unicode** (`İ`), échappement des jokers, blocages dans les 2 sens, projection |
| `test_sentinel.py` | FT-1C | **Sentinelle : tourne en 1ʳᵉ et ARRÊTE le run si elle échoue.** Le token forgé par `helpers.forge_token()` est-il toujours accepté (200 sur `GET /users/me`, bon `sub`, bonne ligne SQL) — et la réciproque : mauvaise signature / type `refresh` / expiré → **401** |
| `test_auth_contract.py` | FT-1C | `POST /auth/register` et `POST /auth/login` **par la vraie route** : nominal, projection, normalisation de l'email, les 3 règles Zod en un appel, 409, 401 indistinct, les **vrais 429 des deux routes**, l'**équivalence SQL** entre un user semé et un user inscrit, plus le compteur **par compte** de `/auth/2fa/verify` (B12) et le **204 vs 401** de `/auth/refresh` (B13) |
| `test_users_deletion.py` | BX-DEL | `DELETE /users/me` : un match **terminé** ne bloque plus (c'était un 500, FK `restrict`), un match non terminé rend **409 `engaged_in_match`** — aligné dans une compo **ou** capitaine d'une équipe engagée, avec son contrôle positif (match annulé → 200, membre non aligné → 200). Vérifie surtout qu'une suppression **ne détruit aucun résultat** : match, camps, vainqueur, score et delta d'Elo intacts, seule la ligne de composition part en cascade |

Il existe aussi des **tests unitaires Vitest** pour les helpers purs (sans DB ni HTTP) :
`tests/unit/` (elo, leaderboard, notifications, password, **rate-limit**) → `cd backend && npm test`.

⚠️ `rate-limit.test.ts` verrouille la **forme** de la clé de compteur (`u:<sub>` si authentifié,
`ip:<ip>` sinon) ; les deux cas e2e de `test_auth_contract.py` prouvent, eux, qu'elle est
**réellement branchée** sur le chemin global. Les deux sont nécessaires : l'un sans l'autre
laisse passer un `keyGenerator` correct mais jamais appelé.

⚠️ Même partage des rôles pour `twoFactorVerifyRateLimitKey` (B12) : l'unitaire verrouille la
**forme** de la clé (`u:<sub>` si le tempToken est valide et `pending: 'totp'`, `ip:<ip>` en
repli), et il ne peut rien dire de plus — un `keyGenerator` correct mais jamais branché passe
tous ses cas. Le **câblage** est prouvé e2e dans `test_auth_contract.py`, section « le compteur
est-il par COMPTE (B12) ? » : 6 essais sur un même compte → 429, puis un autre compte depuis la
**même IP** qui garde son quota. Elle ne crée aucun user (tempToken forgé par
`helpers.forge_temp_token()` sur un uuid inexistant : 401 côté handler, mais compté).
⚠️ `POST /auth/2fa/verify` a **deux compteurs** : 5/min **par compte**, appelé dans le handler et
**uniquement** quand la requête porte un tempToken exploitable, et un plancher de 30/min par IP
(hook `onRequest`) qui borne tout le reste. En tenir compte avant d'ajouter des appels ici.

## Détails utiles

- **`helpers.py`** contient le client HTTP, `register()`, `join_team()`, l'accès SQL et le
  nettoyage. `ROOT` est déduit de `__file__` — **jamais de chemin en dur**, sinon les tests ne
  tournent que sur la machine de leur auteur.
- 🔑 **`join_team()` sème les rosters en SQL** (comme `register()` sème les users). Depuis
  **B-INV**, `POST /teams/{id}/members` **n'existe plus** : peupler une équipe par l'API
  demanderait `POST /teams/{id}/invitations` **puis** `POST /teams/invitations/{id}/accept`
  avec le token du joueur — deux appels par membre et surtout **deux notifications parasites**
  qui fausseraient les comptages de `test_notifications.py`. Les suites matchmaking ne testent
  pas le recrutement : elles ont besoin d'un roster, pas d'un parcours. Le cycle d'invitation
  est couvert **par l'API, pour de vrai**, dans `test_teams_invitations.py`. ⚠️ **Portée
  honnête du tripwire** qui y compare la ligne née d'une **acceptation** à une ligne **semée** :
  `team_members` n'ayant que 5 colonnes, dont 4 forcément différentes (`id`, `team_id`,
  `user_id`, `ladder_id`), il ne prouve aujourd'hui que `joined_at` renseigné des deux côtés —
  ce n'est **pas** l'équivalence complète que `test_auth_contract.py` établit pour
  `register()`. Sa valeur est **future** : le jour où une colonne s'ajoute (rôle, `invited_by`,
  statut…) et que seule l'API la remplit, il vire au rouge — et c'est le HELPER qu'on corrige,
  pas une exclusion qu'on ajoute.
- 🔑 **`register()` NE PASSE PLUS par `POST /auth/register`** : il insère l'user en SQL puis
  **forge lui-même** son access token (`forge_token()`). Pourquoi : la route est à **3/min par
  IP** et elle le **reste** — y faire passer les dizaines d'users des suites coûtait **~15 min
  d'attente par run**, à chaque itération du codeur puis du reviewer. **Rien n'est désactivé ni
  configuré côté serveur** : un checkout propre + `docker compose up` donne un rate limit
  strict, et il n'existe aucun interrupteur pour l'affaiblir. Les tests ont simplement cessé
  d'emprunter une route dont ils ne testaient pas le contrat.
- ⚠️ **Le couplage que ça crée, et les DEUX garde-fous qui le surveillent.** `forge_token()`
  duplique la forme du token de **`backend/src/auth/tokens.ts`** : HS256, secret `JWT_SECRET`
  lu dans le `.env` de la racine, claims `{sub, type:'access', iat, exp}`, TTL 15 min. Si
  `tokens.ts` change, **toutes** les suites tombent en 401.
  1. **`test_sentinel.py` tourne en premier et interrompt le run** : le diagnostic est « le
     helper a dérivé », en une seconde, au lieu de 17 suites rouges. **Si la sentinelle est
     rouge, corrige `helpers.forge_token()` — pas les suites.**
  2. La sentinelle ne valide que le TOKEN. L'**équivalence de l'USER** est vérifiée dans
     `test_auth_contract.py`, qui compare **en SQL** un user inscrit par l'API et un user semé :
     toutes les colonnes (en jsonb, donc une colonne ajoutée demain est couverte
     automatiquement) **et** le nombre de lignes pointant sur lui dans **chaque** table ayant
     une FK vers `users` (lue dans le catalogue postgres). Si `register` se met à créer une
     ligne ailleurs — préférences, ELO initial, table de sessions — c'est ce cas qui le dit, et
     c'est un **vrai positif** : on fait créer le même effet de bord à `helpers.register()`, on
     n'ajoute pas une exclusion.
  Les users semés portent `FIXTURE_HASH`, vrai hash bcrypt **cost 12** (celui de
  `hashPassword()`) de `FIXTURE_PASSWORD` : ils peuvent se **logger** normalement, et
  `test_auth_contract.py` le vérifie.
- ⚠️ **Le rate-limit global est indexé sur l'UTILISATEUR** (100/min), plus sur l'IP — sauf pour
  les routes anonymes, qui restent par IP. Sans ça, les suites devenues rapides saturaient
  100 req/min à elles seules et se prenaient des 429 en cascade (symptôme trompeur : un
  `TypeError` dans `ladder_id()`, parce qu'un corps de 429 n'a pas la forme attendue).
- ⚠️ **`req()` n'encode QUE du JSON.** Pour un upload, utiliser **`req_multipart(method, path,
  token, files=[(champ, nom, octets, mime)], fields=[(champ, valeur)])`** : même gestion du
  Bearer et du contexte SSL, corps multipart encodé à la main (stdlib seule).
- ⚠️ **Les routes d'upload sont rate-limitées à 20/min PAR COMPTE** (avatar, logo d'équipe) :
  elles sont authentifiées, donc le `keyGenerator` global indexe sur le `sub` du JWT, et
  répartir les uploads sur alice/bob/carol multiplie d'autant le budget. Au-delà, une suite
  doit absorber les 429 (cf. `_post_logo()` dans `test_teams_logo.py`), sinon elle échoue sur
  un 429 au lieu du code attendu. Les routes **anonymes** sont bien plus serrées —
  `register` 3/min, `login` 5/min, `2fa/verify` 5/min, **par IP** — et c'est volontaire.
- ⚠️ **`future()` arrondit AU QUART SUPÉRIEUR** depuis B5d. Le back refuse toute heure hors
  `:00`/`:15`/`:30`/`:45` (400) et à moins de 15 min du coup d'envoi. Une heure « naïve »
  (`now + 1h`) tombe presque toujours à côté de la grille → 400. **Toujours passer par
  `future()`** ; si tu construis une date à la main dans un test, aligne-la.
- ⚠️ **Tester une course sans barrière ne prouve RIEN.** Deux threads lancés à la suite
  démarrent en décalé et ne se croisent jamais : le test passe alors que le bug est bien là.
  C'est un **faux négatif**, pire qu'aucun test — l'interblocage de l'acceptation croisée a été
  masqué comme ça au premier essai. Utilise `threading.Barrier` pour que les requêtes partent au
  même instant, et **répète** : une course ne se déclenche pas à tous les coups.
- **Pas de `Content-Type` sans body.** Fastify renvoie sinon un `400
  FST_ERR_CTP_EMPTY_JSON_BODY` avant même d'entrer dans la route — piège classique sur les
  `DELETE`. `helpers.req()` le gère.
- **Certains états ne sont pas atteignables par l'API** (un match `completed`, par exemple, tant
  que B6 n'existe pas). Les tests les **forcent en SQL** via `sql()`, puis vérifient la réaction
  de l'API. ⚠️ Toujours restreindre ces `UPDATE` aux users de test — jamais un `where status=...`
  nu, qui écraserait les données de l'équipe.
- Le nettoyage ne supprime que les users dont le pseudo matche
  `^(alice|bob|carol|dave|erin)[0-9a-f]{8}$` — le suffixe hexa garantit qu'on ne touche
  pas aux `alice`/`bob` du seed-dev.

---

## État de la campagne d audit — bloc déporté de `CLAUDE.md` (refacto du 31/07)

> Ce paragraphe vivait sur **une seule ligne de 5,2 Ko** dans `CLAUDE.md`. Rapatrié ici verbatim.

- **Tests** : `npm run audit` (audit console Chrome) sort **0 sans filtre** depuis FT-2A — **19 scénarios, 329 checks** (campagne rejouée verte après F-DISPUTE le 31/07, `EXIT=0` lu sur le **process**, sortie capturée dans un fichier et non passée dans un `tail`). 🔑 **F-DISPUTE a produit QUATRE faux verts, tous trouvés en review, aucun par les checks eux-mêmes** — c'est le meilleur inventaire du repo sur cette famille de défaut : ① `D15` comptait les `<img>` d'une ligne PDF, or le propre `onError` du composant retirait l'image **avant** la lecture du DOM → réécrit pour compter la **requête** vers l'objet `.pdf`, qu'aucun gestionnaire ne peut reprendre, avec un **témoin positif** (`D15b` : la vignette PNG **doit** être demandée) ; ② `D19` visait `h2:has-text("Next up") ~ a`, qui résout **0 élément** parce que `SectionTitle` enferme son `<h2>` dans un `<div>` — la carte vedette, seul site d'appel portant un `ariaLabel`, n'était **jamais** inspectée ; ③ le scénario forgeait son dossier « arbitré » **sans poser `resolved_by_user_id`**, donc le contrat le lisait comme un **timeout** : deux checks auditaient l'arbitrage humain sur une donnée qui n'en était pas un ; ④ `D19` n'a tenu que grâce à **5 lignes dont 3 venaient des créneaux de démo posés à la main par un coéquipier** (`bbbb2222-…`) — la dépendance exacte que [FX-AUDIT] interdit, supprimée en rendant la liste facultative. 🔑 **Leçon transverse : un check vert du premier coup ne prouve rien** — casser volontairement ce qu'il garde et le **voir rouge** est la seule vérification qui vaille. 🚨 **[FX-AUDIT] mergé le 31/07** (https://trello.com/c/lodPG1SU, commit `449c6a4`, merge `91325b7`) : **`/matchmaking` est un tableau GLOBAL et la base de dev est PARTAGÉE**, or `matchmaking.mjs` supposait être seul à tenir un créneau sur son ladder (`filter({ hasText: ladderName })`). Un coéquipier ayant ouvert 4 créneaux de démo à la main le 30/07 (uuids `bbbb2222-…`), le sélecteur a résolu **2 lignes**, Playwright a levé, et la campagne complète sortait en **`exit 2` pour TOUT LE MONDE** — un harnais en échec, qui se lit comme un problème d'environnement. 🔑 **Le défaut n'était pas la donnée du coéquipier, c'était le sélecteur** : rien n'a été purgé en base. Chaque créneau ouvert par le run **s'enregistre** (`registerSlot`) et `rowOf()` ne regarde que les lignes dont **le coup d'envoi** est l'un des siens — le seul discriminant disponible, puisque l'anonymat B5b interdit tout nom sur cette ligne. Les 18 appels existants n'ont pas bougé. ⚠️ **§14 est passé d'un `now() + interval '16 minutes'` à un instant ABSOLU** calculé côté Node : un intervalle SQL empêchait le run de connaître le libellé affiché de son propre créneau. ⚠️ **`MM8b` comptait un message sur toute la PAGE** alors que chaque ligne d'un format d'équipe le rend — même cause racine, scopé à sa ligne. ⚠️ Si `formatMatchDate` change de style, les lignes résolvent à **0** : les checks sortent **ROUGES**, jamais en `exit 2` — c'est le mode d'échec voulu. 🔑 **Leçon générale : un scénario ne doit jamais supposer qu'il est seul sur la base de dev** — on peut tous y créer des données à la main. ⚠️ **L'audit tourne sur l'HÔTE, jamais dans le conteneur front** : Chromium vit dans `~/.cache/ms-playwright`, `docker compose exec frontend npm run audit` sort « Aucun Chromium trouvé » — et le message est assez discret pour passer pour un vert si on ne lit que le code de sortie du wrapper. ⚠️ **Ce run-là est sorti `exit 2` la première fois, et ce n'était PAS une régression** : le job d'auto-confirmation 24 h avait fermé le match de démo `awaiting_confirmation` pendant la session, or `match-detail` exige les 7 états cs2 → `docker compose exec backend npm run seed:dev` avant toute campagne, **le seed se périme tout seul** (FX-FOCUS a ajouté 5 checks de focus, tous **au clavier**). 🔑 **UNE seule région live `role="status"` par écran** (FX-FOCUS) : deux se disputent la lecture, et un sélecteur `[role="status"]` en `.first()` prend la première venue — les `Callout` ne portent plus le rôle, l'annonce passe par `lib/use-announcement.ts`. ⚠️ Une région live est **montée en permanence**, donc `waitFor()` sur sa seule présence n'attend RIEN : passer par **`awaitAnnouncement(texte)`** (invariant #11). ⚠️ **`run.mjs` accepte un nom de scénario en argument** : pendant qu'on itère on filtre, la suite complète ne se lance **qu'à la fin** — une passe complète pilote un vrai Chrome sur 10 parcours (~4 min depuis `RATE_LIMIT_FACTOR`) et c'est le poste de temps dominant d'un ticket front. Vitest 27/27 (helpers purs) + **20 suites e2e Python** (`test_matches_me.py` porté de 23 à **65 checks** par B-SOLO). ⚠️ **`helpers.register()` REFUSE désormais un tag hors `alice|bob|carol|dave|erin`** : `cleanup()` ne sait supprimer que ce motif, donc tout autre tag laissait ses comptes en base de dev — on échoue à la création, là où la cause est lisible, plutôt qu'en silence au nettoyage (`cd backend/tests && python3 run_all.py`), sans mocks, sur la vraie base de dev. ⚠️ Les users de test sont **semés en SQL** avec un token forgé (la route `register` reste à 3/min, rien n'est désactivé) : `test_sentinel.py` garde ce couplage, `test_auth_contract.py` couvre la vraie route. → `backend/tests/README.md`
