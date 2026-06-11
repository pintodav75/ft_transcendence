import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../db/index.js';
import { usersTable } from '../db/schema.js';
import { hashPassword } from '../auth/password.js';
import { signAccessToken, signRefreshToken, signTempToken } from '../auth/tokens.js';
import { and, eq } from 'drizzle-orm';
import { verifyPassword } from '../auth/password.js';
import { randomUUID } from 'node:crypto';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';

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

const googleUserSchema = z.object({
  id: z.string(),
  email: z.string(),
});

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const verify2faSchema = z.object({
  tempToken: z.string(),
  code: z.string().regex(/^\d{6}$/),
});

export const authRoutes: FastifyPluginAsync = async (server) => {
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

  server.get('/oauth/google/callback', async (request, reply) => {
    try {
      let user;
      const { token } =
        await request.server.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const fetchResult = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: 'Bearer ' + token.access_token,
        },
      });
      const data = googleUserSchema.parse(await fetchResult.json());
      const [existing] = await db
        .select()
        .from(usersTable)
        .where(and(eq(usersTable.oauthProvider, 'google'), eq(usersTable.oauthId, data.id)));
      if (existing) user = existing;
      else {
        const [existingByEmail] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.email, data.email));
        if (existingByEmail) {
          const [linked] = await db
            .update(usersTable)
            .set({ oauthProvider: 'google', oauthId: data.id })
            .where(eq(usersTable.id, existingByEmail.id))
            .returning();
          user = linked;
        } else {
          const pseudo = (data.email.split('@')[0] ?? data.email).slice(0, 20);
          const suffix = randomUUID().slice(0, 4);
          const newPseudo = `${pseudo}_${suffix}`;
          const [created] = await db
            .insert(usersTable)
            .values({
              pseudo: newPseudo,
              email: data.email,
              oauthProvider: 'google',
              oauthId: data.id,
            })
            .returning();
          user = created;
        }
      }
      if (!user) throw new Error('No user resolved');
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
    } catch (error) {
      return reply.code(500).send({ error: 'OAuth login failed' });
    }
  });
  server.post('/2fa/setup', { onRequest: [server.authenticate] }, async (request, reply) => {
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
  server.post('/2fa/enable', { onRequest: [server.authenticate] }, async (request, reply) => {
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
  server.post('/2fa/disable', { onRequest: [server.authenticate] }, async (request, reply) => {
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
  server.post('/2fa/verify', async (request, reply) => {
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
      reply.setCookie('refresh', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/auth',
        maxAge: 60 * 60 * 24 * 7,
      });
      const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
      return reply.code(200).send({ accessToken, user: userSafe });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      else return reply.code(401).send({ error: 'Invalid or expired tempToken' });
    }
  });
};
