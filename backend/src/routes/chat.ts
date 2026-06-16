import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import z from 'zod';
import { eq, and, or } from 'drizzle-orm';
import { friendshipsTable, messagesTable } from '../db/schema.js';
import { db } from '../db/index.js';
import { redisClient } from '../storage/redis.js';

async function broadcastPresence(userId: string, online: boolean) {
  const friendships = await db
    .select()
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.status, 'accepted'),
        or(eq(friendshipsTable.requesterId, userId), eq(friendshipsTable.addresseeId, userId)),
      ),
    );

  const friendIds = friendships.map((f) =>
    f.requesterId === userId ? f.addresseeId : f.requesterId,
  );

  const payload = JSON.stringify({ type: 'presence', userId, online });
  for (const friendId of friendIds) {
    const friendSocket = userSockets.get(friendId);
    if (friendSocket) {
      friendSocket.send(payload);
    }
  }
}

const messageSchema = z.object({
  to: z.uuid(),
  content: z.string().min(1).max(1000),
});

const userSockets = new Map<string, WebSocket>();

export const chatRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Querystring: { token: string } }>(
    '/chat',
    { websocket: true },
    async (socket, req) => {
      const token = req.query.token;
      let userId: string;
      try {
        const payload = server.jwt.verify<{ sub: string }>(token);
        userId = payload.sub;
      } catch (err) {
        socket.close(1008, 'Invalid token');
        return;
      }
      userSockets.set(userId, socket);
      await redisClient.sAdd('online_users', userId);
      await broadcastPresence(userId, true);
      console.log(`User ${userId} connected (Redis)`);
      socket.on('close', async () => {
        userSockets.delete(userId);
        await redisClient.sRem('online_users', userId);
        await broadcastPresence(userId, false);
        console.log(`User ${userId} disconnected (Redis)`);
      });
      socket.on('message', async (rawData) => {
        try {
          const parsed = JSON.parse(rawData.toString());
          const data = messageSchema.parse(parsed);
          console.log('Message validé:', data);
          const [friendship] = await db
            .select()
            .from(friendshipsTable)
            .where(
              and(
                eq(friendshipsTable.status, 'accepted'),
                or(
                  and(
                    eq(friendshipsTable.requesterId, userId),
                    eq(friendshipsTable.addresseeId, data.to),
                  ),
                  and(
                    eq(friendshipsTable.requesterId, data.to),
                    eq(friendshipsTable.addresseeId, userId),
                  ),
                ),
              ),
            );

          if (!friendship) {
            console.log('Not friends, message ignored');
            return;
          }
          const [saved] = await db
            .insert(messagesTable)
            .values({
              senderId: userId,
              receiverId: data.to,
              content: data.content,
            })
            .returning();
          const recipientSocket = userSockets.get(data.to);
          if (recipientSocket) {
            recipientSocket.send(
              JSON.stringify({
                type: 'message',
                message: saved,
              }),
            );
          }
          socket.send(
            JSON.stringify({
              type: 'message_sent',
              message: saved,
            }),
          );
        } catch (err) {
          console.log('Message invalide, ignoré');
        }
      });
    },
  );
};
