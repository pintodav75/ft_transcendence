# Schéma de données — domaine jeu

> Document de référence du modèle relationnel pour la partie compétitive de ft_transcendence.
> Toutes les décisions structurantes sont notées avec leur justification.
> À jour au 25 juin 2026 (étape 5.5 — design pré-implémentation).

---

## 1. Vue d'ensemble

La plateforme supporte **5 jeux** et **9 ladders** (compétitions = jeu × format). Les utilisateurs lient leurs comptes in-game par **provider** (1 compte Riot couvre LoL + Valorant). Ils créent des **teams** rattachées à un ladder spécifique, jouent des **matches** dont les résultats sont auto-soumis par les deux camps, et un système de **disputes** gère les désaccords. Chaque ladder a son **classement ELO** indépendant, calculé sur des **users** (1v1) ou des **teams** (formats à plusieurs).

### Diagramme des relations

```
                     ┌──────────────┐
                     │    users     │ ◄────────────────┐
                     └──────┬───────┘                  │
                            │                          │
              ┌─────────────┼──────────────┐           │
              │             │              │           │
              ▼             ▼              ▼           │
   ┌────────────────────┐ ┌──────────┐ ┌────────┐     │
   │ user_external_     │ │  teams   │ │team_   │     │
   │   accounts         │ └────┬─────┘ │members │ ────┘
   │ (provider, ext_id) │      │       └────┬───┘
   └────────────────────┘      │            │
              ▲                ▼            ▼
              │           ┌──────────┐   ┌────────┐
              │           │ladders   │   │ladders │
              │           └────┬─────┘   └────────┘
              │                │
   ┌──────────┴────┐           │
   │   games       │ ◄─────────┘
   │ (required_    │           │
   │   provider)   │           │
   └───────────────┘           ▼
                         ┌──────────┐
                         │ matches  │
                         └────┬─────┘
                              │
                              ▼ (2 par match)
                         ┌──────────────┐         ┌──────────┐
                         │ match_sides  │────────►│  teams   │
                         └────┬─────────┘ (opt.)  └──────────┘
                              │
                              ▼
                         ┌──────────────────┐
                         │match_participants│────► users
                         └──────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
        ┌──────────┐                  ┌──────────────┐
        │disputes  │ ◄────────────────│dispute_      │
        └──────────┘                  │ evidence     │
                                      └──────────────┘

                                      ┌──────────────┐
                                      │  rankings    │ (user XOR team par ladder)
                                      └──────────────┘
```

---

## 2. Enums Postgres

Tous les enums sont déclarés au niveau de la DB pour garantir l'intégrité et la cohérence inter-tables.

| Enum | Valeurs |
|---|---|
| `provider_enum` | `'riot'`, `'steam'`, `'epic'`, `'chess_com'` |
| `format_enum` | `'1v1'`, `'2v2'`, `'3v3'`, `'5v5'` |
| `match_status_enum` | `'pending'`, `'in_progress'`, `'awaiting_confirmation'`, `'completed'`, `'disputed'`, `'cancelled'` |
| `dispute_status_enum` | `'open'`, `'resolved'` |
| `dispute_resolution_enum` | `'side_0_wins'`, `'side_1_wins'`, `'cancelled'` |

---

## 3. Tables

### 3.1 `users` (ajout par rapport à l'existant)

Une **seule** colonne à ajouter à la table existante :

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `is_admin` | `boolean` | NOT NULL DEFAULT `false` | Marque les comptes admin (résolution des disputes) |

Le reste de la table users est inchangé (id, pseudo, email, password_hash, displayName, bio, avatarUrl, oauth_provider, oauth_id, totp_secret, totp_enabled, created_at, updated_at).

---

### 3.2 `games`

Catalogue des jeux supportés. Source de vérité pour "qu'est-ce qu'un jeu valide" et "quel provider d'ID il utilise".

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `text` | PRIMARY KEY | Slug du jeu (`'lol'`, `'cs2'`, `'val'`, `'rl'`, `'chess'`) |
| `name` | `varchar(50)` | NOT NULL | Nom affichable (`'League of Legends'`) |
| `required_provider` | `provider_enum` | NOT NULL | Provider d'identifiant in-game requis pour s'inscrire |
| `is_active` | `boolean` | NOT NULL DEFAULT `true` | Soft-disable d'un jeu sans le supprimer |
| `created_at` | `timestamp tz` | NOT NULL DEFAULT NOW | Audit |

**Choix structurants** :
- `id` est un **slug en `text`**, pas un uuid. Les jeux sont peu nombreux et stables, et un FK lisible (`'lol'`) vaut mieux qu'un uuid opaque.
- `required_provider` est en enum (pas en text libre) pour garantir la cohérence avec `user_external_accounts.provider`.

**Données initiales** (seed) :

```
id      name                    required_provider
─────────────────────────────────────────────────
lol     League of Legends       riot
cs2     Counter-Strike 2        steam
val     Valorant                riot
rl      Rocket League           epic
chess   Chess                   chess_com
```

→ `lol` et `val` partagent le même provider `riot` : un seul compte Riot couvre les deux jeux côté `user_external_accounts`.

---

### 3.3 `user_external_accounts`

Lie un user à ses identifiants en jeu, **un compte par provider**. Un user a 0 à N lignes (une par provider qu'il a lié).

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK DEFAULT randomUUID | |
| `user_id` | `uuid` | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `provider` | `provider_enum` | NOT NULL | Même enum que `games.required_provider` |
| `external_id` | `text` | NOT NULL | L'identifiant in-game (`'Alice#EUW'`, Steam ID 17 chiffres, etc.) |
| `verified` | `boolean` | NOT NULL DEFAULT `false` | `false` = saisi manuellement (MVP) ; `true` = lié via OAuth (futur) |
| `created_at` | `timestamp tz` | NOT NULL DEFAULT NOW | |
| `updated_at` | `timestamp tz` | NOT NULL DEFAULT NOW + `$onUpdate` | |

**Contraintes** :
- `UNIQUE(user_id, provider)` : un user a **un seul** compte par provider.
- **Pas de UNIQUE sur `external_id`** : deux users peuvent saisir le même ID tant que personne n'est `verified`. C'est intentionnel — la résolution se fera plus tard via OAuth.

**Choix structurants** :
- Une table dédiée plutôt que des colonnes sur `users` : évite les NULL, extensible sans migration de la table users.
- Le champ `verified` est prévu **dès maintenant** pour ne pas avoir à migrer plus tard quand on implémentera OAuth in-game.

**Règle applicative** :
> Pour s'inscrire à un match d'un game `G`, l'user doit avoir une ligne avec `provider = G.required_provider`. Si absent → 400 "Lie ton compte X avant de jouer".

Cette règle vit en code, pas en contrainte DB (elle dépend du contexte d'un match qui n'existe pas au moment de l'INSERT dans cette table).

---

### 3.4 `ladders`

Une compétition = un classement ELO indépendant = un couple (jeu, format). 9 ladders au total.

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `game_id` | `text` | NOT NULL, FK → games(id) ON DELETE RESTRICT | RESTRICT pour préserver l'historique en cas de suppression d'un jeu |
| `format` | `format_enum` | NOT NULL | `'1v1'`, `'2v2'`, `'3v3'`, `'5v5'` |
| `name` | `varchar(50)` | NOT NULL | Nom affichable |
| `lockout_minutes` | `smallint` | NOT NULL | Durée pendant laquelle la team/user est verrouillée après le début d'un match. Aussi le délai minimum avant la soumission de score |
| `created_at` | `timestamp tz` | NOT NULL DEFAULT NOW | |

**Contraintes** :
- `UNIQUE(game_id, format)` : un seul ladder par (jeu, format).

**Choix structurants** :
- `format` est en enum : interdit les variantes ("5v5", "5V5", "5x5").
- Pas de colonne `team_size` explicite : dérivable du format (`'5v5'.split('v')[0]` → 5).
- Pas de distinction explicite solo/team : c'est implicite (1v1 = solo, autres = team) et utilisé par `rankings`.
- `lockout_minutes` est en `smallint` (minutes entières) plutôt qu'en `interval` Postgres pour faciliter le code applicatif.

**Données initiales** (seed) :

```
game     format   lockout   name
─────────────────────────────────────────────────────────
chess    1v1      30        Chess 1v1
lol      5v5      60        League of Legends 5v5
cs2      5v5      60        Counter-Strike 2 5v5
cs2      2v2      30        Counter-Strike 2 2v2 (Wingman)
val      5v5      60        Valorant 5v5
val      2v2      30        Valorant 2v2
rl       1v1      30        Rocket League 1v1
rl       2v2      30        Rocket League 2v2
rl       3v3      30        Rocket League 3v3
```

→ Règle mnémo : **5v5 → 60 min de lockout, tout le reste → 30 min**.

---

### 3.5 `teams`

Équipe constituée pour un ladder spécifique. "Bisounours CS2 5v5" et "Bisounours CS2 2v2" sont deux teams distinctes même si les humains se ressemblent.

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `ladder_id` | `uuid` | NOT NULL, FK → ladders(id) ON DELETE CASCADE | |
| `name` | `varchar(50)` | NOT NULL | Nom de l'équipe |
| `captain_id` | `uuid` | NOT NULL, FK → users(id) ON DELETE CASCADE | Le créateur. Si le capitaine supprime son compte, la team est dissoute (choix MVP — pas de transfert de captaincy) |
| `logo_url` | `text` | NULLABLE | URL MinIO d'un avatar de team optionnel |
| `created_at` | `timestamp tz` | NOT NULL DEFAULT NOW | |
| `updated_at` | `timestamp tz` | NOT NULL DEFAULT NOW + `$onUpdate` | |

**Contraintes** :
- `UNIQUE(ladder_id, name)` : pas 2 teams au même nom dans le même ladder. Mais "Bisounours" peut exister sur 2 ladders différents.

**Choix structurants** :
- `captain_id` NOT NULL : une team a toujours un capitaine. ON DELETE CASCADE choisi pour la simplicité MVP — alternative future : forcer le transfert avant suppression du compte.
- Pas de système d'open recruitment dans le MVP.

---

### 3.6 `team_members`

Table de jointure many-to-many entre teams et users. Un user peut être dans plusieurs teams (sur différents ladders), une team a plusieurs membres.

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `team_id` | `uuid` | NOT NULL, FK → teams(id) ON DELETE CASCADE | |
| `user_id` | `uuid` | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| `ladder_id` | `uuid` | NOT NULL, FK → ladders(id) ON DELETE CASCADE | **Dénormalisé** : copie de `teams.ladder_id` pour permettre la contrainte unique |
| `joined_at` | `timestamp tz` | NOT NULL DEFAULT NOW | |

**Contraintes** :
- `UNIQUE(team_id, user_id)` : un user ne peut être 2 fois dans la même team.
- `UNIQUE(user_id, ladder_id)` : **un user dans une seule team par ladder** (règle "championnat de football : tu ne peux pas jouer pour le PSG et Marseille en même temps").

**Choix structurant — dénormalisation de `ladder_id`** :

La contrainte "un user dans une seule team par ladder" ne peut pas s'exprimer en SQL sans une dénormalisation. Sans la colonne `ladder_id` dans `team_members`, il faudrait un JOIN via `teams` à chaque INSERT, ce qui est sujet aux race conditions.

Solution : copier `teams.ladder_id` dans `team_members.ladder_id` à l'INSERT. Comme `teams.ladder_id` est immuable (une team est figée sur son ladder), la dénormalisation est safe — pas de risque de désynchronisation.

**Invariant côté code** : à chaque INSERT dans `team_members`, le backend lit `teams.ladder_id` et le recopie. Si quelqu'un INSERT manuellement avec un `ladder_id` qui ne match pas, la DB ne détecte pas — mais le backend est la seule porte d'entrée.

**Autres choix structurants** :
- Le **capitaine fait partie de `team_members`** (en plus d'être référencé via `teams.captain_id`). `count(team_members WHERE team_id = X)` donne la taille de la team, capitaine inclus.
- Pas de colonne `role` : MVP simple (capitaine OU membre, déterminé via `teams.captain_id`).
- **Taille de team** enforcée en code, pas en DB : Postgres ne sait pas contraindre facilement "max N lignes". Le backend vérifie `count(team_members) < format_size` avant INSERT.

---

### 3.7 `matches`

Métadonnées d'un match. C'est l'entité centrale du domaine jeu.

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `ladder_id` | `uuid` | NOT NULL, FK → ladders(id) ON DELETE RESTRICT | RESTRICT pour préserver l'historique |
| `status` | `match_status_enum` | NOT NULL DEFAULT `'pending'` | Voir state machine ci-dessous |
| `winner_side_id` | `uuid` | NULLABLE, FK → match_sides(id) | Vérité finale, renseigné quand status = `'completed'`. Permet les queries "matches gagnés par X" sans calcul |
| `scheduled_at` | `timestamp tz` | NULLABLE | Si le match est programmé pour plus tard (matchmaking future) |
| `started_at` | `timestamp tz` | NULLABLE | Quand le match a vraiment commencé. **Référence pour le lockout** |
| `completed_at` | `timestamp tz` | NULLABLE | Quand status devient `'completed'` ou `'cancelled'` |
| `created_at` | `timestamp tz` | NOT NULL DEFAULT NOW | |

**State machine de `status`** :

```
pending
   │
   ▼
in_progress
   │
   ▼
awaiting_confirmation ── (les 2 sides d'accord) ─► completed
   │
   │ (désaccord)
   ▼
disputed ── (résolution admin) ─► completed
                              └─► cancelled
```

`cancelled` est aussi accessible depuis `pending` (forfait avant le match) ou `disputed` (admin annule).

---

### 3.8 `match_sides`

Les 2 camps d'un match. Toujours exactement 2 lignes par match.

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `match_id` | `uuid` | NOT NULL, FK → matches(id) ON DELETE CASCADE | |
| `side_index` | `smallint` | NOT NULL CHECK `IN (0, 1)` | 0 = camp A, 1 = camp B |
| `team_id` | `uuid` | NULLABLE, FK → teams(id) ON DELETE SET NULL | NULL pour les matchs 1v1 (pas de team). SET NULL si team dissoute pour préserver l'historique |
| `submitted_at` | `timestamp tz` | NULLABLE | Quand ce camp a soumis son résultat |
| `submitted_winner_side_id` | `uuid` | NULLABLE, FK → match_sides(id) | Qui ce camp dit être le gagnant. NULL = pas encore soumis |

**Contraintes** :
- `UNIQUE(match_id, side_index)` : un match a exactement 2 sides (index 0 et 1).

**Choix structurants** :
- **2 sources de vérité distinctes pour le winner** :
  - `matches.winner_side_id` = vérité **finale** (figée quand match completed)
  - `match_sides.submitted_winner_side_id` = ce que **ce camp a soumis** (peut différer entre les 2 sides en cas de dispute)
- ON DELETE SET NULL sur `team_id` : permet de préserver l'historique d'un match même si une team est dissoute après.

---

### 3.9 `match_participants`

Liste effective des joueurs présents dans chaque camp. 1 ligne par joueur par match (donc 2 lignes pour un 1v1, 10 lignes pour un 5v5).

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `match_side_id` | `uuid` | NOT NULL, FK → match_sides(id) ON DELETE CASCADE | À quel camp appartient ce joueur dans ce match |
| `user_id` | `uuid` | NOT NULL, FK → users(id) ON DELETE RESTRICT | RESTRICT pour préserver l'historique |

**Contraintes** :
- `UNIQUE(match_side_id, user_id)` : un user pas 2 fois dans le même camp d'un match.

**Choix structurants** :
- **ON DELETE RESTRICT sur `user_id`** : exception aux autres tables. Si un user veut supprimer son compte, il faut décider côté code soit de refuser, soit d'anonymiser les match_participants (TODO à l'implémentation). Préserver l'historique évite que les stats du vainqueur deviennent fausses.

---

### 3.10 `disputes`

Marque qu'un match est contesté. Une dispute par match max.

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `match_id` | `uuid` | NOT NULL, FK → matches(id) ON DELETE CASCADE, **UNIQUE** | Une seule dispute par match |
| `status` | `dispute_status_enum` | NOT NULL DEFAULT `'open'` | `'open'` ou `'resolved'` |
| `resolution` | `dispute_resolution_enum` | NULLABLE | Décision finale (`'side_0_wins'`, `'side_1_wins'`, `'cancelled'`) |
| `resolved_by_user_id` | `uuid` | NULLABLE, FK → users(id) ON DELETE SET NULL | L'admin qui a tranché |
| `resolution_notes` | `text` | NULLABLE | Explication de l'admin |
| `created_at` | `timestamp tz` | NOT NULL DEFAULT NOW | |
| `resolved_at` | `timestamp tz` | NULLABLE | Quand status = `'resolved'` |

**Invariants côté code** :
- `status = 'resolved'` ⟹ `resolution` NOT NULL et `resolved_at` NOT NULL
- `resolved_by_user_id` doit pointer vers un user avec `is_admin = true`

---

### 3.11 `dispute_evidence`

Preuves uploadées (screenshots, replays) par les participants pour étayer leur version.

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `dispute_id` | `uuid` | NOT NULL, FK → disputes(id) ON DELETE CASCADE | |
| `submitted_by_user_id` | `uuid` | NOT NULL, FK → users(id) ON DELETE SET NULL | L'auteur de la preuve |
| `match_side_id` | `uuid` | NOT NULL, FK → match_sides(id) ON DELETE CASCADE | À quel camp appartient cette preuve |
| `evidence_url` | `text` | NOT NULL | URL MinIO du fichier (bucket `dispute-evidence` à créer) |
| `description` | `text` | NULLABLE | Commentaire facultatif de l'uploadeur |
| `submitted_at` | `timestamp tz` | NOT NULL DEFAULT NOW | |

**Choix structurants** :
- **Plusieurs preuves possibles par side** : pas de UNIQUE sur `(dispute_id, match_side_id)`. Un camp peut uploader plusieurs fichiers.
- Pas de colonne `claimed_winner` : la preuve soutient implicitement la version déjà soumise par le `match_side_id`.

**Validations côté code** :
- `submitted_by_user_id` doit être un participant du match (`EXISTS dans match_participants`)
- `match_side_id` doit appartenir au même match que `dispute.match_id`

---

### 3.12 `rankings`

Le classement ELO. **Dual-mode** : chaque ligne référence soit un user (1v1), soit une team (formats à plusieurs).

| Colonne | Type | Contraintes | Rôle |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `ladder_id` | `uuid` | NOT NULL, FK → ladders(id) ON DELETE CASCADE | |
| `user_id` | `uuid` | NULLABLE, FK → users(id) ON DELETE CASCADE | Rempli **si et seulement si** ladder solo (1v1) |
| `team_id` | `uuid` | NULLABLE, FK → teams(id) ON DELETE CASCADE | Rempli **si et seulement si** ladder team (2v2+) |
| `elo` | `integer` | NOT NULL DEFAULT 1000 | Score ELO actuel |
| `wins` | `integer` | NOT NULL DEFAULT 0 | Compteur victoires |
| `losses` | `integer` | NOT NULL DEFAULT 0 | Compteur défaites |
| `last_match_at` | `timestamp tz` | NULLABLE | Dernier match joué (utile pour un futur ELO decay) |
| `created_at` | `timestamp tz` | NOT NULL DEFAULT NOW | |
| `updated_at` | `timestamp tz` | NOT NULL DEFAULT NOW + `$onUpdate` | |

**Contraintes** :
- `CHECK ((user_id IS NULL) <> (team_id IS NULL))` : XOR logique. Exactement un des deux est rempli.
- `UNIQUE(ladder_id, user_id)` partial WHERE `user_id IS NOT NULL` : un user a une seule ligne par ladder solo.
- `UNIQUE(ladder_id, team_id)` partial WHERE `team_id IS NOT NULL` : une team a une seule ligne par ladder team.

**Choix structurants** :
- Pas de colonne `draws` : nos jeux n'ont pas de matchs nuls (chess gère les nuls en rejouant jusqu'à un vainqueur, en série continue).
- Pas de colonne `rank` (position au classement) : dérivable par query `ORDER BY elo DESC`. Stocker `rank` créerait un coût de maintenance énorme.
- Type `integer` pour `elo` : pas besoin de décimales, range standard 0-3000+.

**Algorithme ELO** :

```
expected_A = 1 / (1 + 10^((elo_B - elo_A) / 400))
new_elo_A  = elo_A + 32 * (résultat_A - expected_A)
```

- `K = 32` (fixe pour tout le monde, MVP)
- ELO de départ : `1000`
- `résultat_A` : 1 si gagne, 0 si perd (pas de nul)
- Pour les ladders team : on applique la formule sur l'ELO de la team (et non sur ses joueurs individuels)

---

## 4. Indexes secondaires

À part les indexes auto-créés (PK, UNIQUE), prévoir :

### `user_external_accounts`
- `INDEX (provider, external_id)` — futurs lookups OAuth ("qui détient ce Riot ID vérifié")

### `matches`
- `INDEX (ladder_id, status)` — "matchs en cours pour ce ladder"
- `INDEX (ladder_id, completed_at DESC)` — historique des matchs récents
- `INDEX (status, scheduled_at)` — pour le matchmaking worker

### `match_sides`
- `INDEX (team_id, match_id)` — "tous les matchs de cette team"

### `match_participants`
- `INDEX (user_id, match_side_id)` — "tous les matchs de ce user"

### `team_members`
- `INDEX (user_id)` — "toutes les teams de ce user"

### `rankings`
- `INDEX (ladder_id, elo DESC)` — **CRITIQUE**, query du leaderboard

### `disputes`
- `INDEX (status, created_at)` — pour le job d'arrière-plan "disputes ouvertes depuis 24h"

### `dispute_evidence`
- `INDEX (dispute_id, match_side_id)` — "preuves uploadées par ce camp"

---

## 5. Règles business (hors schéma)

Ces règles vivent dans le code applicatif, pas en contraintes DB.

### 5.1 Liaison de compte requis pour s'inscrire

Pour s'inscrire à un match d'un jeu `G`, le user doit avoir une ligne dans `user_external_accounts` avec `provider = G.required_provider`. Sinon → 400 "Lie ton compte X".

### 5.2 Lockout entre matchs

Quand une team (ou un user en 1v1) accepte un match dans un ladder L :
- Si elle a un match dont `started_at > NOW() - INTERVAL '1 minute' * L.lockout_minutes` et status ∈ `('in_progress', 'awaiting_confirmation', 'disputed')` → rejet "occupée".

### 5.3 Soumission de score trop tôt

Quand un side soumet son résultat sur un match M :
- Si `NOW() - M.started_at < INTERVAL '1 minute' * M.ladder.lockout_minutes` → rejet "trop tôt".

### 5.4 Match consistent vs dispute

Quand les 2 sides ont soumis (`submitted_at NOT NULL` sur les 2) :
- Si `sides[0].submitted_winner_side_id == sides[1].submitted_winner_side_id` → **accord**. `matches.winner_side_id = ça`, status = `'completed'`.
- Sinon → **désaccord**. INSERT dans `disputes`, status = `'disputed'`.

### 5.5 Dispute timeout

Un job d'arrière-plan (cron horaire par exemple) parcourt les `disputes` ouvertes depuis plus de 24h :
- Si **un seul** side a uploadé des `dispute_evidence` → résolution automatique en faveur de ce side (forfait de l'autre).
- Si **aucun** des deux n'a uploadé → résolution `'cancelled'` (match annulé, ELO inchangé).
- Si **les deux** ont uploadé → la dispute reste open, l'admin doit trancher manuellement.

### 5.6 Taille des teams enforcée en code

Avant INSERT dans `team_members` : `count(team_members WHERE team_id = X) < L.format_size` (5 pour 5v5, 2 pour 2v2, etc.).

### 5.7 Chess en série continue

Si un match chess se termine par un nul, les joueurs **rejouent** sur chess.com jusqu'à avoir un vainqueur. Seul le résultat final (le vainqueur) est soumis dans notre plateforme. Aucun cas de nul ne remonte à la DB.

### 5.8 Lockout par défaut

- 5v5 → 60 min
- Tout le reste → 30 min

---

## 6. Choix structurants — récap des décisions

| # | Décision | Justification |
|---|---|---|
| 1 | **Slug texte comme PK** pour `games` | Set petit et stable, FK lisibles, pas besoin de JOIN pour avoir le nom |
| 2 | **`user_external_accounts` par provider** (pas par jeu) | LoL et Valorant partagent un compte Riot → pas de duplication |
| 3 | **`verified` boolean prévu dès le MVP** | Évite une migration plus tard quand on implémentera OAuth in-game |
| 4 | **Teams per ladder** (pas par jeu) | Une team a une taille fixée par le format. Simple à enforcer |
| 5 | **Dénormalisation de `ladder_id` dans `team_members`** | Permet la contrainte "1 user dans 1 team par ladder" en SQL natif (Option B vs trigger ou check applicatif) |
| 6 | **3 tables pour les matchs** (matches / sides / participants) | Sépare clean métadonnées / camp / joueurs. Permet d'ajouter des colonnes par camp (scores, surrender, etc.) sans dupliquer |
| 7 | **`winner_side_id` dans `matches`** ET `submitted_winner_side_id` dans `match_sides` | Distingue vérité finale vs soumission individuelle (utile pour les disputes) |
| 8 | **ON DELETE RESTRICT sur `match_participants.user_id`** | Préserve l'historique des matchs. Suppression de compte = problème à régler côté code (refus ou anonymisation) |
| 9 | **Rankings dual-mode user XOR team** via CHECK contrainte | Unique table pour les classements solo et team, gérée par contrainte XOR atomique |
| 10 | **ELO K=32 fixe, départ 1000** | Standard, simple. Adaptatif possible plus tard si besoin |
| 11 | **Pas de matchs nuls** dans le schéma | Chess gère les nuls en rejouant côté chess.com. Simplifie les rankings et les disputes |
| 12 | **`lockout_minutes` unique par ladder** (au lieu de 2 colonnes séparées) | Cooldown entre matchs ET délai de soumission ont la même valeur. Plus simple |
| 13 | **`is_admin` colonne sur `users`** (vs table `user_roles`) | 1 seul rôle, overkill d'avoir une table dédiée. Migrable plus tard |

---

## 7. Ce qui n'est PAS dans ce schéma

Volontairement exclu pour le MVP, à ajouter si besoin :

- **Système d'invitation/open recruitment** pour les teams
- **Transfert de captaincy** (au lieu de cascader la suppression)
- **Anonymisation des participants** lors de la suppression d'un compte
- **Soft delete** sur n'importe quelle table
- **Notifications** (système séparé, déjà prévu comme module)
- **Friend matchmaking** / privater rooms
- **Scores détaillés** des matchs (juste win/loss pour l'instant)
- **OAuth in-game** (Riot Sign-On, Steam Login, Epic Online Services) — le champ `verified` est prêt
- **ELO decay** pour les inactifs (`last_match_at` est là pour l'implémenter)
- **K-factor adaptatif** par ELO range ou par nombre de matchs joués
- **Match nul comme issue** (incompatible avec notre règle "chess rejoue jusqu'à vainqueur")
- **Multi-providers pour chess** (Lichess en plus de chess.com) — facile à ajouter via l'enum

---

## 8. Migrations à venir (étape 6)

Ordre d'implémentation des migrations Drizzle (respecte les dépendances FK) :

1. Enums : `provider_enum`, `format_enum`, `match_status_enum`, `dispute_status_enum`, `dispute_resolution_enum`
2. Modif `users` : ajout `is_admin`
3. `games` + seed
4. `user_external_accounts`
5. `ladders` + seed (9 ladders)
6. `teams`
7. `team_members`
8. `matches`
9. `match_sides`
10. `match_participants`
11. `disputes`
12. `dispute_evidence`
13. `rankings`
14. Tous les indexes secondaires

Chaque migration sera testée avec `drizzle-kit push` ou `migrate`, vérifiée via Adminer, et committée individuellement pour un git log propre.
