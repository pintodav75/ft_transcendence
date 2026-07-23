import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../../db/index.js';
import { usersTable } from '../../db/schema.js';
import { signAccessToken, signRefreshToken } from '../../auth/tokens.js';
import { setRefreshCookie } from '../../auth/cookies.js';
import { eq } from 'drizzle-orm';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const verify2faSchema = z.object({
  tempToken: z.string(),
  code: z.string().regex(/^\d{6}$/),
});

export const twoFactorRoutes: FastifyPluginAsync = async (server) => {
  server.post('/setup', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      if (user.totpEnabled) return reply.code(400).send({ error: '2FA already enabled' });
      const secret = speakeasy.generateSecret({
        name: `${user.email}`,
        issuer: 'ft_transcendence',
      });
      const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url!);
      await db
        .update(usersTable)
        .set({ totpSecret: secret.base32 })
        .where(eq(usersTable.id, userId));
      return reply.code(200).send({ secret: secret.base32, qrCodeDataUrl });
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.post('/enable', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const data = codeSchema.parse(request.body);
      const userId = request.user.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      if (!user.totpSecret) return reply.code(400).send({ error: '2FA not set up yet' });
      if (user.totpEnabled) return reply.code(400).send({ error: '2FA already enabled' });
      const verified = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: data.code,
        window: 1,
      });
      if (!verified) return reply.code(400).send({ error: 'invalid code' });
      await db.update(usersTable).set({ totpEnabled: true }).where(eq(usersTable.id, userId));
      return { ok: true };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      else return reply.code(500).send({ error: 'internal error' });
    }
  });
  server.post('/disable', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const data = codeSchema.parse(request.body);
      const userId = request.user.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      if (!user.totpEnabled || !user.totpSecret)
        return reply.code(400).send({ error: '2FA not enabled' });
      const verified = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: data.code,
        window: 1,
      });
      if (!verified) return reply.code(400).send({ error: 'invalid code' });
      await db
        .update(usersTable)
        .set({ totpSecret: null, totpEnabled: false })
        .where(eq(usersTable.id, userId));
      return { ok: true };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      else return reply.code(500).send({ error: 'internal error' });
    }
  });
  server.post(
    '/verify',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
    try {
      const data = verify2faSchema.parse(request.body);
      const payload = server.jwt.verify<{ sub: string; pending: string }>(data.tempToken);
      if (payload.pending !== 'totp') return reply.code(401).send({ error: 'Invalid token type' });
      const userId = payload.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      if (!user.totpEnabled || !user.totpSecret)
        return reply.code(400).send({ error: '2FA not enabled' });
      const verified = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: data.code,
        window: 1,
      });
      if (!verified) return reply.code(400).send({ error: 'invalid code' });
      const accessToken = signAccessToken(request.server, { sub: user.id });
      const refreshToken = signRefreshToken(request.server, { sub: user.id });
      setRefreshCookie(reply, refreshToken);
      const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
      return reply.code(200).send({ accessToken, user: userSafe });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      else return reply.code(401).send({ error: 'Invalid or expired tempToken' });
    }
  },
  );
};
