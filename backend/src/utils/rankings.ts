import { updateElo } from './elo.js';
import { db } from '../db/index.js';
import {
  rankingsTable,
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
} from '../db/schema.js';
import { eq, and, SQL, sql } from 'drizzle-orm';

export type Competitor = { teamId: string } | { userId: string };

// Clé de verrou consultatif d'un compétiteur sur un ladder — sérialise les écritures ELO.
function competitorKey(ladderId: string, c: Competitor): string {
  return 'teamId' in c ? `rank:${ladderId}:team:${c.teamId}` : `rank:${ladderId}:user:${c.userId}`;
}

export async function applyMatchElo(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ladderId: string,
  winner: Competitor,
  loser: Competitor,
): Promise<void> {
  async function getOrCreateRanking(competitor: Competitor): Promise<{ id: string; elo: number }> {
    let filter: SQL;
    let values: typeof rankingsTable.$inferInsert;
    if ('teamId' in competitor) {
      filter = eq(rankingsTable.teamId, competitor.teamId);
      values = { ladderId, teamId: competitor.teamId };
    } else {
      filter = eq(rankingsTable.userId, competitor.userId);
      values = { ladderId, userId: competitor.userId };
    }

    const [existing] = await tx
      .select({ id: rankingsTable.id, elo: rankingsTable.elo })
      .from(rankingsTable)
      .where(and(eq(rankingsTable.ladderId, ladderId), filter));

    if (existing) return existing;

    const [created] = await tx
      .insert(rankingsTable)
      .values(values)
      .returning({ id: rankingsTable.id, elo: rankingsTable.elo });

    if (!created) throw new Error('failed to create ranking row');
    return created;
  }
  // ⚠️ Verrous des DEUX compétiteurs, pris dans un ORDRE DÉTERMINISTE (tri des clés) AVANT
  // toute lecture de `rankings`. Deux matchs distincts d'un même compétiteur (B5d autorise
  // les créneaux dos à dos) peuvent se compléter simultanément : sans ces verrous on aurait
  // un double INSERT (violation d'unique → 500), un lost-update sur l'ELO, ou un
  // interblocage. Le tri écarte le deadlock ; le verrou du match (pris par l'appelant) est
  // toujours acquis avant ceux-ci → ordre global cohérent.
  const lockKeys = [competitorKey(ladderId, winner), competitorKey(ladderId, loser)];
  for (const key of [...new Set(lockKeys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  }

  const winnerRanking = await getOrCreateRanking(winner);
  const loserRanking = await getOrCreateRanking(loser);

  const { newEloA, newEloB } = updateElo(winnerRanking.elo, loserRanking.elo, 'A');

  await tx
    .update(rankingsTable)
    .set({ elo: newEloA, wins: sql`${rankingsTable.wins} + 1`, lastMatchAt: new Date() })
    .where(eq(rankingsTable.id, winnerRanking.id));

  await tx
    .update(rankingsTable)
    .set({ elo: newEloB, losses: sql`${rankingsTable.losses} + 1`, lastMatchAt: new Date() })
    .where(eq(rankingsTable.id, loserRanking.id));
}

/**
 * Clôt un match sur un vainqueur et applique l'ELO — dans la transaction fournie.
 * Partagé par la route (accord des deux camps), le job d'auto-confirmation 24 h (B6)
 * et, plus tard, l'arbitrage admin (B7). L'appelant a déjà pris le verrou et vérifié
 * que le match est bien à clore ; ce helper ne fait pas de garde métier.
 */
export async function completeMatchWithElo(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  matchId: string,
  ladderId: string,
  winnerSideId: string,
): Promise<void> {
  await tx
    .update(matchesTable)
    .set({ winnerSideId, status: 'completed', completedAt: new Date() })
    .where(eq(matchesTable.id, matchId));

  const sides = await tx.select().from(matchSidesTable).where(eq(matchSidesTable.matchId, matchId));
  const winnerSide = sides.find((s) => s.id === winnerSideId);
  const loserSide = sides.find((s) => s.id !== winnerSideId);
  if (!winnerSide || !loserSide) throw new Error('match must have two sides to be scored');

  // Résout un side en compétiteur de classement (XOR) : équipe -> teamId ; solo -> userId
  // du participant. applyMatchElo reste ainsi agnostique des sides/participants.
  const toCompetitor = async (side: (typeof sides)[number]): Promise<Competitor> => {
    if (side.teamId !== null) return { teamId: side.teamId };
    const [p] = await tx
      .select({ userId: matchParticipantsTable.userId })
      .from(matchParticipantsTable)
      .where(eq(matchParticipantsTable.matchSideId, side.id));
    if (!p) throw new Error('solo side without participant');
    return { userId: p.userId };
  };

  await applyMatchElo(tx, ladderId, await toCompetitor(winnerSide), await toCompetitor(loserSide));
}
