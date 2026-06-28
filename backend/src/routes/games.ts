import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { gamesTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const gamesRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', async (request, reply) => {
    try {
      const games = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.isActive, true))
        .orderBy(gamesTable.name);
      return reply.code(200).send({ games: games });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const gameId = request.params.id;
      const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId));
      if (!game || !game.isActive) return reply.code(404).send({ error: 'cannot find game' });
      return reply.code(200).send({ game: game });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
};
