-- I4 — normalisation CIBLÉE des URLs de médias (data migration, aucun changement de schéma).
-- Le navigateur applicatif ne consomme plus les médias via l'hôte absolu du MinIO local
-- (http://localhost:9000/...) : contenu mixte sur une page HTTPS. On bascule UNIQUEMENT les
-- avatars stockés avec le préfixe HISTORIQUE EXACT du backend local vers le chemin relatif
-- /media/avatars/<fichier> servi par le proxy Vite.
--
-- ⚠️ Filtre sur le préfixe EXACT `http://localhost:9000/avatars/` (pas un `%/avatars/%` large) :
-- une URL d'avatar EXTERNE légitime (ex. https://cdn.example.com/users/avatars/x.png) ne doit
-- JAMAIS être détournée vers un objet local inexistant. On ne retire que ce préfixe précis,
-- le reste de la valeur (le nom de fichier) est conservé tel quel.
UPDATE "users"
SET "avatar_url" = '/media/avatars/'
  || substring("avatar_url" FROM char_length('http://localhost:9000/avatars/') + 1)
WHERE "avatar_url" LIKE 'http://localhost:9000/avatars/%';
--> statement-breakpoint
-- Logos d'équipe EXTERNES en http:// : contenu mixte, bloqué par le navigateur sur la page
-- HTTPS. Ce sont des URLs arbitraires fournies par le capitaine (pas nos fichiers) : on ne
-- peut pas les réécrire vers un hôte sûr, on les retire (NULL). Seul http:// est visé — les
-- logos https:// (les seuls désormais acceptés par l'API) restent intacts.
UPDATE "teams"
SET "logo_url" = NULL
WHERE "logo_url" LIKE 'http://%';
