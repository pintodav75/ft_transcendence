import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../../db/index.js';
import { usersTable } from '../../db/schema.js';
import { signAccessToken, signRefreshToken } from '../../auth/tokens.js';
import { setRefreshCookie } from '../../auth/cookies.js';
import { eq } from 'drizzle-orm';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { twoFactorVerifyAccountKey, twoFactorVerifyRateLimitKey } from '../../utils/rate-limit.js';

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
  // ── B12 — le budget d'essais de `/verify` est PAR COMPTE, pas par adresse ────────────────
  //
  // Deux compteurs à deux étages, et il en FAUT deux :
  //
  //  ① le plancher par IP, ci-dessous en `config.rateLimit` — hook `onRequest`, donc AVANT le
  //    décodage du corps. C'est le seul qui voit les requêtes qui n'atteignent jamais le
  //    handler (JSON invalide, `Content-Type` non supporté, corps vide). ⚠️ Il ne peut PAS
  //    compter par compte : à `onRequest`, `request.body` n'existe pas encore, donc le
  //    tempToken est illisible. ⚠️ Il ne peut pas non plus être supprimé : une route qui
  //    déclare `config.rateLimit` sort du quota global, elle n'aurait alors PLUS AUCUN filet.
  //  ② le compteur par compte, `verifyAccountLimit`, appelé À LA MAIN dans le handler, là où
  //    le corps est parsé et le tempToken lisible. C'est LUI qui borne les essais de code.
  //
  // POURQUOI le plancher passe de 5 à 30/min : après ①+②, il ne borne plus des essais de code
  // (c'est ② qui le fait, à 5/min/compte quel que soit le nombre d'adresses) mais du bruit qui
  // n'atteint pas le handler. Le garder à 5 punissait un NAT partagé sans rien protéger de
  // plus. 30/min reste 3× sous le quota global.
  //
  // ⚠️ PIÈGE VÉRIFIÉ — ne PAS remplacer ② par un second `server.rateLimit()` monté en hook :
  // `rateLimitRequestHandler` ouvre sur `if (req[rateLimitRan]) return` et ce symbole est
  // PARTAGÉ par tous les compteurs. Le premier hook qui tourne neutralise silencieusement
  // tous les suivants — on croirait compter par compte sans jamais le faire. Seul
  // `server.createRateLimit()` renvoie l'application directe, sans cette garde.
  const verifyAccountLimit = server.createRateLimit({
    max: 5,
    timeWindow: '1 minute',
    keyGenerator: twoFactorVerifyRateLimitKey,
  });
  server.post(
    '/verify',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
    // Hors du `try` : son `catch` transforme tout en 401, il avalerait le 429.
    //
    // ⚠️ On ne compte QUE les requêtes qui désignent un compte. Une requête sans tempToken
    // exploitable (absent, illisible, expiré, mauvais type) est laissée au plancher par IP :
    // la faire tomber dans le repli `ip:` de CE compteur la bornerait à 5/min sur un bucket
    // commun à toute la plateforme (pas de `trustProxy` → `req.ip` est l'IP du conteneur
    // front pour tous les navigateurs). Cinq tempTokens périmés dans la minute — cas
    // légitime, le tempToken vit 5 min — et le 6ᵉ utilisateur lirait « trop de tentatives »
    // au lieu de « session expirée, reconnecte-toi ». Détail dans le docblock de la clé.
    // ⚠️ La clé est recalculée par le `keyGenerator` du compteur : une vérification HMAC de
    // plus, négligeable, contre une garde lisible.
    if (twoFactorVerifyAccountKey(request) !== null) {
      const quota = await verifyAccountLimit(request);
      if (!quota.isAllowed && quota.isExceeded) {
        // Mêmes en-têtes que ceux du plugin, pour que ce 429 soit indiscernable des autres.
        // ⚠️ Sur une réponse NON-429, les `x-ratelimit-*` visibles restent ceux du PLANCHER
        // (posés en `onRequest`) : ils annoncent `limit: 30` alors qu'il ne reste peut-être
        // qu'un essai de compte. Sans effet aujourd'hui (le front ne lit que le statut), mais
        // un compte à rebours d'UI construit dessus serait faux.
        reply.header('x-ratelimit-limit', quota.max);
        reply.header('x-ratelimit-remaining', 0);
        reply.header('x-ratelimit-reset', quota.ttlInSeconds);
        reply.header('retry-after', quota.ttlInSeconds);
        return reply.code(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Rate limit exceeded, retry in ${quota.ttlInSeconds}s`,
        });
      }
    }
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
