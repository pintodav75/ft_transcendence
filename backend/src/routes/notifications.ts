import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../db/index.js';
import { notificationsTable } from '../db/schema.js';
import { eq, and, lt, or, isNull, desc, sql } from 'drizzle-orm';

/**
 * Lecture/gestion de MES notifications. Trois routes, AUCUNE route de création :
 * les notifications sont écrites exclusivement par le système (helper notify() appelé
 * depuis matches/disputes/jobs) → zéro vecteur de spam côté client.
 */

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});
const idParamSchema = z.object({ id: z.uuid() });

export const notificationsRoutes: FastifyPluginAsync = async (server) => {
  // GET /notifications?limit=&cursor= — mes notifs, plus récentes d'abord, + unreadCount.
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const { limit, cursor } = listQuerySchema.parse(request.query);
      const me = request.user.sub;

      const conditions = [eq(notificationsTable.userId, me)];

      // Pagination par CURSEUR (keyset), pas par offset : la liste bouge en permanence
      // (chaque event insère en tête) — un offset ferait sauter ou doubler des lignes
      // entre deux pages. Le curseur = l'id du dernier élément de la page précédente.
      if (cursor) {
        const [anchor] = await db
          .select({ createdAt: notificationsTable.createdAt })
          .from(notificationsTable)
          .where(and(eq(notificationsTable.id, cursor), eq(notificationsTable.userId, me)));
        // Curseur inconnu OU pas à moi → même 400 dans les deux cas (pas d'oracle sur
        // l'existence des notifs d'autrui).
        if (!anchor) return reply.code(400).send({ error: 'invalid cursor' });
        // Tri (created_at, id) désc + comparaison composite : le fan-out insère plusieurs
        // notifs au MÊME created_at (un INSERT multi-lignes) — départager par id évite de
        // perdre des lignes à cheval sur deux pages.
        conditions.push(
          or(
            lt(notificationsTable.createdAt, anchor.createdAt),
            and(
              eq(notificationsTable.createdAt, anchor.createdAt),
              lt(notificationsTable.id, cursor),
            ),
          )!,
        );
      }

      // Projection SANS user_id : c'est toujours « moi », le renvoyer n'apporte rien.
      // On fetch limit+1 : si la ligne EN TROP existe, il y a VRAIMENT une suite ; si le
      // total restant valait pile `limit`, elle n'existe pas et nextCursor sera null au
      // lieu de pointer sur une page suivante vide (ancien bug : `length === limit` ne
      // distingue pas « il en reste » de « il en restait exactement limit »).
      const rows = await db
        .select({
          id: notificationsTable.id,
          type: notificationsTable.type,
          data: notificationsTable.data,
          readAt: notificationsTable.readAt,
          createdAt: notificationsTable.createdAt,
        })
        .from(notificationsTable)
        .where(and(...conditions))
        .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const notifications = hasMore ? rows.slice(0, limit) : rows;

      // Le badge de la cloche : compté sur TOUTES mes non-lues, pas seulement la page.
      // 1 requête liste + 1 requête count = pas de N+1.
      const [unread] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(notificationsTable)
        .where(and(eq(notificationsTable.userId, me), isNull(notificationsTable.readAt)));

      const last = notifications.at(-1);
      const nextCursor = hasMore && last ? last.id : null;

      return reply.code(200).send({ notifications, unreadCount: unread?.n ?? 0, nextCursor });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // PATCH /notifications/:id/read — marquer UNE notif lue. Idempotente.
  server.patch<{ Params: { id: string } }>(
    '/:id/read',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const me = request.user.sub;

        // La notif d'un AUTRE user → le MÊME 404 qu'une notif inexistante : répondre 403
        // confirmerait à l'appelant que cet id existe chez quelqu'un (oracle).
        const [notification] = await db
          .select({ readAt: notificationsTable.readAt })
          .from(notificationsTable)
          .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, me)));
        if (!notification) return reply.code(404).send({ error: 'notification not found' });

        // Déjà lue → 200 sans réécrire read_at (idempotent : re-marquer ne change rien,
        // et on garde l'horodatage de la PREMIÈRE lecture).
        if (notification.readAt === null) {
          await db
            .update(notificationsTable)
            .set({ readAt: new Date() })
            .where(and(eq(notificationsTable.id, id), isNull(notificationsTable.readAt)));
        }
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  // PATCH /notifications/read-all — tout marquer lu. Idempotente (deuxième appel : 0 ligne).
  server.patch('/read-all', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const me = request.user.sub;
      const updated = await db
        .update(notificationsTable)
        .set({ readAt: new Date() })
        .where(and(eq(notificationsTable.userId, me), isNull(notificationsTable.readAt)))
        .returning({ id: notificationsTable.id });
      return reply.code(200).send({ ok: true, updated: updated.length });
    } catch (error) {
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
};
