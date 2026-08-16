import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { usersTable } from '../../db/schema.js';
import { db } from '../../db/index.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { signAccessToken, signRefreshToken, signTempToken } from '../../auth/tokens.js';
import { setRefreshCookie, clearRefreshCookie } from '../../auth/cookies.js';
import { eq } from 'drizzle-orm';
import { rlMax } from '../../utils/rate-limit.js';
import { toAuthUser } from '../../utils/user.js';

const registerSchema = z.object({
  pseudo: z.string().trim().min(3).max(30),
  email: z.email().toLowerCase(),
  password: z
    .string()
    .min(8, 'au moins 8 caractères')
    .max(72)
    .regex(/[A-Z]/, 'au moins une majuscule')
    .regex(/[a-z]/, 'au moins une minuscule')
    .regex(/\d/, 'au moins un chiffre')
    .regex(/[^A-Za-z0-9]/, 'au moins un caractère spécial'),
});

const loginSchema = z.object({
  email: z.string().toLowerCase(),
  password: z.string(),
});

export const authBasicRoutes: FastifyPluginAsync = async (server) => {
  server.post(
    '/register',
    { config: { rateLimit: { max: rlMax(3), timeWindow: '1 minute' } } },
    async (request, reply) => {
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
      setRefreshCookie(reply, refreshToken);
      return reply.code(201).send({ accessToken, user: toAuthUser(user) });
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
  },
  );

  server.post(
    '/login',
    { config: { rateLimit: { max: rlMax(5), timeWindow: '1 minute' } } },
    async (request, reply) => {
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
      setRefreshCookie(reply, refreshToken);
      return reply.code(200).send({ accessToken, user: toAuthUser(user) });
    } catch (err) {
      if (err instanceof z.ZodError) reply.code(400).send({ errors: err.issues });
      else reply.code(500).send({ error: 'Internal error' });
    }
  },
  );
  server.post('/refresh', async (request, reply) => {
    try {
      const refreshToken = request.cookies.refresh;
      // Pas de cookie, ce n'est pas un echec d'authentification. Le front appelle cette
      // route a l'ouverture de chaque page anonyme pour essayer de restaurer une session, et
      // un 401 faisait ecrire une ligne rouge par le navigateur lui-meme, qu'aucun catch ne
      // peut effacer. Il n'y a rien a restaurer et un cookie absent n'apprend rien a
      // personne, donc 204.
      // Ne pas etendre ce 204 aux autres cas : un cookie present mais invalide, expire ou
      // dont le compte a disparu sont de vrais echecs et restent en 401.
      if (!refreshToken) return reply.code(204).send();

      // ── Un cookie DÉFINITIVEMENT refusé est PURGÉ ────────────────────────────────────
      // Sinon la ligne rouge que ce ticket vient d'éteindre revient, et en pire : elle
      // devient PERMANENTE. Le front vide son état local mais n'appelle pas `/auth/logout`,
      // donc le cookie mort survit, et Chrome réécrit son 401 à CHAQUE chargement de page,
      // sans que l'utilisateur puisse rien y faire (il est déconnecté, il n'a plus de bouton
      // Logout). Ce n'est pas théorique : chaque rotation du `JWT_SECRET` ou changement de
      // format de token met TOUT LE MONDE dans cet état pour les 7 jours de TTL du cookie.
      // En le purgeant, le chargement suivant retombe sur le 204 silencieux : auto-guérison.
      const refused = () => {
        clearRefreshCookie(reply);
        return reply.code(401).send({ error: 'Invalid refresh token' });
      };

      // ⚠️ La vérification a son PROPRE try : une signature invalide ou expirée est un refus
      // définitif (on purge), une panne de base ne l'est PAS (on ne purge surtout pas, sinon
      // une coupure passagère déconnecte durablement tout le monde) — et le `catch` général
      // plus bas ne sait pas distinguer les deux.
      let payload: { sub: string; type?: 'access' | 'refresh' };
      try {
        payload = server.jwt.verify<{ sub: string; type?: 'access' | 'refresh' }>(refreshToken);
      } catch {
        return refused();
      }

      // Un access token (ou un refresh d'avant le claim `type`) n'échange pas de session.
      // Même message que les autres échecs : aucun oracle « mauvais type » vs « invalide ».
      if (payload.type !== 'refresh') return refused();
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
      if (!user) return refused();
      const accessToken = signAccessToken(request.server, { sub: user.id });
      return reply.code(200).send({ accessToken });
    } catch (err) {
      // Chemin des pannes (base injoignable…), PAS des refus : on ne touche pas au cookie.
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
  });
  server.post('/logout', async (request, reply) => {
    clearRefreshCookie(reply);
    return reply.code(200).send({ ok: true });
  });
};
