import { db } from '../db/index.js';
import { matchesTable } from '../db/schema.js';
import { and, eq, lt, sql } from 'drizzle-orm';

/**
 * Le planificateur du backend : du code qui tourne TOUT SEUL, sans requête HTTP.
 *
 * Un seul `setInterval` pour toutes les tâches périodiques — pas un worker séparé.
 * On n'a qu'UN conteneur backend, donc aucun risque qu'un job s'exécute en double.
 * (Le jour où on lancerait plusieurs instances, il faudrait un verrou consultatif
 * Postgres autour de chaque tâche, sinon elles se marcheraient dessus.)
 *
 * Tâches à venir : confirmation automatique des scores à 24 h et annulation des matchs
 * fantômes (B6), timeout des disputes (B7).
 */

// Doit rester cohérent avec MIN_LEAD_MINUTES de routes/matches.ts.
const MIN_LEAD_MINUTES = 15;

const TICK_MS = 60 * 1000; // une passe par minute

/**
 * §5.2 — un slot `pending` à moins de MIN_LEAD_MINUTES de son heure est PÉRIMÉ :
 * plus personne ne peut l'accepter (la garde de l'accept le refuse déjà). On le passe
 * donc à `cancelled`.
 *
 * Sans ce job, un slot mort resterait `pending` pour l'éternité : il polluerait la
 * table, et surtout il consommerait un des emplacements ouverts de son créateur.
 *
 * @returns le nombre de slots annulés (pour le log)
 */
export async function cancelExpiredSlots(): Promise<number> {
  const cutoff = new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000);

  const cancelled = await db
    .update(matchesTable)
    .set({ status: 'cancelled' })
    .where(and(eq(matchesTable.status, 'pending'), lt(matchesTable.scheduledAt, cutoff)))
    .returning({ id: matchesTable.id });

  return cancelled.length;
}

export function startJobs(log: (msg: string) => void): NodeJS.Timeout {
  const tick = async () => {
    try {
      const expired = await cancelExpiredSlots();
      if (expired > 0) log(`jobs: ${expired} slot(s) périmé(s) annulé(s)`);
    } catch (error) {
      // Un job qui plante ne doit JAMAIS tuer le serveur : on log et on retente au tick
      // suivant. (Sans ce catch, une exception dans un callback async d'un setInterval
      // remonte en unhandledRejection et peut faire tomber le process.)
      log(`jobs: erreur — ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  void tick(); // une première passe au démarrage, sans attendre une minute
  return setInterval(() => void tick(), TICK_MS);
}
