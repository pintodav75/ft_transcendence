import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { usersTable, friendshipsTable, messagesTable } from '../db/schema.js';
import { eq, and, or, desc, sql } from 'drizzle-orm';
import { isBlocked } from '../utils/blocks.js';
import z from 'zod';

const friendIdParamSchema = z.object({ friendId: z.uuid() });

// Ligne brute renvoyée par la requête « dernier message par partenaire » (alias
// snake_case des colonnes SELECT). Projection EXPLICITE sur users : jamais de
// select nu qui fuiterait email/password_hash.
type ConversationRow = {
  message_id: string;
  content: string;
  sender_id: string;
  receiver_id: string;
  created_at: Date;
  friend_id: string;
  friend_pseudo: string;
  friend_display_name: string | null;
  friend_avatar_url: string | null;
};

export const messagesRoutes: FastifyPluginAsync = async (server) => {
  // Liste des conversations : pour chaque ami accepté avec qui j'ai échangé, le
  // DERNIER message. Alimente l'onglet Messages du rail social. Aucune présence
  // ici (elle vient du WebSocket côté front) — que du persistant.
  // ⚠️ Déclarée AVANT / à côté de /:friendId : Fastify matche les routes statiques
  // avant les paramétriques, donc « conversations » ne tombe pas dans /:friendId.
  server.get('/conversations', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const me = request.user.sub;
      // DISTINCT ON (partner) exige un ORDER BY commençant par partner : on isole
      // donc le dernier message par partenaire dans une sous-requête, puis on
      // ENVELOPPE pour trier la liste finale par date décroissante. Le partenaire
      // = l'autre personne du message. INNER JOIN friendships accepted => les
      // non-amis / ex-amis (amitié supprimée, donc pas de ligne accepted) sont
      // nativement exclus, et bloquer supprime déjà l'amitié (pas de check blocks
      // redondant, ce serait du code mort).
      const rows = (await db.execute(sql`
        SELECT
          last.id            AS message_id,
          last.content       AS content,
          last.sender_id     AS sender_id,
          last.receiver_id   AS receiver_id,
          last.created_at    AS created_at,
          u.id               AS friend_id,
          u.pseudo           AS friend_pseudo,
          u.display_name     AS friend_display_name,
          u.avatar_url       AS friend_avatar_url
        FROM (
          SELECT DISTINCT ON (partner)
            partner, id, content, sender_id, receiver_id, created_at
          FROM (
            SELECT
              CASE WHEN sender_id = ${me} THEN receiver_id ELSE sender_id END AS partner,
              id, content, sender_id, receiver_id, created_at
            FROM messages
            WHERE sender_id = ${me} OR receiver_id = ${me}
          ) AS mine
          ORDER BY partner, created_at DESC, id DESC
        ) AS last
        JOIN users u ON u.id = last.partner
        JOIN friendships f
          ON f.status = 'accepted'
         AND (
           (f.requester_id = ${me} AND f.addressee_id = last.partner)
           OR (f.addressee_id = ${me} AND f.requester_id = last.partner)
         )
        ORDER BY last.created_at DESC, last.id DESC
      `)) as unknown as ConversationRow[];

      const conversations = rows.map((row) => ({
        friend: {
          id: row.friend_id,
          pseudo: row.friend_pseudo,
          displayName: row.friend_display_name,
          avatarUrl: row.friend_avatar_url,
        },
        lastMessage: {
          id: row.message_id,
          senderId: row.sender_id,
          receiverId: row.receiver_id,
          content: row.content,
          createdAt: row.created_at,
        },
      }));
      return reply.code(200).send({ conversations });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.get<{ Params: { friendId: string } }>(
    '/:friendId',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const { friendId } = friendIdParamSchema.parse(request.params);
        const [friend] = await db.select().from(usersTable).where(eq(usersTable.id, friendId));
        if (!friend) return reply.code(404).send({ error: 'friend not found' });
        if (await isBlocked(userId, friendId)) {
          return reply.code(404).send({ error: 'friend not found' });
        }
        const [friendship] = await db
          .select()
          .from(friendshipsTable)
          .where(
            and(
              eq(friendshipsTable.status, 'accepted'),
              or(
                and(
                  eq(friendshipsTable.requesterId, userId),
                  eq(friendshipsTable.addresseeId, friendId),
                ),
                and(
                  eq(friendshipsTable.requesterId, friendId),
                  eq(friendshipsTable.addresseeId, userId),
                ),
              ),
            ),
          );
        if (!friendship) return reply.code(403).send({ error: 'not friends' });
        const result = await db
          .select()
          .from(messagesTable)
          .where(
            or(
              and(eq(messagesTable.senderId, userId), eq(messagesTable.receiverId, friendId)),
              and(eq(messagesTable.receiverId, userId), eq(messagesTable.senderId, friendId)),
            ),
          )
          .orderBy(desc(messagesTable.createdAt))
          .limit(100);
        const messages = result.reverse();
        return reply.code(200).send({ messages });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
