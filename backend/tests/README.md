# Tests end-to-end (backend)

Scripts Python qui tapent sur le **vrai backend** et la **vraie base de dev** — pas de mocks.
Ils créent leurs propres utilisateurs et **les suppriment à la fin** : les données de
l'équipe (seed-dev, comptes perso) ne sont **jamais** touchées.

**20 suites** (run complet du 27/07). Aucune dépendance à installer : uniquement la
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
| `test_matches_me.py` | B5c | `GET /matches/me` : les 2 sources (participant **et** team engagée), **le remplaçant sur le banc**, la déduplication, `[]` si aucun match |
| `test_matches_detail.py` | B5c | `GET /matches/:id` enrichi : objet `team` + `players`, `null` en solo, sides triés, garde 403, **aucune fuite** de champ privé |
| `test_matches_concurrency.py` | B5c (review) | **Courses réelles, avec threads** : double accept, acceptation croisée (interblocage), double création, et la fuite d'autorisation du `DELETE` |
| `test_matches_scheduling.py` | B5d | **Le temps** : grille horaire (quart fixe + 15 min), **fenêtres de disponibilité** (chevauchement interdit mais **dos à dos autorisé**), la « soirée gaming » (plusieurs slots qui coexistent), **l'option A resserrée** (les slots non chevauchants SURVIVENT à l'accept), l'expiration, le plafond de 5, et le **job** |
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
