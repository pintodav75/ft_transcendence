import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import z from 'zod';
import { eq, and, or } from 'drizzle-orm';
import { friendshipsTable, messagesTable } from '../db/schema.js';
import { db } from '../db/index.js';
import { redisClient } from '../storage/redis.js';
import { isBlocked } from '../utils/blocks.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

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

// Exporté depuis B9 : le système de notifications pousse ses events sur les MÊMES sockets
// que le chat (un seul WebSocket par client, pas deux). Multi-socket déjà géré (Set).
export function sendToUser(userId: string, payload: string) {
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
        const payload = server.jwt.verify<{
          sub: string;
          type?: 'access' | 'refresh';
          pending?: 'totp';
        }>(token);
        // Même garde que `server.authenticate` (server.ts) : un tempToken 2FA (émis après
        // mot de passe correct, AVANT le code TOTP) est un JWT valide — sans ce contrôle,
        // il ouvrirait le socket comme un vrai accessToken (chat + notifications live)
        // pour quiconque possède juste le mot de passe. Review B9 (Walid, 20/07).
        // Idem pour le refresh token (7 j) depuis T2 : seul `type: 'access'` ouvre le socket.
        if (payload.pending || payload.type !== 'access') {
          socket.close(1008, 'Invalid token');
          return;
        }
        userId = payload.sub;
      } catch (err) {
        socket.close(1008, 'Invalid token');
        return;
      }

      addSocket(userId, socket);
      const isFirstSocket = userSockets.get(userId)?.size === 1;

      let isAlive = true;
      socket.on('pong', () => {
        isAlive = true;
      });
      const heartbeat = setInterval(() => {
        if (!isAlive) {
          socket.terminate();
          return;
        }
        isAlive = false;
        socket.ping();
      }, HEARTBEAT_INTERVAL_MS);

      await redisClient.sAdd('online_users', userId);

      const friendIds = await getFriendIds(userId);
      const onlineFriendIds = friendIds.filter((friendId) => userSockets.has(friendId));
      socket.send(JSON.stringify({ type: 'initial_presence', onlineFriendIds }));

      if (isFirstSocket) {
        await broadcastPresence(userId, true);
      }
      console.log(`User ${userId} connected (socket #${userSockets.get(userId)?.size})`);

      socket.on('close', async () => {
        clearInterval(heartbeat);
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
            socket.send(JSON.stringify({ type: 'error', code: 'not_friends' }));
            return;
          }
          if (await isBlocked(userId, data.to)) {
            socket.send(JSON.stringify({ type: 'error', code: 'blocked' }));
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
          socket.send(JSON.stringify({ type: 'error', code: 'invalid_message_format' }));
        }
      });
    },
  );
};
