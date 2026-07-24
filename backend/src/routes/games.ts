import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { gamesTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import z from 'zod';

// `games.id` est un PK **text** (slugs : `val`, `cs2`…), pas un uuid : un param malformé
// ne casse aucune requête. On borne quand même l'entrée par cohérence avec les autres
// routes. Un slug bien formé mais inconnu reste un 404, pas un 400.
const idParamSchema = z.object({ id: z.string().min(1).max(50) });

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
      const { id: gameId } = idParamSchema.parse(request.params);
      const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId));
      if (!game || !game.isActive) return reply.code(404).send({ error: 'cannot find game' });
      return reply.code(200).send({ game: game });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      reply.code(500).send({ error: 'Internal error' });
    }
  });
};
