import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { gamesTable, gameMapsTable } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
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
      // Le pool de maps appartient au JEU : c'est ICI sa place naturelle, `GET /ladders/{id}`
      // ne le sert que parce qu'une page ladder en a eu besoin la première. Même table que
      // celle où `POST /matches` pioche les maps d'un match (routes/matches.ts), donc une
      // page ne peut pas annoncer des maps que le serveur n'attribuera pas.
      // ⚠️ Un tableau VIDE n'est pas une erreur : seuls cs2 et val ont des maps.
      // La requête part après le 404 — inutile de chercher le pool d'un jeu inactif.
      const maps = await db
        .select({ name: gameMapsTable.name })
        .from(gameMapsTable)
        .where(eq(gameMapsTable.gameId, game.id))
        .orderBy(asc(gameMapsTable.name));
      return reply.code(200).send({ game: game, maps: maps.map((map) => map.name) });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      reply.code(500).send({ error: 'Internal error' });
    }
  });
};
