import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../db/index.js';
import { usersTable, friendshipsTable } from '../db/schema.js';
import { eq, and, or } from 'drizzle-orm';
import { isBlocked } from '../utils/blocks.js';
const friendsSchema = z.object({
  addresseeId: z.uuid(),
});

export const friendsRoutes: FastifyPluginAsync = async (server) => {
  server.post('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const requesterId = request.user.sub;
      const { addresseeId } = friendsSchema.parse(request.body);
      if (requesterId === addresseeId)
        return reply.code(400).send({ error: "can't friend yourself" });
      const [addresseeUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, addresseeId));
      if (!addresseeUser) return reply.code(404).send({ error: 'user not found' });
      if (await isBlocked(requesterId, addresseeId)) {
        return reply.code(404).send({ error: 'user not found' });
      }
      const [existing] = await db
        .select()
        .from(friendshipsTable)
        .where(
          or(
            and(
              eq(friendshipsTable.requesterId, requesterId),
              eq(friendshipsTable.addresseeId, addresseeId),
            ),
            and(
              eq(friendshipsTable.requesterId, addresseeId),
              eq(friendshipsTable.addresseeId, requesterId),
            ),
          ),
        );
      if (!existing) {
        const [created] = await db
          .insert(friendshipsTable)
          .values({ requesterId, addresseeId })
          .returning();
        return reply.code(201).send({ friendship: created });
      } else if (existing.status === 'accepted')
        return reply.code(400).send({ error: 'already friends' });
      else if (existing.status === 'pending' && existing.requesterId === addresseeId) {
        const [updated] = await db
          .update(friendshipsTable)
          .set({ status: 'accepted' })
          .where(eq(friendshipsTable.id, existing.id))
          .returning();
        return reply.code(200).send({ friendship: updated });
      } else if (existing.status === 'pending' && existing.requesterId === requesterId)
        return reply.code(400).send({ error: 'already requested' });
    } catch (error) {
      if (error instanceof z.ZodError) reply.code(400).send({ errors: error.issues });
      else return reply.code(500).send({ error: 'internal error' });
    }
  });
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const asRequester = await db
        .select()
        .from(friendshipsTable)
        .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.addresseeId))
        .where(
          and(eq(friendshipsTable.requesterId, userId), eq(friendshipsTable.status, 'accepted')),
        );
      const asAddressee = await db
        .select()
        .from(friendshipsTable)
        .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.requesterId))
        .where(
          and(eq(friendshipsTable.addresseeId, userId), eq(friendshipsTable.status, 'accepted')),
        );
      const allRows = [...asRequester, ...asAddressee];
      const friends = allRows.map((row) => ({
        id: row.users.id,
        pseudo: row.users.pseudo,
        displayName: row.users.displayName,
        avatarUrl: row.users.avatarUrl,
        since: row.friendships.updatedAt,
      }));
      return reply.code(200).send({ friends });
    } catch (err) {
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get('/requests', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const res = await db
        .select()
        .from(friendshipsTable)
        .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.requesterId))
        .where(
          and(eq(friendshipsTable.addresseeId, userId), eq(friendshipsTable.status, 'pending')),
        );
      const requests = res.map((row) => ({
        id: row.friendships.id,
        sentAt: row.friendships.createdAt,
        from: {
          id: row.users.id,
          pseudo: row.users.pseudo,
          displayName: row.users.displayName,
          avatarUrl: row.users.avatarUrl,
        },
      }));
      return reply.code(200).send({ requests });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.post<{ Params: { id: string } }>(
    '/:id/accept',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const friendshipId = request.params.id;
        const [friendship] = await db
          .select()
          .from(friendshipsTable)
          .where(eq(friendshipsTable.id, friendshipId));
        if (!friendship) return reply.code(404).send({ error: 'friendship not found' });
        if (friendship.addresseeId !== userId)
          return reply.code(403).send({ error: 'not authorized' });
        if (friendship.status !== 'pending')
          return reply.code(400).send({ error: 'already friends' });
        const [updated] = await db
          .update(friendshipsTable)
          .set({ status: 'accepted' })
          .where(eq(friendshipsTable.id, friendshipId))
          .returning();
        return reply.code(200).send({ friendship: updated });
      } catch (error) {
        reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.post<{ Params: { id: string } }>(
    '/:id/reject',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const friendshipId = request.params.id;
        const [friendship] = await db
          .select()
          .from(friendshipsTable)
          .where(eq(friendshipsTable.id, friendshipId));
        if (!friendship) return reply.code(404).send({ error: 'friendship not found' });
        if (friendship.addresseeId !== userId)
          return reply.code(403).send({ error: 'not authorized' });
        if (friendship.status !== 'pending')
          return reply.code(400).send({ error: 'already friends' });
        await db.delete(friendshipsTable).where(eq(friendshipsTable.id, friendshipId));
        return reply.code(200).send({ ok: true });
      } catch (error) {
        reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const friendshipId = request.params.id;
        const [friendship] = await db
          .select()
          .from(friendshipsTable)
          .where(eq(friendshipsTable.id, friendshipId));
        if (!friendship) return reply.code(404).send({ error: 'friendship not found' });
        if (friendship.requesterId !== userId && friendship.addresseeId !== userId)
          return reply.code(403).send({ error: 'not authorized' });
        if (friendship.status !== 'accepted')
          return reply.code(400).send({ error: 'no active friendship to delete' });
        await db.delete(friendshipsTable).where(eq(friendshipsTable.id, friendshipId));
        return reply.code(200).send({ ok: true });
      } catch (error) {
        reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
