import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { eq, desc, asc } from 'drizzle-orm';
import {
  laddersTable,
  gamesTable,
  gameMapsTable,
  rankingsTable,
  usersTable,
  teamsTable,
} from '../db/schema.js';
import { shapeRankings } from '../utils/leaderboard.js';
import z from 'zod';

const idParamSchema = z.object({ id: z.uuid() });

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
      const { id } = idParamSchema.parse(request.params);
      const [row] = await db
        .select()
        .from(laddersTable)
        .innerJoin(gamesTable, eq(gamesTable.id, laddersTable.gameId))
        .where(eq(laddersTable.id, id));
      if (!row) return reply.code(404).send({ error: 'Ladder not found' });
      // Le pool de maps appartient au JEU, pas au ladder : c'est la même table que
      // `POST /matches` lit pour attribuer les maps d'un match (routes/matches.ts).
      // La servir ici plutôt que de la recopier côté front évite qu'une page annonce
      // des maps que le serveur n'attribue pas. Un jeu sans maps (lol, rl, chess)
      // rend un tableau vide — le front masque simplement la section.
      const maps = await db
        .select({ name: gameMapsTable.name })
        .from(gameMapsTable)
        .where(eq(gameMapsTable.gameId, row.ladders.gameId))
        .orderBy(asc(gameMapsTable.name));
      return { ladder: row.ladders, game: row.games, maps: maps.map((map) => map.name) };
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ errors: err.issues });
      reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get<{ Params: { id: string } }>('/:id/rankings', async (request, reply) => {
    try {
      const { id } = idParamSchema.parse(request.params);
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
        .orderBy(
          desc(rankingsTable.elo),
          desc(rankingsTable.wins),
          asc(rankingsTable.losses),
          asc(rankingsTable.id),
        );
      const rankings = shapeRankings(rows);
      return reply.code(200).send({ rankings });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      reply.code(500).send({ error: 'Internal error' });
    }
  });
};
