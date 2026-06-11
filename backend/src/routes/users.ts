import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { usersTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import z from 'zod';
import { minioClient, BUCKET_NAME, buildPublicUrl } from '../storage/minio.js';
import { randomUUID } from 'node:crypto';

const patchProfileSchema = z
  .object({
    displayName: z.string().min(1).max(50),
    bio: z.string().max(280),
  })
  .partial();

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

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
        const [user] = await db.select().from(usersTable).where(eq(usersTable.pseudo, pseudo));
        if (!user) return reply.code(404).send({ error: 'Profile not found' });
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
  server.post('/me/avatar', { onRequest: [server.authenticate] }, async (request, reply) => {
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
  });
};
