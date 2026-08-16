import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import {
  usersTable,
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  teamsTable,
  teamMembersTable,
  laddersTable,
  rankingsTable,
  friendshipsTable,
} from '../db/schema.js';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ENGAGING_STATUSES } from '../utils/match-status.js';
import { rlMax } from '../utils/rate-limit.js';
import z from 'zod';
import { minioClient, BUCKET_NAME, buildPublicUrl, removeHostedObject } from '../storage/minio.js';
import { isBlocked } from '../utils/blocks.js';
import { toAuthUser } from '../utils/user.js';
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

async function profileFriendship(viewerId: string, profileId: string) {
  // Personne n'est ami avec soi-même
  if (viewerId === profileId) return null;

  const [row] = await db
    .select({
      id: friendshipsTable.id,
      requesterId: friendshipsTable.requesterId,
      addresseeId: friendshipsTable.addresseeId,
      status: friendshipsTable.status,
      createdAt: friendshipsTable.createdAt,
      updatedAt: friendshipsTable.updatedAt,
    })
    .from(friendshipsTable)
    .where(
      // we do OR, because la même amitié est stockée en (moi, lui) ou en (lui, moi)
      or(
        and(
          eq(friendshipsTable.requesterId, viewerId),
          eq(friendshipsTable.addresseeId, profileId),
        ),
        and(
          eq(friendshipsTable.requesterId, profileId),
          eq(friendshipsTable.addresseeId, viewerId),
        ),
      ),
    );

  return row ?? null;
}

async function profileRankings(profileId: string) {
  // Les ladders où CE joueur est classé. Alias explicite : sans lui, les deux niveaux
  // s'appellent `rankings` et il faut savoir de tête que Postgres résout au plus proche.
  const myLadders = alias(rankingsTable, 'my_ladders');

  const ranked = db
    .select({
      ladderId: rankingsTable.ladderId,
      userId: rankingsTable.userId,
      elo: rankingsTable.elo,
      wins: rankingsTable.wins,
      losses: rankingsTable.losses,
      lastMatchAt: rankingsTable.lastMatchAt,
      // `::int` : `row_number()` et `count()` rendent un `bigint`, remonté en **string** alors que le contrat le déclare `integer`
      // this is the messed up way to calculate the rank
      rank: sql<number>`(row_number() over (
        partition by ${rankingsTable.ladderId}
        order by ${rankingsTable.elo} desc, ${rankingsTable.wins} desc,
                 ${rankingsTable.losses} asc, ${rankingsTable.id} asc
      ))::int`.as('rank'),
      ladderSize: sql<number>`(count(*) over (partition by ${rankingsTable.ladderId}))::int`.as(
        'ladder_size',
      ),
    })
    .from(rankingsTable)
    .where(
      inArray(
        rankingsTable.ladderId,
        db
          .select({ ladderId: myLadders.ladderId })
          .from(myLadders)
          .where(eq(myLadders.userId, profileId)),
      ),
    )
    .as('ranked');

  return (
    db
      .select({
        ladderId: ranked.ladderId,
        ladderName: laddersTable.name,
        gameId: laddersTable.gameId,
        elo: ranked.elo,
        wins: ranked.wins,
        losses: ranked.losses,
        rank: ranked.rank,
        ladderSize: ranked.ladderSize,
      })
      .from(ranked)
      .innerJoin(laddersTable, eq(laddersTable.id, ranked.ladderId))
      .where(eq(ranked.userId, profileId))
      // ordered by most recent
      .orderBy(desc(ranked.lastMatchAt), asc(laddersTable.name))
  );
}

// Les equipes du profil qu'on consulte, pour pouvoir aller du joueur vers l'equipe.
// Attention : ici isCaptain parle du profil consulte, alors que le meme nom de champ dans la
// liste de mes equipes parle de moi. Meme forme, meme nom, deux referents differents, d'ou
// deux schemas separes dans le contrat. Sinon la couronne se poserait sur la mauvaise tete
// sans qu'aucun type ne s'en apercoive.
async function profileTeams(profileId: string) {
  const rows = await db
    .select({
      id: teamsTable.id,
      name: teamsTable.name,
      logoUrl: teamsTable.logoUrl,
      captainId: teamsTable.captainId,
      gameId: laddersTable.gameId,
      ladder: laddersTable.name,
      elo: rankingsTable.elo,
    })
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
    .innerJoin(laddersTable, eq(laddersTable.id, teamsTable.ladderId))
    .leftJoin(rankingsTable, eq(teamsTable.id, rankingsTable.teamId))
    .where(eq(teamMembersTable.userId, profileId))
    // Tri explicite, même raison que `GET /teams` : sans lui Postgres est libre de renvoyer
    // les lignes dans n'importe quel ordre et la liste se réordonnerait entre deux chargements.
    .orderBy(asc(teamsTable.name));

  return rows.map(({ captainId, ...team }) => ({ ...team, isCaptain: captainId === profileId }));
}

export const userRoutes: FastifyPluginAsync = async (server) => {
  server.get('/me', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      return { user: toAuthUser(user) };
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
      return { user: toAuthUser(user) };
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
      config: { rateLimit: { max: rlMax(5), timeWindow: '1 minute' } },
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
        // On liste les colonnes qu'on veut, jamais celles qu'on retire. La version d'avant
        // prenait la ligne entiere et enlevait cinq colonnes a la main, ce qui laissait passer
        // isAdmin sans que le contrat le declare. Une liste de ce qu'on enleve oublie
        // forcement toute colonne ajoutee apres elle.
        // isAdmin est maintenant servi volontairement, il n'a jamais ete un secret et
        // l'autorisation le relit en base a chaque appel. Les deux autres, le mot de passe et
        // le secret TOTP, sont de vrais secrets : ne jamais elargir cette liste par analogie.
        const [user] = await db
          .select({
            id: usersTable.id,
            pseudo: usersTable.pseudo,
            displayName: usersTable.displayName,
            bio: usersTable.bio,
            avatarUrl: usersTable.avatarUrl,
            oauthProvider: usersTable.oauthProvider,
            oauthId: usersTable.oauthId,
            isAdmin: usersTable.isAdmin,
            createdAt: usersTable.createdAt,
          })
          .from(usersTable)
          .where(sql`lower(${usersTable.pseudo}) = lower(${pseudo})`);
        if (!user) return reply.code(404).send({ error: 'Profile not found' });
        if (await isBlocked(request.user.sub, user.id)) {
          return reply.code(404).send({ error: 'Profile not found' });
        }
        // Trois lectures indépendantes : rien ne dépend du résultat d'une autre, donc en
        // parallèle. Séquentielles, elles feraient payer trois allers-retours à une page qui
        // n'en attendait qu'un.
        const [friendship, rankings, teams] = await Promise.all([
          profileFriendship(request.user.sub, user.id),
          profileRankings(user.id),
          profileTeams(user.id),
        ]);
        return { user, friendship, rankings, teams };
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
      config: { rateLimit: { max: rlMax(20), timeWindow: '1 minute' } },
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

        // On charge le fichier en memoire au lieu de le streamer vers MinIO. Branche
        // directement, le flux est coupe a la limite sans que personne ne le signale : un
        // fichier trop gros etait stocke ampute, la route repondait 200, et l'image corrompue
        // devenait l'avatar. toBuffer leve une erreur qu'on transforme en 413, et rien ne part
        // dans le bucket.
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

        return { user: toAuthUser(user) };
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
        return { user: toAuthUser(updated) };
      }

      return { user: toAuthUser(user) };
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

      // On ne peut pas supprimer son compte en laissant des affaires en cours. Il y a deux
      // refus possibles avec deux remedes differents, d'ou deux codes : le front s'appuie
      // dessus et ne lit jamais le texte.
      // Le premier : etre aligne dans un match non termine. Un match deja joue ou annule ne
      // bloque rien, c'etait justement le probleme d'avant ou un match vieux de six mois
      // empechait encore de partir.
      // On part des participations de ce joueur et pas des matchs de toute la plateforme, le
      // cout suit donc l'activite du compte.
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

      // Le second : etre capitaine d'une equipe, engagee ou non. La colonne du capitaine est
      // en cascade, donc sans ce refus le depart du capitaine effacerait l'equipe, son roster,
      // son Elo et son classement, sans prevenir personne : les coequipiers decouvriraient la
      // disparition par un 404.
      // Ce refus couvre aussi le capitaine engage hors composition. Son pendant est dans la
      // dissolution d'equipe, qui refuse si un match est en cours, sinon il suffirait de
      // dissoudre puis de partir.
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
