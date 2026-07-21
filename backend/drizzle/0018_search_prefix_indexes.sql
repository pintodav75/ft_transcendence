-- Custom SQL migration file, put your code below! --

-- GET /search — index de RECHERCHE PAR PRÉFIXE (`lower(col) LIKE 'x%'`).
--
-- ⚠️ Un index fonctionnel btree ordinaire sur `lower(pseudo)` (déjà là depuis 0015,
-- pour l'unicité insensible à la casse) N'ACCÉLÈRE PAS un LIKE : la base tourne en
-- collation `en_US.utf8`, et l'ordre de tri linguistique de cette collation n'est pas
-- l'ordre octet par octet dont le planificateur a besoin pour transformer un préfixe
-- en intervalle. Vérifié avec `SET enable_seqscan = off` : Postgres préférait quand
-- même un Seq Scan, preuve que l'index existant était INUTILISABLE ici.
--
-- La classe d'opérateurs `text_pattern_ops` indexe en comparaison octet par octet,
-- ce qui débloque exactement cette réécriture :
--     lower(pseudo) LIKE 'bob%'
--  -> lower(pseudo) ~>=~ 'bob' AND lower(pseudo) ~<~ 'boc'   (Index Scan)
--
-- Elle ne sert QU'aux motifs préfixes — c'est pour ça qu'on l'ajoute À CÔTÉ de
-- l'index unique de 0015 au lieu de le remplacer : lui reste indispensable aux
-- égalités (`lower(pseudo) = lower($1)` du login et de GET /users/:pseudo).
CREATE INDEX IF NOT EXISTS "users_pseudo_lower_prefix_idx" ON "users" (lower("pseudo") text_pattern_ops);

-- Même chose côté teams, qui n'avait AUCUN index sur `name` (seulement la contrainte
-- composite `unique(ladder_id, name)`, inexploitable pour une recherche sur `name` seul).
CREATE INDEX IF NOT EXISTS "teams_name_lower_prefix_idx" ON "teams" (lower("name") text_pattern_ops);

-- ⚠️ PAS d'index inverse sur `blocks.blocked_id` — vérifié à l'EXPLAIN, il serait mort.
-- L'exclusion des blocages est un `NOT EXISTS` CORRÉLÉ : Postgres évalue le sous-select
-- une fois par ligne candidate, donc `users.id` lui est FOURNI. Les deux sens du OR
-- fournissent alors les deux colonnes de `blocks_pair_unique(blocker_id, blocked_id)`,
-- qui sert donc aux DEUX :
--     BitmapOr
--       Bitmap Index Scan on blocks_pair_unique  (blocker_id = $moi AND blocked_id = u.id)
--       Bitmap Index Scan on blocks_pair_unique  (blocker_id = u.id AND blocked_id = $moi)
-- Un index sur `blocked_id` seul n'aurait servi qu'à la forme non corrélée (la
-- pré-requête « charge tous mes blocages » qu'on vient justement de supprimer).
