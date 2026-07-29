/**
 * Le SEUL endroit du harnais front qui sort du navigateur : une requête SQL dans le
 * conteneur postgres de la stack de dev.
 *
 * 🚨 RÈGLE D'USAGE — le SQL sert à **FORCER un état que l'API interdit d'atteindre**. Il ne
 * sert JAMAIS à constater un comportement applicatif : un check qui lit la base au lieu de
 * lire l'écran ne garde pas l'écran, il garde la base — et il resterait vert le jour où la
 * page cesserait d'afficher ce qu'elle affiche.
 *
 * Le cas qui l'a fait naître ([FT-4B]) est exactement de la première famille et n'a pas
 * d'autre issue : `POST /matches` et `POST /matches/:id/accept` exigent un `scheduledAt`
 * **dans le futur** (≥ 15 min), tandis que `POST /matches/:id/result` exige
 * `now() >= scheduled_at` (§5.3). Aucune séquence d'appels HTTP ne produit un match prêt à
 * être scoré : il faut reculer `scheduled_at`. C'est déjà ce que fait le harnais e2e Python
 * (`backend/tests/helpers.py`), dont ce module est la transposition — mêmes pièges, mêmes
 * remèdes.
 *
 * Le second usage légitime est le **teardown** : `DELETE /users/me` refuse (409
 * `engaged_in_match`) tout compte aligné dans un match `pending`/`in_progress`/
 * `awaiting_confirmation`/`disputed`, et l'API n'offre aucun moyen de sortir un match
 * `in_progress` de ces statuts. Sans SQL, un scénario qui démarre un match laisse ses
 * comptes en base à chaque run.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// frontend/tests/console-audit/ -> racine du repo, là où vivent `.env` et `compose.yml`.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** @type {{ user: string, database: string } | null} */
let credentials = null;

/**
 * Identifiants postgres lus dans le `.env` de la racine, JAMAIS en dur : ils diffèrent sur
 * chaque machine de l'équipe (le `.env` n'est pas versionné, seul `.env.example` l'est).
 */
function pg() {
  if (credentials) return credentials;

  const path = join(ROOT, '.env');
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`${path} illisible (${err.code}) — la stack de dev est-elle configurée ?`);
  }

  const read = (key) => {
    for (const line of content.split('\n')) {
      if (line.startsWith('#') || !line.includes('=')) continue;
      const at = line.indexOf('=');
      // Les guillemets sont RETIRÉS : `POSTGRES_USER="ft"` est un `.env` parfaitement valide,
      // et sans ça psql recevrait `"ft"` guillemets compris — un quart d'heure perdu chez le
      // coéquipier dont le `.env` est quoté, pour un échec dont le message ne dit rien.
      if (line.slice(0, at).trim() === key) {
        return line
          .slice(at + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2');
      }
    }
    throw new Error(`${key} absent de ${path} — impossible de joindre postgres`);
  };

  credentials = { user: read('POSTGRES_USER'), database: read('POSTGRES_DB') };
  return credentials;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Garde d'interpolation, à appeler AVANT de coudre une valeur dans une requête.
 *
 * ⚠️ `sql()` prend une chaîne déjà construite : rien n'y est échappé. C'est sûr tant que les
 * seules valeurs interpolées sont des **identifiants rendus par notre propre API**, et cette
 * garde est là pour que ça reste vrai — le lot 2 interpolera des scores et des libellés, et
 * c'est le moment où une valeur venue d'ailleurs se glisserait dans la requête.
 * (`spawnSync` sans shell exclut l'injection de COMMANDE ; c'est bien du SQL qu'on parle.)
 */
export function assertUuid(value, label = 'id') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error(`${label} n'est pas un uuid (« ${value} ») — refus de l'interpoler en SQL`);
  }
  return value;
}

/**
 * Exécute `query` dans le conteneur postgres et rend sa sortie brute (trimée).
 *
 * ⚠️ `-tAq` n'est pas cosmétique. Sans `-q`, psql fait suivre le résultat du **tag de
 * commande** sur les requêtes mutantes : un `UPDATE` rend « UPDATE 3 », un
 * `INSERT … RETURNING id` rend « <uuid>\nINSERT 0 1 ». `-t -A` seuls ne suppriment ce tag
 * que pour les SELECT — l'appelant qui lit une valeur de retour se prend le tag collé
 * derrière, et le bug ne se voit que le jour où quelqu'un lit vraiment ce retour.
 *
 * ⚠️ On inspecte le code de retour et on **lève**. Un `ROLLBACK` sur violation de contrainte
 * ne produit aucune exception : psql sort simplement en code non nul, que personne ne
 * regarde. Côté Python, avaler ce cas a laissé 270 users et 325 matchs de test s'accumuler
 * pendant trois jours. Ici, une erreur SQL doit faire planter fort : le scénario s'interrompt,
 * `report()` sort en **code 2** — « le harnais a échoué », ce qui est la bonne lecture. Ce
 * n'est pas un check rouge imputable au ticket.
 */
export function sql(query) {
  const { user, database } = pg();
  const out = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', user, '-d', database, '-tAq', '-c', query],
    // ⚠️ Borné, comme tout le reste du harnais (Playwright, le ping de `run.mjs`) : si le
    // daemon docker se fige, sans ce délai la campagne pend INDÉFINIMENT, sans une ligne de
    // sortie — le pire mode de panne pour un outil qu'on lance en boucle.
    { cwd: ROOT, encoding: 'utf8', timeout: 15_000 },
  );

  // `error` = le binaire `docker` lui-même est introuvable / non exécutable : distinct d'un
  // SQL refusé, et le message par défaut (« spawnSync docker ENOENT ») n'aide personne.
  if (out.error) {
    throw new Error(`docker compose exec injoignable (${out.error.message}) — stack démarrée ?`);
  }
  // Tué par le timeout ci-dessus : `status` vaut alors `null`, donc le test suivant lèverait
  // de toute façon — mais avec « code null », qui envoie chercher une erreur SQL inexistante.
  if (out.signal) {
    throw new Error(`psql tué (${out.signal}) après 15 s : ${query}\n(daemon docker figé ?)`);
  }
  if (out.status !== 0) {
    throw new Error(
      `SQL refusé (code ${out.status}) : ${query}\n${(out.stderr ?? '').trim() || '(pas de stderr)'}`,
    );
  }
  return (out.stdout ?? '').trim();
}
