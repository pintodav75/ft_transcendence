import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { blocksTable, friendshipsTable, usersTable } from '../db/schema.js';
import { eq, or, and } from 'drizzle-orm';
import z from 'zod';

const userIdParamSchema = z.object({ userId: z.uuid() });

export const blocksRoutes: FastifyPluginAsync = async (server) => {
  server.post<{ Params: { userId: string } }>(
    '/:userId',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const blockerId = request.user.sub;
        const { userId: blockedId } = userIdParamSchema.parse(request.params);
        if (blockerId === blockedId)
          return reply.code(400).send({ error: 'cannot block yourself' });
        const [user] = await db.select().from(usersTable).where(eq(usersTable.id, blockedId));
        if (!user) return reply.code(404).send({ error: 'user not found' });
        // Blocking has two database effects but one business meaning: sever every friendship
        // or pending request, then create the block. They must commit together; otherwise an
        // insert failure after the delete would leave the users unrelated but not blocked.
        await db.transaction(async (tx) => {
          await tx
            .delete(friendshipsTable)
            .where(
              or(
                and(
                  eq(friendshipsTable.requesterId, blockerId),
                  eq(friendshipsTable.addresseeId, blockedId),
                ),
                and(
                  eq(friendshipsTable.requesterId, blockedId),
                  eq(friendshipsTable.addresseeId, blockerId),
                ),
              ),
            );
          await tx.insert(blocksTable).values({ blockerId, blockedId });
        });
        return reply.code(201).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        if (
          typeof error === 'object' &&
          error !== null &&
          'cause' in error &&
          typeof error.cause === 'object' &&
          error.cause !== null &&
          'code' in error.cause &&
          error.cause.code === '23505'
        )
          return reply.code(400).send({ error: 'already blocked' });
        else return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  server.delete<{ Params: { userId: string } }>(
    '/:userId',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const blockerId = request.user.sub;
        const { userId: blockedId } = userIdParamSchema.parse(request.params);
        await db
          .delete(blocksTable)
          .where(and(eq(blocksTable.blockerId, blockerId), eq(blocksTable.blockedId, blockedId)));
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const blockerId = request.user.sub;
      const data = await db
        .select()
        .from(blocksTable)
        .innerJoin(usersTable, eq(usersTable.id, blocksTable.blockedId))
        .where(eq(blocksTable.blockerId, blockerId));
      const blockedFriends = data.map((row) => ({
        id: row.users.id,
        pseudo: row.users.pseudo,
        displayName: row.users.displayName,
        avatarUrl: row.users.avatarUrl,
        since: row.blocks.createdAt,
      }));
      return reply.code(200).send({ blocks: blockedFriends });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
};
