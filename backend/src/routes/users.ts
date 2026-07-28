import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import {
  usersTable,
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  teamsTable,
} from '../db/schema.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ENGAGING_STATUSES } from '../utils/match-status.js';
import z from 'zod';
import { minioClient, BUCKET_NAME, buildPublicUrl, removeHostedObject } from '../storage/minio.js';
import { isBlocked } from '../utils/blocks.js';
import { randomUUID } from 'node:crypto';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { clearRefreshCookie } from '../auth/cookies.js';
import speakeasy from 'speakeasy';

const patchProfileSchema = z
  .object({
    displayName: z.string().min(1).max(50),
    bio: z.string().max(280),
  })
  .partial();

// newPassword suit EXACTEMENT la même règle que `register` (auth/index.ts) — on refuse
// d'affaiblir son mot de passe. currentPassword n'est pas revalidé sur la forme : il est
// juste comparé au hash (un ancien MDP peut dater d'avant une règle plus stricte).
const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z
    .string()
    .min(8, 'au moins 8 caractères')
    .max(72)
    .regex(/[A-Z]/, 'au moins une majuscule')
    .regex(/[a-z]/, 'au moins une minuscule')
    .regex(/\d/, 'au moins un chiffre')
    .regex(/[^A-Za-z0-9]/, 'au moins un caractère spécial'),
});

// Deux allowlists distinctes (ne PAS refusionner) : un avatar est forcément une image,
// une preuve de dispute peut aussi être un document (PDF). Chaque map traduit le MIME
// déclaré vers l'extension du fichier stocké.
export const IMAGE_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export const EVIDENCE_MIME = {
  ...IMAGE_MIME,
  'application/pdf': 'pdf',
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
  // BA1 — changer son mot de passe. Rate-limit par route (5/min) comme login/register :
  // c'est un point sensible où une vérification de MDP a lieu.
  server.patch(
    '/me/password',
    {
      onRequest: [server.authenticate],
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      try {
        const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);
        const userId = request.user.sub;
        const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
        if (!user) return reply.code(401).send({ error: 'Unauthorized' });

        // Compte OAuth-only (passwordHash null) : il n'a jamais eu de mot de passe local.
        // Décision MVP (carte BA1) : on refuse, on ne laisse pas EN DÉFINIR un ici — la garde
        // « currentPassword correct » n'aurait rien à comparer. Un flux « définir un 1er MDP »
        // serait un ticket à part.
        if (!user.passwordHash)
          return reply.code(400).send({ error: 'this account has no password (OAuth only)' });

        if (!(await verifyPassword(currentPassword, user.passwordHash)))
          return reply.code(401).send({ error: 'invalid credentials' });

        await db
          .update(usersTable)
          .set({ passwordHash: await hashPassword(newPassword) })
          .where(eq(usersTable.id, userId));
        return reply.code(200).send({ ok: true });
      } catch (err) {
        if (err instanceof z.ZodError) return reply.code(400).send({ errors: err.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
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
      // 20/min PAR COMPTE — le `keyGenerator` global (`rateLimitKey`) est hérité par les
      // quotas de route, et cette route est authentifiée : la clé est le `sub` du JWT, pas
      // l'IP. 3/min était intenable même pour un seul utilisateur qui recadre son avatar deux
      // ou trois fois. 20 borne toujours le trafic MinIO (20 × 2 Mo = 40 Mo/min par compte)
      // sans gêner personne. ⚠️ Ce plafond est désormais par COMPTE : une IP disposant de N
      // comptes obtient N × 40 Mo/min — contrepartie assumée du changement de clé (server.ts).
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!request.isMultipart())
        return reply.code(400).send({ error: 'expected multipart/form-data' });
      // Hissée hors du try (comme dans POST /teams/:id/logo) : si l'objet est uploadé mais
      // qu'un échec survient ensuite, le catch le retire → aucun orphelin.
      let uploadedUrl: string | undefined;
      try {
        const file = await request.file();
        if (!file) return reply.code(400).send({ error: 'no file uploaded' });
        if (!(file.mimetype in IMAGE_MIME))
          return reply.code(400).send({ error: 'unsupported file type' });

        // L'ancien avatar est lu AVANT l'UPDATE, qui va écraser la valeur : c'est la dernière
        // occasion de savoir quel objet devient orphelin. Projection explicite (invariant : pas
        // de `select()` nu sur `users`).
        const [before] = await db
          .select({ avatarUrl: usersTable.avatarUrl })
          .from(usersTable)
          .where(eq(usersTable.id, request.user.sub));

        // ⚠️ On lit le fichier EN MÉMOIRE (`toBuffer`) au lieu de streamer `file.file` vers
        // MinIO. Ce n'est PAS un détail de style : branché directement sur `putObject`, busboy
        // coupe le flux à la limite et range l'erreur dans un `lastError` que seul l'itérateur
        // de parts consulte → un fichier de 2 Mo + 100 octets était stocké AMPUTÉ à exactement
        // 2 097 152 octets, la route répondait **200**, et l'image corrompue devenait l'avatar
        // de l'utilisateur (mesuré). `toBuffer()` LÈVE `FST_REQ_FILE_TOO_LARGE` (→ 413 dans le
        // catch) et rien n'est écrit dans le bucket. Coût mémoire borné : 2 Mo (limite globale)
        // × 20 requêtes/min/compte (rate limit de la route).
        const buffer = await file.toBuffer();
        const id = randomUUID();
        const ext = IMAGE_MIME[file.mimetype as keyof typeof IMAGE_MIME];
        const filename = `${id}.${ext}`;
        // Taille connue → un seul PUT côté MinIO, au lieu d'un upload multipart à l'aveugle.
        await minioClient.putObject(BUCKET_NAME, filename, buffer, buffer.length, {
          'Content-Type': file.mimetype,
        });
        uploadedUrl = buildPublicUrl(filename);

        const [user] = await db
          .update(usersTable)
          .set({ avatarUrl: uploadedUrl })
          .where(eq(usersTable.id, request.user.sub))
          .returning();
        if (!user) {
          await removeHostedObject(request.log, uploadedUrl, 'avatar');
          uploadedUrl = undefined;
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        // L'avatar précédent n'est plus référencé : sans ça le bucket accumulait un fichier
        // mort à CHAQUE changement d'avatar — seul DELETE /me/avatar nettoyait quoi que ce soit.
        // APRÈS l'UPDATE : le supprimer avant aurait détruit l'avatar courant si l'UPDATE échouait.
        await removeHostedObject(request.log, before?.avatarUrl, 'avatar');

        const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
        return { user: userSafe };
      } catch (error) {
        await removeHostedObject(request.log, uploadedUrl, 'avatar');
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
  // Supprimer son avatar (module File upload : « Ability to delete uploaded files »).
  // Idempotente : sans avatar, on renvoie l'user tel quel (rien à faire). Le front retombe
  // sur l'avatar par défaut quand avatarUrl est NULL.
  server.delete('/me/avatar', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });

      if (user.avatarUrl) {
        await removeHostedObject(request.log, user.avatarUrl, 'avatar');
        const [updated] = await db
          .update(usersTable)
          .set({ avatarUrl: null })
          .where(eq(usersTable.id, userId))
          .returning();
        if (!updated) return reply.code(401).send({ error: 'Unauthorized' });
        const { passwordHash: _, totpSecret: _t, ...userSafe } = updated;
        return { user: userSafe };
      }

      const { passwordHash: _, totpSecret: _t, ...userSafe } = user;
      return { user: userSafe };
    } catch (error) {
      reply.code(500).send({ error: 'Internal error' });
    }
  });
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

      // ── BX-DEL — on ne part pas en laissant des affaires en cours ────────────────────
      // Règle produit (David, 28/07) : « si tu veux delete, il faut annuler tes matchs en
      // cours ». Deux refus, deux remèdes DIFFÉRENTS, donc deux `code` distincts — le front
      // mappe dessus et ne parse jamais la prose (même contrat que B-INV).
      //
      // ① ALIGNÉ dans un match non terminé. Un match `completed` ou `cancelled` ne bloque
      //    rien : c'est tout l'objet du ticket, la FK `restrict` refusait AUSSI les matchs
      //    vieux de six mois.
      // ⚠️ On part de `match_participants` filtré sur l'user (index
      //    `match_participants_user_idx`) et non des matchs engagés de toute la plateforme :
      //    le coût suit alors l'activité du COMPTE, pas le nombre de slots ouverts du ladder.
      const [aligned] = await db
        .select({ matchId: matchesTable.id })
        .from(matchParticipantsTable)
        .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
        .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
        .where(
          and(
            eq(matchParticipantsTable.userId, userId),
            inArray(matchesTable.status, ENGAGING_STATUSES),
          ),
        )
        .limit(1);
      if (aligned)
        return reply.code(409).send({
          error: 'finish or cancel your ongoing matches before deleting your account',
          code: 'engaged_in_match',
        });

      // ② CAPITAINE d'une équipe, engagée ou non. 🔑 `teams.captain_id` est en CASCADE :
      //    sans ce refus, le départ du capitaine EFFACE l'équipe, son roster, sa ligne
      //    `rankings` (Elo, W/L, place au classement du ladder) et l'identité de l'adversaire
      //    dans son propre historique (`opponent: null`) — le tout **sans notifier personne**,
      //    les coéquipiers découvrant la disparition par un 404. Sur `master`, la FK
      //    `restrict` freinait ce chemin par accident ; le passer en `cascade` sans cette
      //    garde l'aurait ouvert à tous les capitaines.
      // ⚠️ Ce refus SUBSUME le cas « capitaine engagé hors composition » : il n'y a plus
      //    besoin de croiser les matchs avec `teams.captain_id`. Le pendant obligatoire vit
      //    dans `DELETE /teams/:id`, qui refuse de dissoudre une équipe engagée — sinon on
      //    déplacerait simplement le trou d'un cran (dissoudre, puis partir).
      const [owned] = await db
        .select({ id: teamsTable.id })
        .from(teamsTable)
        .where(eq(teamsTable.captainId, userId))
        .limit(1);
      if (owned)
        return reply.code(409).send({
          error: 'dissolve your team before deleting your account',
          code: 'captain_of_team',
        });

      await db.delete(usersTable).where(eq(usersTable.id, userId));
      // APRÈS la suppression, jamais avant : si le DELETE échouait (interblocage, FK future),
      // l'avatar serait déjà détruit et le compte survivrait en pointant dans le vide.
      // L'inverse — le compte part, l'objet MinIO traîne une seconde — est sans conséquence.
      // Même ordre que la dissolution d'équipe, qui supprime son logo après le commit.
      await removeHostedObject(request.log, user.avatarUrl, 'avatar');
      clearRefreshCookie(reply);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.code(400).send({ errors: err.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
};
