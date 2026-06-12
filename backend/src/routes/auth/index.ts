import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { usersTable } from '../../db/schema.js';
import { db } from '../../db/index.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { signAccessToken, signRefreshToken, signTempToken } from '../../auth/tokens.js';
import { eq } from 'drizzle-orm';

const registerSchema = z.object({
  pseudo: z.string().min(3).max(30),
  email: z.email(),
  password: z
    .string()
    .min(8, 'au moins 8 caractères')
    .regex(/[A-Z]/, 'au moins une majuscule')
    .regex(/[a-z]/, 'au moins une minuscule')
    .regex(/\d/, 'au moins un chiffre')
    .regex(/[^A-Za-z0-9]/, 'au moins un caractère spécial'),
});

const loginSchema = z.object({
  email: z.string(),
  password: z.string(),
});

export const authBasicRoutes: FastifyPluginAsync = async (server) => {
  server.post('/register', async (request, reply) => {
    try {
      const data = registerSchema.parse(request.body);
      const passwordHash = await hashPassword(data.password);
      const [user] = await db
        .insert(usersTable)
        .values({
          pseudo: data.pseudo,
          email: data.email,
          passwordHash: passwordHash,
        })
        .returning();
      if (!user) throw new Error('Insert returned no row');
      const accessToken = signAccessToken(request.server, { sub: user.id });
      const refreshToken = signRefreshToken(request.server, { sub: user.id });
      reply.setCookie('refresh', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/auth',
        maxAge: 60 * 60 * 24 * 7,
      });
      const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
      return reply.code(201).send({ accessToken, user: userSafe });
    } catch (err) {
      if (err instanceof z.ZodError) reply.code(400).send({ errors: err.issues });
      else if (
        typeof err === 'object' &&
        err !== null &&
        'cause' in err &&
        typeof err.cause === 'object' &&
        err.cause !== null &&
        'code' in err.cause &&
        err.cause.code === '23505'
      )
        reply.code(409).send({ error: 'Pseudo or email already taken' });
      else reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.post('/login', async (request, reply) => {
    try {
      const data = loginSchema.parse(request.body);
      const [user] = await db.select().from(usersTable).where(eq(usersTable.email, data.email));
      if (!user) return reply.code(401).send({ error: 'invalid credentials' });
      if (!user.passwordHash) return reply.code(401).send({ error: 'invalid credentials' });
      const ok = await verifyPassword(data.password, user.passwordHash);
      if (!ok) return reply.code(401).send({ error: 'Invalid credentials' });
      if (user.totpEnabled) {
        const tempToken = signTempToken(request.server, { sub: user.id, pending: 'totp' });
        return reply.code(200).send({ requires2FA: true, tempToken });
      }
      const accessToken = signAccessToken(request.server, { sub: user.id });
      const refreshToken = signRefreshToken(request.server, { sub: user.id });
      reply.setCookie('refresh', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/auth',
        maxAge: 60 * 60 * 24 * 7,
      });
      const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
      return reply.code(200).send({ accessToken, user: userSafe });
    } catch (err) {
      if (err instanceof z.ZodError) reply.code(400).send({ errors: err.issues });
      else reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get('/me', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
      return reply.code(200).send({ user: userSafe });
    } catch (err) {
      reply.code(500).send({ error: 'internal error' });
    }
  });
  server.post('/refresh', async (request, reply) => {
    try {
      const refreshToken = request.cookies.refresh;
      if (!refreshToken) return reply.code(401).send({ error: 'Missing refresh token' });
      const payload = server.jwt.verify<{ sub: string }>(refreshToken);
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
      if (!user) return reply.code(401).send({ error: 'Invalid refresh token' });
      const accessToken = signAccessToken(request.server, { sub: user.id });
      return reply.code(200).send({ accessToken });
    } catch (err) {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
  });
  server.post('/logout', async (request, reply) => {
    reply.clearCookie('refresh', { path: '/auth' });
    return reply.code(200).send({ ok: true });
  });
};
