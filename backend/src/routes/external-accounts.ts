import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { userExternalAccountsTable, providerEnum } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import z from 'zod';

const externalSchema = z.object({
  provider: z.enum(providerEnum.enumValues),
  externalId: z.string().trim().min(1).max(30),
});

export const externalAccountsRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const accounts = await db
        .select({
          provider: userExternalAccountsTable.provider,
          externalId: userExternalAccountsTable.externalId,
          verified: userExternalAccountsTable.verified,
        })
        .from(userExternalAccountsTable)
        .where(eq(userExternalAccountsTable.userId, userId));
      return reply.code(200).send({ externalAccounts: accounts });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.post('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    try {
      const data = externalSchema.parse(request.body);
      const [account] = await db
        .insert(userExternalAccountsTable)
        .values({ userId, provider: data.provider, externalId: data.externalId })
        .returning({
          provider: userExternalAccountsTable.provider,
          externalId: userExternalAccountsTable.externalId,
          verified: userExternalAccountsTable.verified,
        });

      reply.code(201).send({ externalAccount: account });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ errors: err.issues });
      if (
        typeof err === 'object' &&
        err !== null &&
        'cause' in err &&
        typeof err.cause === 'object' &&
        err.cause !== null &&
        'code' in err.cause &&
        err.cause.code === '23505'
      )
        return reply.code(409).send({ error: 'provider already linked' });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.delete<{ Params: { provider: string } }>(
    '/:provider',
    {
      onRequest: [server.authenticate],
    },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const provider = z.enum(providerEnum.enumValues).parse(request.params.provider);
        await db
          .delete(userExternalAccountsTable)
          .where(
            and(
              eq(userExternalAccountsTable.userId, userId),
              eq(userExternalAccountsTable.provider, provider),
            ),
          );
        reply.code(200).send({ ok: true });
      } catch (err) {
        if (err instanceof z.ZodError) return reply.code(400).send({ errors: err.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
