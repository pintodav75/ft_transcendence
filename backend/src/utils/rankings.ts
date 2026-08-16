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

// Elo avant/après ce match précis pour un camp, et le delta appliqué. Le delta dépend de
// l'écart d'Elo AU MOMENT du match : il n'est pas recalculable a posteriori, d'où le besoin
// de le faire remonter à l'appelant pour persistance sur `match_sides`.
export type EloOutcome = { before: number; after: number; delta: number };

// Clé de verrou consultatif d'un compétiteur sur un ladder — sérialise les écritures ELO.
function competitorKey(ladderId: string, c: Competitor): string {
  return 'teamId' in c ? `rank:${ladderId}:team:${c.teamId}` : `rank:${ladderId}:user:${c.userId}`;
}

export async function applyMatchElo(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ladderId: string,
  winner: Competitor,
  loser: Competitor,
): Promise<{ winner: EloOutcome; loser: EloOutcome }> {
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

  return {
    winner: { before: winnerRanking.elo, after: newEloA, delta: newEloA - winnerRanking.elo },
    loser: { before: loserRanking.elo, after: newEloB, delta: newEloB - loserRanking.elo },
  };
}

// Clot un match sur un vainqueur et applique l'ELO, dans la transaction qu'on lui passe.
// Trois appelants : la route quand les deux camps sont d'accord, le job d'auto-confirmation
// au bout de 24h, et l'arbitrage admin. L'appelant a deja pris le verrou et verifie que le
// match est a clore, cette fonction ne fait aucune garde metier.
export async function completeMatchWithElo(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  matchId: string,
  ladderId: string,
  winnerSideId: string,
  // Score final (manches gagnées, Bo3 : 0/1/2) de chaque camp. **Obligatoires** (pas de
  // défaut) : un futur appelant qui oublie les scores doit avoir une erreur de compilation,
  // pas un `null` silencieux en base. Passer explicitement `null` pour l'arbitrage admin
  // (B7) : l'admin tranche un vainqueur, pas un score — `match_sides.score` reste alors
  // `null` tandis que l'Elo, lui, est bien appliqué.
  winnerScore: number | null,
  loserScore: number | null,
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

  const eloResult = await applyMatchElo(
    tx,
    ladderId,
    await toCompetitor(winnerSide),
    await toCompetitor(loserSide),
  );

  // Persistance sur `match_sides` : le delta d'Elo dépend de l'écart au moment de CE match
  // précis, il serait perdu dès le match suivant si on ne l'écrivait pas ici.
  await tx
    .update(matchSidesTable)
    .set({
      score: winnerScore,
      eloDelta: eloResult.winner.delta,
      eloAfter: eloResult.winner.after,
    })
    .where(eq(matchSidesTable.id, winnerSide.id));
  await tx
    .update(matchSidesTable)
    .set({ score: loserScore, eloDelta: eloResult.loser.delta, eloAfter: eloResult.loser.after })
    .where(eq(matchSidesTable.id, loserSide.id));
}
