import { db } from '../db/index.js';
import { matchesTable, matchSidesTable, disputesTable } from '../db/schema.js';
import { and, eq, lt, sql, isNotNull } from 'drizzle-orm';
import { completeMatchWithElo } from '../utils/rankings.js';
import { notify, pushNotifications, getMatchParticipantIds } from '../utils/notifications.js';

/**
 * Le planificateur du backend : du code qui tourne TOUT SEUL, sans requête HTTP.
 *
 * Un seul `setInterval` pour toutes les tâches périodiques — pas un worker séparé.
 * On n'a qu'UN conteneur backend, donc aucun risque qu'un job s'exécute en double.
 * (Le jour où on lancerait plusieurs instances, il faudrait un verrou consultatif
 * Postgres autour de chaque tâche, sinon elles se marcheraient dessus.)
 *
 * Tâches actuelles : slots périmés (B5d), matchs fantômes + auto-confirmation 24 h (B6),
 * timeout des disputes 24 h (B7).
 */

// Doit rester cohérent avec MIN_LEAD_MINUTES de routes/matches.ts.
const MIN_LEAD_MINUTES = 15;

const TICK_MS = 60 * 1000; // une passe par minute

// 24 h : délai d'abandon des matchs fantômes (job A) et d'auto-confirmation (job B).
const CONFIRM_TIMEOUT_MS = 24 * 60 * 60 * 1000;

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

/**
 * B6 Job A — les matchs FANTÔMES. Un match `in_progress` dont personne n'a soumis de
 * score plus de 24 h après l'heure prévue (`scheduled_at`) est abandonné : passage à
 * `cancelled`, aucun ELO.
 *
 * ⚠️ Traitement candidat par candidat SOUS LE MÊME VERROU que la route et le job B (et
 * NON un UPDATE en masse) : sinon une course est possible avec une soumission simultanée.
 * Un joueur peut soumettre sur un fantôme (in_progress, +24 h → §5.3 passe) au moment
 * exact du tick ; sans verrou partagé, le job annulerait la ligne pendant que la route
 * écrit sa soumission, et la route répondrait `200 awaiting_confirmation` sur un match
 * devenu `cancelled`. Avec le verrou : soit la route passe d'abord (le job voit
 * `awaiting_confirmation` et s'abstient), soit le job passe d'abord (la route relit
 * `cancelled` sous verrou et renvoie 409). (Course signalée en re-review.)
 *
 * @returns le nombre de matchs annulés
 */
export async function cancelStaleMatches(): Promise<number> {
  const cutoff = new Date(Date.now() - CONFIRM_TIMEOUT_MS);

  const candidates = await db
    .select({ matchId: matchesTable.id, ladderId: matchesTable.ladderId })
    .from(matchesTable)
    .where(and(eq(matchesTable.status, 'in_progress'), lt(matchesTable.scheduledAt, cutoff)));

  let cancelled = 0;
  for (const c of candidates) {
    // B9 : la tx rend les notifs créées (null = candidat écarté sous verrou). Le push WS
    // se fait APRÈS le commit — même règle que les routes, un rollback ne notifie pas.
    const notifs = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${c.matchId}))`);
      // Re-lecture sous verrou : une soumission a pu faire passer le match en
      // `awaiting_confirmation` (ou il a pu être re-planifié) entre la sélection et le verrou.
      const [m] = await tx
        .select({ status: matchesTable.status, scheduledAt: matchesTable.scheduledAt })
        .from(matchesTable)
        .where(eq(matchesTable.id, c.matchId));
      if (!m || m.status !== 'in_progress') return null;
      if (!m.scheduledAt || m.scheduledAt >= cutoff) return null;
      await tx
        .update(matchesTable)
        .set({ status: 'cancelled' })
        .where(eq(matchesTable.id, c.matchId));
      // B9 — « match abandonné » : les joueurs alignés des DEUX camps. Pas d'acteur à
      // exclure, c'est le robot qui agit.
      return notify(tx, await getMatchParticipantIds(tx, c.matchId), 'match_ghost_cancelled', {
        matchId: c.matchId,
        ladderId: c.ladderId,
      });
    });
    if (notifs) {
      cancelled++;
      pushNotifications(notifs);
    }
  }
  return cancelled;
}

/**
 * B6 Job B — AUTO-CONFIRMATION. Un match `awaiting_confirmation` (un seul camp a soumis)
 * dont la soumission date de plus de 24 h est validé sur ce score unique : `completed` +
 * ELO. ⚠️ L'horloge part de `submitted_at` de la soumission, PAS de `scheduled_at` —
 * sinon un joueur qui soumet tard rétrécirait la fenêtre de réponse de l'adversaire.
 *
 * Traitement candidat par candidat (comme le job A) : chacun est complété dans sa PROPRE
 * transaction, sous le MÊME verrou consultatif que la route (clé = matchId). Sans ce
 * verrou partagé, une confirmation concurrente du 2e camp appliquerait l'ELO en double.
 *
 * @returns le nombre de matchs auto-confirmés
 */
export async function autoConfirmMatches(): Promise<number> {
  const cutoff = new Date(Date.now() - CONFIRM_TIMEOUT_MS);

  // Seul le side qui a soumis porte submitted_at (l'autre est NULL, donc exclu par le
  // `lt`). On ne récupère ici QUE les ids : le vainqueur et le submitted_at seront relus
  // SOUS VERROU (le camp a pu re-soumettre entre-temps, cf. plus bas).
  const candidates = await db
    .select({ matchId: matchesTable.id, ladderId: matchesTable.ladderId })
    .from(matchesTable)
    .innerJoin(matchSidesTable, eq(matchSidesTable.matchId, matchesTable.id))
    .where(
      and(
        eq(matchesTable.status, 'awaiting_confirmation'),
        lt(matchSidesTable.submittedAt, cutoff),
      ),
    );

  let confirmed = 0;
  for (const c of candidates) {
    const notifs = await db.transaction(async (tx) => {
      // Même verrou que la route -> sérialise avec une soumission concurrente du camp.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${c.matchId}))`);
      const [m] = await tx
        .select({ status: matchesTable.status })
        .from(matchesTable)
        .where(eq(matchesTable.id, c.matchId));
      if (!m || m.status !== 'awaiting_confirmation') return null;

      // ⚠️ On RELIT la soumission sous verrou et on n'utilise PAS une valeur capturée hors
      // verrou : la route autorise la re-soumission (nouveau vainqueur + nouveau
      // submitted_at). Sans cette relecture, le job validerait un ANCIEN vainqueur et
      // ignorerait la nouvelle fenêtre de 24 h (course signalée en review).
      const [sub] = await tx
        .select({
          submittedAt: matchSidesTable.submittedAt,
          submittedWinnerSideId: matchSidesTable.submittedWinnerSideId,
        })
        .from(matchSidesTable)
        .where(and(eq(matchSidesTable.matchId, c.matchId), isNotNull(matchSidesTable.submittedAt)));
      if (!sub || !sub.submittedAt || !sub.submittedWinnerSideId) return null;
      // Re-soumission récente -> la soumission n'est plus expirée : on laisse sa propre
      // fenêtre de 24 h courir, on ne confirme pas ce tick-ci.
      if (sub.submittedAt >= cutoff) return null;

      await completeMatchWithElo(tx, c.matchId, c.ladderId, sub.submittedWinnerSideId);
      // B9 — « score entériné » : les DEUX camps. Le soumetteur d'origine aussi — 24 h ont
      // passé, pour lui c'est la confirmation que son score est acté (pas d'acteur : robot).
      return notify(tx, await getMatchParticipantIds(tx, c.matchId), 'result_confirmed', {
        matchId: c.matchId,
        ladderId: c.ladderId,
        winnerSideId: sub.submittedWinnerSideId,
      });
    });
    if (notifs) {
      confirmed++;
      pushNotifications(notifs);
    }
  }
  return confirmed;
}

/**
 * B7 Job C — TIMEOUT DES DISPUTES. Une dispute `open` depuis plus de 24 h (compté depuis
 * `created_at`) sans arbitrage admin est résolue automatiquement en ANNULANT le match :
 * `cancelled`, ELO inchangé, dispute `resolved` (resolution `cancelled`, sans arbitre).
 *
 * Pourquoi annuler et pas confirmer un score (contrairement au job B) ? Une dispute est un
 * DÉSACCORD : les deux camps ont soumis des vainqueurs opposés, il n'existe aucun score
 * commun à valider. La seule issue neutre sans humain est l'annulation. Surtout, sans ce
 * job un `disputed` resterait verrouillé À VIE (§5.2) si aucun admin ne passe : les deux
 * camps seraient bloqués pour toujours. Ce job garantit une sortie.
 *
 * Candidat par candidat, sous le MÊME verrou consultatif (clé = matchId) que la route
 * d'arbitrage `/disputes/:id/resolve` : un admin qui tranche pile au moment du tick ne
 * peut pas entrer en course. Re-lecture sous verrou (dispute encore `open` ? match encore
 * `disputed` ?) → si l'admin est passé d'abord, le job s'abstient.
 *
 * @returns le nombre de disputes auto-annulées
 */
export async function autoCancelDisputes(): Promise<number> {
  const cutoff = new Date(Date.now() - CONFIRM_TIMEOUT_MS);

  const candidates = await db
    .select({ disputeId: disputesTable.id, matchId: disputesTable.matchId })
    .from(disputesTable)
    .where(and(eq(disputesTable.status, 'open'), lt(disputesTable.createdAt, cutoff)));

  let cancelled = 0;
  for (const c of candidates) {
    const notifs = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${c.matchId}))`);
      const [d] = await tx
        .select({ status: disputesTable.status })
        .from(disputesTable)
        .where(eq(disputesTable.id, c.disputeId));
      if (!d || d.status !== 'open') return null;
      const [m] = await tx
        .select({ status: matchesTable.status, ladderId: matchesTable.ladderId })
        .from(matchesTable)
        .where(eq(matchesTable.id, c.matchId));
      if (!m || m.status !== 'disputed') return null;

      await tx
        .update(matchesTable)
        .set({ status: 'cancelled' })
        .where(eq(matchesTable.id, c.matchId));
      await tx
        .update(disputesTable)
        .set({
          status: 'resolved',
          resolution: 'cancelled',
          resolutionNotes: 'auto-résolu : aucun arbitrage admin sous 24 h',
          resolvedAt: new Date(),
        })
        .where(eq(disputesTable.id, c.disputeId));
      // B9 — « litige auto-annulé » : les DEUX camps apprennent l'issue neutre.
      return notify(tx, await getMatchParticipantIds(tx, c.matchId), 'dispute_auto_cancelled', {
        matchId: c.matchId,
        ladderId: m.ladderId,
        disputeId: c.disputeId,
      });
    });
    if (notifs) {
      cancelled++;
      pushNotifications(notifs);
    }
  }
  return cancelled;
}

export function startJobs(log: (msg: string) => void): NodeJS.Timeout {
  const tick = async () => {
    try {
      const expired = await cancelExpiredSlots();
      if (expired > 0) log(`jobs: ${expired} slot(s) périmé(s) annulé(s)`);
      const stale = await cancelStaleMatches();
      if (stale > 0) log(`jobs: ${stale} match(s) fantôme(s) annulé(s)`);
      const confirmed = await autoConfirmMatches();
      if (confirmed > 0) log(`jobs: ${confirmed} match(s) auto-confirmé(s)`);
      const autoCancelled = await autoCancelDisputes();
      if (autoCancelled > 0) log(`jobs: ${autoCancelled} dispute(s) auto-annulée(s) (timeout 24 h)`);
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
