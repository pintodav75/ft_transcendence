import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import z from 'zod';
import { eq, and, or } from 'drizzle-orm';
import { friendshipsTable, messagesTable } from '../db/schema.js';
import { db } from '../db/index.js';
import { redisClient } from '../storage/redis.js';

const userSockets = new Map<string, Set<WebSocket>>();

function addSocket(userId: string, socket: WebSocket) {
  let sockets = userSockets.get(userId);
  if (!sockets) {
    sockets = new Set();
    userSockets.set(userId, sockets);
  }
  sockets.add(socket);
}

function removeSocket(userId: string, socket: WebSocket) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) {
    userSockets.delete(userId);
  }
}

function sendToUser(userId: string, payload: string) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  for (const s of sockets) {
    s.send(payload);
  }
}

async function getFriendIds(userId: string): Promise<string[]> {
  const friendships = await db
    .select()
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.status, 'accepted'),
        or(eq(friendshipsTable.requesterId, userId), eq(friendshipsTable.addresseeId, userId)),
      ),
    );
  return friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
}

async function broadcastPresence(userId: string, online: boolean) {
  const friendIds = await getFriendIds(userId);
  const payload = JSON.stringify({ type: 'presence', userId, online });
  for (const friendId of friendIds) {
    sendToUser(friendId, payload);
  }
}

const messageSchema = z.object({
  to: z.uuid(),
  content: z.string().min(1).max(1000),
});

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

      addSocket(userId, socket);
      const isFirstSocket = userSockets.get(userId)?.size === 1;

      await redisClient.sAdd('online_users', userId);

      const friendIds = await getFriendIds(userId);
      const onlineFriendIds = friendIds.filter((friendId) => userSockets.has(friendId));
      socket.send(JSON.stringify({ type: 'initial_presence', onlineFriendIds }));

      if (isFirstSocket) {
        await broadcastPresence(userId, true);
      }
      console.log(`User ${userId} connected (socket #${userSockets.get(userId)?.size})`);

      socket.on('close', async () => {
        removeSocket(userId, socket);
        const isLastSocket = !userSockets.has(userId);
        if (isLastSocket) {
          await redisClient.sRem('online_users', userId);
          await broadcastPresence(userId, false);
        }
        console.log(`User ${userId} disconnected (${isLastSocket ? 'last' : 'still has sockets'})`);
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

          sendToUser(data.to, JSON.stringify({ type: 'message', message: saved }));
          sendToUser(userId, JSON.stringify({ type: 'message_sent', message: saved }));
        } catch (err) {
          console.log('Message invalide, ignoré');
        }
      });
    },
  );
};
