import { db } from '../db/index.js';
import { matchesTable, matchSidesTable, disputesTable } from '../db/schema.js';
import { and, eq, lt, sql, isNotNull } from 'drizzle-orm';
import { completeMatchWithElo } from '../utils/rankings.js';
import { notify, pushNotifications, getMatchParticipantIds } from '../utils/notifications.js';

// Les taches qui tournent toutes seules, sans requete HTTP : creneaux perimes, matchs
// fantomes, auto-confirmation au bout de 24h et timeout des disputes.
// Un seul setInterval pour tout, pas de worker separe : on n'a qu'un conteneur backend, donc
// aucun risque qu'un job parte en double. Avec plusieurs instances il faudrait un verrou.

// Doit rester cohérent avec MIN_LEAD_MINUTES de routes/matches.ts.
const MIN_LEAD_MINUTES = 15;

const TICK_MS = 60 * 1000; // une passe par minute

// 24 h : délai d'abandon des matchs fantômes (job A) et d'auto-confirmation (job B).
const CONFIRM_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// Un creneau a moins de 15 minutes de son heure ne peut plus etre accepte, la route le refuse
// deja. On l'annule pour de bon, sinon il resterait en attente pour l'eternite et continuerait
// a occuper un des emplacements ouverts de celui qui l'a cree.
export async function cancelExpiredSlots(): Promise<number> {
  const cutoff = new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000);

  const cancelled = await db
    .update(matchesTable)
    .set({ status: 'cancelled' })
    .where(and(eq(matchesTable.status, 'pending'), lt(matchesTable.scheduledAt, cutoff)))
    .returning({ id: matchesTable.id });

  return cancelled.length;
}

// Les matchs fantomes : personne n'a soumis de score 24h apres l'heure prevue, on annule sans
// toucher a l'ELO.
// On traite match par match et sous le meme verrou que la route de soumission, pas en un seul
// UPDATE. Sinon quelqu'un peut soumettre pile pendant le tick : le job annulerait la ligne
// pendant que la route ecrit son score, et le joueur recevrait un OK sur un match annule.
export async function cancelStaleMatches(): Promise<number> {
  const cutoff = new Date(Date.now() - CONFIRM_TIMEOUT_MS);

  const candidates = await db
    .select({ matchId: matchesTable.id, ladderId: matchesTable.ladderId })
    .from(matchesTable)
    .where(and(eq(matchesTable.status, 'in_progress'), lt(matchesTable.scheduledAt, cutoff)));

  let cancelled = 0;
  for (const c of candidates) {
    // La transaction rend les notifs creees, ou null si on a ecarte le candidat sous verrou.
    // Le push part apres le commit, comme partout ailleurs.
    const notifs = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${c.matchId}))`);
      // On relit sous verrou : entre la selection et ici, quelqu'un a pu soumettre un score
      // ou replanifier le match.
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
      // On previent les joueurs alignes des deux camps : ici personne n'a agi, c'est le job.
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

// Un seul camp a soumis et l'autre n'a pas repondu depuis 24h : on valide sur ce score la et
// on applique l'ELO.
// Le compte a rebours part de l'heure de la soumission, pas de l'heure du match, sinon
// quelqu'un qui soumet tres tard raccourcirait le temps de reponse de l'adversaire.
// Chaque match dans sa propre transaction et sous le meme verrou que la route, sans quoi une
// confirmation qui arrive en meme temps appliquerait l'ELO deux fois.
export async function autoConfirmMatches(): Promise<number> {
  const cutoff = new Date(Date.now() - CONFIRM_TIMEOUT_MS);

  // Seul le camp qui a soumis porte une date de soumission, l'autre est a NULL et sort tout
  // seul du filtre. On ne prend que les ids ici, le reste sera relu sous verrou.
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
          id: matchSidesTable.id,
          submittedAt: matchSidesTable.submittedAt,
          submittedWinnerSideId: matchSidesTable.submittedWinnerSideId,
          submittedScoreSelf: matchSidesTable.submittedScoreSelf,
          submittedScoreOpponent: matchSidesTable.submittedScoreOpponent,
        })
        .from(matchSidesTable)
        .where(and(eq(matchSidesTable.matchId, c.matchId), isNotNull(matchSidesTable.submittedAt)));
      if (!sub || !sub.submittedAt || !sub.submittedWinnerSideId) return null;
      // Re-soumission récente -> la soumission n'est plus expirée : on laisse sa propre
      // fenêtre de 24 h courir, on ne confirme pas ce tick-ci.
      if (sub.submittedAt >= cutoff) return null;

      // Les scores sont stockes du point de vue du camp qui a soumis (mon score / son score),
      // il faut les remettre en vainqueur / perdant avant de calculer l'ELO.
      const submitterWon = sub.submittedWinnerSideId === sub.id;
      const winnerScore = submitterWon ? sub.submittedScoreSelf : sub.submittedScoreOpponent;
      const loserScore = submitterWon ? sub.submittedScoreOpponent : sub.submittedScoreSelf;

      await completeMatchWithElo(
        tx,
        c.matchId,
        c.ladderId,
        sub.submittedWinnerSideId,
        winnerScore,
        loserScore,
      );
      // Les deux camps sont prevenus, y compris celui qui avait soumis : pour lui c'est la
      // confirmation que son score est acte.
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

// Une dispute ouverte depuis 24h sans qu'aucun admin ne soit passe : on annule le match,
// l'ELO ne bouge pas.
// On annule au lieu de valider un score, contrairement au job precedent, parce qu'ici les deux
// camps ont annonce des vainqueurs differents : il n'y a aucun score commun a enteriner. Et
// sans ce job un match en litige resterait verrouille a vie si personne ne l'arbitre.
// Meme verrou que la route d'arbitrage, pour qu'un admin qui tranche pile au moment du tick
// ne se retrouve pas en course avec nous.
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
      // Les deux camps apprennent que le litige s'est termine sans vainqueur.
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
      // Un job qui plante ne doit pas tuer le serveur : on log et on retente au tick suivant.
      // Sans ce catch, l'erreur remonte en unhandledRejection et peut couper le process.
      log(`jobs: erreur — ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  void tick(); // une première passe au démarrage, sans attendre une minute
  return setInterval(() => void tick(), TICK_MS);
}
