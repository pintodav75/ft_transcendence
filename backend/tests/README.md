# Tests end-to-end (backend)

Scripts Python qui tapent sur le **vrai backend** et la **vraie base de dev** — pas de mocks.
Ils créent leurs propres utilisateurs et **les suppriment à la fin** : les données de
l'équipe (seed-dev, comptes perso) ne sont **jamais** touchées.

**9 suites, 206 cas.** Aucune dépendance à installer : uniquement la stdlib Python 3.

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

⚠️ **Le run complet prend ~15 min**, et c'est presque uniquement de l'**attente** : `register`
est rate-limité à 3/min, et `helpers.py` patiente 20 s à chaque fois qu'il se le prend. Lance-le
en tâche de fond plutôt que de le regarder tourner.

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

Il existe aussi des **tests unitaires Vitest** pour les helpers purs (sans DB ni HTTP) :
`tests/unit/` (elo, leaderboard, password) → `cd backend && npm test`.

## Détails utiles

- **`helpers.py`** contient le client HTTP, `register()` (qui **réessaie tout seul** sur le
  rate-limit de 3/min), l'accès SQL et le nettoyage. `ROOT` est déduit de `__file__` — **jamais
  de chemin en dur**, sinon les tests ne tournent que sur la machine de leur auteur.
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
