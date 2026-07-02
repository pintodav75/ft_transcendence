/**
 * Seed de DÉVELOPPEMENT (fixtures) — À NE PAS confondre avec les données de
 * référence (games/ladders) qui, elles, vivent dans les migrations.
 *
 * Ce script insère de faux profils + faux classements pour visualiser le
 * leaderboard en local. Il est idempotent (onConflictDoNothing) → relançable
 * sans créer de doublons, et ne doit JAMAIS être lancé en prod.
 *
 * Usage : docker compose exec backend npm run seed:dev
 */
import { db } from '../db/index.js';
import { usersTable, teamsTable, laddersTable, rankingsTable } from '../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';

// 10 faux joueurs, ELO décroissant pour voir le tri.
const fakeUsers = [
  { pseudo: 'alice', displayName: 'Alice', elo: 1580, wins: 30, losses: 8 },
  { pseudo: 'bob', displayName: 'Bob', elo: 1490, wins: 25, losses: 10 },
  { pseudo: 'carol', displayName: 'Carol', elo: 1435, wins: 22, losses: 12 },
  { pseudo: 'dave', displayName: 'Dave', elo: 1390, wins: 20, losses: 14 },
  { pseudo: 'erin', displayName: 'Erin', elo: 1350, wins: 18, losses: 15 },
  { pseudo: 'frank', displayName: 'Frank', elo: 1300, wins: 15, losses: 15 },
  { pseudo: 'grace', displayName: 'Grace', elo: 1255, wins: 12, losses: 18 },
  { pseudo: 'heidi', displayName: 'Heidi', elo: 1180, wins: 9, losses: 20 },
  { pseudo: 'ivan', displayName: 'Ivan', elo: 1075, wins: 5, losses: 22 },
  { pseudo: 'judy', displayName: 'Judy', elo: 980, wins: 2, losses: 25 },
];

// 3 fausses équipes sur cs2 5v5, ELO décroissant.
const fakeTeams = [
  { name: 'Team Alpha', captain: 'alice', elo: 1320, wins: 12, losses: 3 },
  { name: 'Team Bravo', captain: 'bob', elo: 1130, wins: 7, losses: 6 },
  { name: 'Team Charlie', captain: 'carol', elo: 995, wins: 3, losses: 9 },
];

async function main() {
  // --- Ladders cibles : cherchés par (game, format), PAS par id (les uuid
  // diffèrent d'une base à l'autre). ---
  const [chess] = await db
    .select()
    .from(laddersTable)
    .where(and(eq(laddersTable.gameId, 'chess'), eq(laddersTable.format, '1v1')));
  if (!chess) {
    console.error('❌ Ladder chess 1v1 introuvable — as-tu lancé les migrations ?');
    process.exit(1);
  }

  // --- Faux users ---
  await db
    .insert(usersTable)
    .values(fakeUsers.map((u) => ({ pseudo: u.pseudo, email: `${u.pseudo}@dev.local`, displayName: u.displayName })))
    .onConflictDoNothing();

  // Re-select pour récupérer les id générés par la base.
  const pseudos = fakeUsers.map((u) => u.pseudo);
  const dbUsers = await db
    .select({ id: usersTable.id, pseudo: usersTable.pseudo })
    .from(usersTable)
    .where(inArray(usersTable.pseudo, pseudos));
  const idByPseudo = new Map(dbUsers.map((u) => [u.pseudo, u.id]));

  // --- Classement joueurs sur chess 1v1 ---
  await db
    .insert(rankingsTable)
    .values(
      fakeUsers.map((u) => ({
        ladderId: chess.id,
        userId: idByPseudo.get(u.pseudo)!,
        elo: u.elo,
        wins: u.wins,
        losses: u.losses,
      })),
    )
    .onConflictDoNothing();

  // --- Équipes + classement équipes sur cs2 5v5 (si le ladder existe) ---
  const [cs2] = await db
    .select()
    .from(laddersTable)
    .where(and(eq(laddersTable.gameId, 'cs2'), eq(laddersTable.format, '5v5')));

  if (cs2) {
    await db
      .insert(teamsTable)
      .values(
        fakeTeams.map((t) => ({ ladderId: cs2.id, name: t.name, captainId: idByPseudo.get(t.captain)! })),
      )
      .onConflictDoNothing();

    const teamNames = fakeTeams.map((t) => t.name);
    const dbTeams = await db
      .select({ id: teamsTable.id, name: teamsTable.name })
      .from(teamsTable)
      .where(and(eq(teamsTable.ladderId, cs2.id), inArray(teamsTable.name, teamNames)));
    const teamIdByName = new Map(dbTeams.map((t) => [t.name, t.id]));

    await db
      .insert(rankingsTable)
      .values(
        fakeTeams.map((t) => ({
          ladderId: cs2.id,
          teamId: teamIdByName.get(t.name)!,
          elo: t.elo,
          wins: t.wins,
          losses: t.losses,
        })),
      )
      .onConflictDoNothing();
  }

  console.log(`✅ seed-dev terminé : ${fakeUsers.length} joueurs sur chess 1v1` + (cs2 ? `, ${fakeTeams.length} équipes sur cs2 5v5` : ''));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
