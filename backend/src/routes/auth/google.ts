import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../../db/index.js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { signAccessToken, signRefreshToken } from '../../auth/tokens.js';
import { usersTable } from '../../db/schema.js';

const googleUserSchema = z.object({
  id: z.string(),
  email: z.string(),
});

export const googleRoutes: FastifyPluginAsync = async (server) => {
  server.get('/callback', async (request, reply) => {
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
          .where(eq(usersTable.email, data.email.toLowerCase()));
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
              email: data.email.toLowerCase(),
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
};
