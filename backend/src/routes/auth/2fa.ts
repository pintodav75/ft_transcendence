import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../../db/index.js';
import { usersTable } from '../../db/schema.js';
import { signAccessToken, signRefreshToken } from '../../auth/tokens.js';
import { setRefreshCookie } from '../../auth/cookies.js';
import { eq } from 'drizzle-orm';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import {
  twoFactorVerifyAccountKey,
  twoFactorVerifyRateLimitKey,
  rlMax,
} from '../../utils/rate-limit.js';
import { toAuthUser } from '../../utils/user.js';

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
  // Les essais de code 2FA se comptent par compte, pas par adresse. Il faut deux compteurs.
  // Le premier, par IP, tourne avant que le corps de la requete soit lu : c'est le seul qui
  // voit les requetes qui n'arrivent jamais jusqu'au handler, et il ne peut pas compter par
  // compte puisque le tempToken n'est pas encore lisible. On ne peut pas le retirer non plus,
  // une route qui declare son quota sort du quota global et se retrouverait sans filet.
  // Le second, par compte, est appele a la main dans le handler une fois le corps parse.
  // C'est lui qui borne vraiment les essais.
  // Le plancher par IP est monte de 5 a 30 par minute : il ne compte plus des essais de code
  // mais du bruit, et le laisser a 5 punissait tout un reseau partage pour rien.
  // Piege verifie : ne pas remplacer le second par un hook classique. Le plugin marque la
  // requete des qu'un compteur a tourne, et tous les suivants sont ignores en silence. Seul
  // createRateLimit applique le comptage directement.
  const verifyAccountLimit = server.createRateLimit({
    max: rlMax(5),
    timeWindow: '1 minute',
    keyGenerator: twoFactorVerifyRateLimitKey,
  });
  server.post(
    '/verify',
    { config: { rateLimit: { max: rlMax(30), timeWindow: '1 minute' } } },
    async (request, reply) => {
    // En dehors du try, dont le catch transforme tout en 401 et avalerait le 429.
    // On ne compte que les requetes qui designent vraiment un compte. Sans tempToken lisible,
    // on laisse faire le plancher par IP : sinon toutes ces requetes tomberaient dans le meme
    // seau, et cinq tempTokens expires dans la minute suffiraient a repondre "trop de
    // tentatives" au sixieme utilisateur au lieu de "session expiree".
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
      return reply.code(200).send({ accessToken, user: toAuthUser(user) });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      else return reply.code(401).send({ error: 'Invalid or expired tempToken' });
    }
  },
  );
};
