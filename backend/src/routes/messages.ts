import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { usersTable, friendshipsTable, messagesTable } from '../db/schema.js';
import { eq, and, or, desc } from 'drizzle-orm';
import { isBlocked } from '../utils/blocks.js';
import z from 'zod';

const friendIdParamSchema = z.object({ friendId: z.uuid() });

export const messagesRoutes: FastifyPluginAsync = async (server) => {
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
