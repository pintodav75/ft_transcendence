import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { laddersTable, gamesTable } from '../db/schema.js';

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
};
