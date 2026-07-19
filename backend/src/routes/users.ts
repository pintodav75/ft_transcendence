import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { usersTable } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import z from 'zod';
import { minioClient, BUCKET_NAME, buildPublicUrl } from '../storage/minio.js';
import { isBlocked } from '../utils/blocks.js';
import { randomUUID } from 'node:crypto';
import { verifyPassword } from '../auth/password.js';
import speakeasy from 'speakeasy';

const patchProfileSchema = z
  .object({
    displayName: z.string().min(1).max(50),
    bio: z.string().max(280),
  })
  .partial();

export const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

const deleteSchema = z.object({
  password: z.string().optional(),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const userRoutes: FastifyPluginAsync = async (server) => {
  server.get('/me', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
      return { user: userSafe };
    } catch (error) {
      reply.code(500).send({ error: 'internal error' });
    }
  });
  server.patch('/me', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const data = patchProfileSchema.parse(request.body);
      if (Object.keys(data).length === 0)
        return reply.code(400).send({ error: 'no fields to update' });
      const [user] = await db
        .update(usersTable)
        .set(data)
        .where(eq(usersTable.id, userId))
        .returning();
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
      return { user: userSafe };
    } catch (err) {
      if (err instanceof z.ZodError) reply.code(400).send({ errors: err.issues });
      else reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get<{ Params: { pseudo: string } }>(
    '/:pseudo',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const pseudo = request.params.pseudo;
        const [user] = await db
          .select()
          .from(usersTable)
          .where(sql`lower(${usersTable.pseudo}) = lower(${pseudo})`);
        if (!user) return reply.code(404).send({ error: 'Profile not found' });
        if (await isBlocked(request.user.sub, user.id)) {
          return reply.code(404).send({ error: 'Profile not found' });
        }
        const {
          passwordHash: _,
          email: _email,
          updatedAt: _updatedAt,
          totpSecret: _ts,
          totpEnabled: _te,
          ...userSafe
        } = user;
        return { user: userSafe };
      } catch (error) {
        reply.code(500).send({ error: 'internal error' });
      }
    },
  );
  server.post(
    '/me/avatar',
    {
      onRequest: [server.authenticate],
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!request.isMultipart())
        return reply.code(400).send({ error: 'expected multipart/form-data' });
      try {
        const file = await request.file();
        if (!file) return reply.code(400).send({ error: 'no file uploaded' });
        if (!(file.mimetype in MIME_TO_EXT))
          return reply.code(400).send({ error: 'unsupported file type' });
        const id = randomUUID();
        const ext = MIME_TO_EXT[file.mimetype as keyof typeof MIME_TO_EXT];
        const filename = `${id}.${ext}`;
        await minioClient.putObject(BUCKET_NAME, filename, file.file, undefined, {
          'Content-Type': file.mimetype,
        });
        const [user] = await db
          .update(usersTable)
          .set({ avatarUrl: buildPublicUrl(filename) })
          .where(eq(usersTable.id, request.user.sub))
          .returning();
        if (!user) return reply.code(401).send({ error: 'Unauthorized' });
        const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
        return { user: userSafe };
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'FST_REQ_FILE_TOO_LARGE'
        )
          reply.code(413).send({ error: 'File too large' });
        else reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.delete('/me', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const data = deleteSchema.parse(request.body);
      const userId = request.user.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(404).send({ error: 'user not found' });
      if (user.passwordHash) {
        if (!data.password) return reply.code(400).send({ error: 'password required' });
        if (!(await verifyPassword(data.password, user.passwordHash)))
          return reply.code(401).send({ error: 'invalid credentials' });
      }
      if (user.totpEnabled) {
        if (!data.totpCode) return reply.code(400).send({ error: 'totp code required' });
        if (!user.totpSecret) return reply.code(500).send({ error: 'Internal error' });
        const verified = speakeasy.totp.verify({
          secret: user.totpSecret,
          encoding: 'base32',
          token: data.totpCode,
          window: 1,
        });
        if (!verified) return reply.code(401).send({ error: 'invalid code' });
      }

      if (user.avatarUrl) {
        const filename = user.avatarUrl.split('/').pop();
        if (filename) {
          try {
            await minioClient.removeObject(BUCKET_NAME, filename);
          } catch (err) {
            request.log.warn({ err }, 'Failed to remove avatar from MinIO');
          }
        }
      }
      await db.delete(usersTable).where(eq(usersTable.id, userId));
      reply.clearCookie('refresh', { path: '/auth' });
      return reply.code(200).send({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ errors: err.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
};
