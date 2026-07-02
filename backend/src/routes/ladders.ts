import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';
import { laddersTable, gamesTable, rankingsTable, usersTable, teamsTable } from '../db/schema.js';
import { shapeRankings } from '../utils/leaderboard.js';

export const laddersRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Querystring: { gameId?: string } }>('/', async (request, reply) => {
    try {
      const ladders = await db
        .select()
        .from(laddersTable)
        .where(request.query.gameId ? eq(laddersTable.gameId, request.query.gameId) : undefined)
        .orderBy(laddersTable.name);
      return reply.code(200).send({ ladders: ladders });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const id = request.params.id;
      const [row] = await db
        .select()
        .from(laddersTable)
        .innerJoin(gamesTable, eq(gamesTable.id, laddersTable.gameId))
        .where(eq(laddersTable.id, id));
      if (!row) return reply.code(404).send({ error: 'Ladder not found' });
      return { ladder: row.ladders, game: row.games };
    } catch (err) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get<{ Params: { id: string } }>('/:id/rankings', async (request, reply) => {
    try {
      const id = request.params.id;
      const [ladder] = await db.select().from(laddersTable).where(eq(laddersTable.id, id));
      if (!ladder) return reply.code(404).send({ error: 'Ladder not found' });
      const rows = await db
        .select({
          elo: rankingsTable.elo,
          wins: rankingsTable.wins,
          losses: rankingsTable.losses,
          userId: rankingsTable.userId,
          teamId: rankingsTable.teamId,
          userPseudo: usersTable.pseudo,
          userDisplayName: usersTable.displayName,
          userAvatarUrl: usersTable.avatarUrl,
          teamName: teamsTable.name,
          teamLogoUrl: teamsTable.logoUrl,
        })
        .from(rankingsTable)
        .leftJoin(usersTable, eq(usersTable.id, rankingsTable.userId))
        .leftJoin(teamsTable, eq(teamsTable.id, rankingsTable.teamId))
        .where(eq(rankingsTable.ladderId, id))
        .orderBy(desc(rankingsTable.elo));
      const rankings = shapeRankings(rows);
      return reply.code(200).send({ rankings });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
};
