-- Custom SQL migration file, put your code below! --

-- B3 : normaliser les emails existants en minuscules pour qu'ils matchent
-- les lookups lowercase (register/login/OAuth). Sans ça, un ancien compte
-- enregistré 'Bob@x' ne se loguerait plus (le login cherche désormais lower()).
UPDATE "users" SET "email" = lower("email");

-- B4 : unicité du pseudo insensible à la casse — 'Bob' et 'bob' ne peuvent plus
-- coexister. Même expression que le lookup de GET /users/:pseudo (cohérence
-- écriture/lecture). Le pseudo reste stocké tel que tapé (affichage préservé).
CREATE UNIQUE INDEX IF NOT EXISTS "users_pseudo_lower_unique" ON "users" (lower("pseudo"));