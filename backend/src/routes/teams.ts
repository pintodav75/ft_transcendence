import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import {
  teamsTable,
  teamMembersTable,
  laddersTable,
  usersTable,
  gamesTable,
  userExternalAccountsTable,
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  disputesTable,
} from '../db/schema.js';
import { eq, and, asc, count, inArray, sql } from 'drizzle-orm';
import { notify, pushNotifications } from '../utils/notifications.js';
import { minioClient, BUCKET_NAME, buildPublicUrl, removeHostedObject } from '../storage/minio.js';
import { IMAGE_MIME } from './users.js';
import { randomUUID } from 'node:crypto';
import z from 'zod';

// `logoUrl` est optionnel à la création : même règle HTTPS qu'à l'édition (voir le
// commentaire d'`updateTeamSchema` plus bas). Non fourni → la colonne reste `null`.
// Pas de `.nullable()` ici : on ne « retire » pas un logo sur une team qui n'existe pas.
const createTeamSchema = z.object({
  ladderId: z.uuid(),
  name: z.string().trim().min(1).max(50),
  logoUrl: z.url({ protocol: /^https$/ }).max(2048).optional(),
});
const addMemberSchema = z.object({ userId: z.uuid() });
const idParamSchema = z.object({ id: z.uuid() });
const memberParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });

// Édition d'une team : les deux champs sont optionnels (`.partial()`), mais la route
// refuse un corps vide. `name` suit la même règle qu'à la création.
// `logoUrl` accepte `null` pour RETIRER le logo. C'est une URL, pas un upload :
// l'envoi d'un fichier de logo vers MinIO (comme l'avatar) serait un ticket à part.
//
// ⚠️ `z.url()` seul valide une URI SYNTAXIQUE, pas une URL Web : il accepte
// `javascript:alert(1)` et `ftp://…`. On restreint donc explicitement le protocole à
// HTTPS uniquement (I4) : le logo est affiché dans la page applicative HTTPS, une URL en
// `http://` produirait un avertissement de CONTENU MIXTE et serait bloquée par le navigateur.
// Il n'y a pas d'exécution côté backend, mais la valeur est PERSISTÉE : on refuse à l'entrée
// plutôt que de compter sur chaque futur consommateur (`<a href>`, CSS…).
// `logoUrl` accepte `null` pour RETIRER le logo. (Le protocole est normalisé en minuscules
// par WHATWG URL → `HTTPS://` passe.)
const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    logoUrl: z.url({ protocol: /^https$/ }).max(2048).nullable(),
  })
  .partial();

/**
 * Si l'erreur est une violation d'unicité Postgres (SQLSTATE 23505), rend le nom de la
 * contrainte violée ; sinon `undefined`. Évite de redupliquer le déballage de
 * `error.cause` (Drizzle emballe l'erreur du driver) à chaque route.
 */
function uniqueViolationConstraint(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === '23505'
  ) {
    return 'constraint_name' in error.cause ? String(error.cause.constraint_name) : 'unknown';
  }
  return undefined;
}

export const teamsRoutes: FastifyPluginAsync = async (server) => {
  server.post('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const data = createTeamSchema.parse(request.body);
      const userId = request.user.sub;
      const [ladder] = await db
        .select()
        .from(laddersTable)
        .where(eq(laddersTable.id, data.ladderId));
      if (!ladder) return reply.code(404).send({ error: 'ladder not found' });
      if (ladder.format === '1v1')
        return reply.code(400).send({ error: 'cannot create a team on a 1v1 ladder' });
      const team = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(teamsTable)
          .values({
            ladderId: data.ladderId,
            name: data.name,
            captainId: userId,
            logoUrl: data.logoUrl ?? null,
          })
          .returning();
        if (!created) throw new Error('team insert returned no row');
        await tx.insert(teamMembersTable).values({
          teamId: created.id,
          userId,
          ladderId: created.ladderId,
        });
        return created;
      });
      return reply.code(201).send({ team });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      if (
        typeof error === 'object' &&
        error !== null &&
        'cause' in error &&
        typeof error.cause === 'object' &&
        error.cause !== null &&
        'code' in error.cause &&
        error.cause.code === '23505'
      ) {
        const constraint =
          'constraint_name' in error.cause ? error.cause.constraint_name : undefined;
        // Code structuré en plus du message : le front route l'erreur vers le bon
        // champ sans parser de prose (un changement de wording ne doit rien casser).
        if (constraint === 'teams_ladder_name_unique')
          return reply
            .code(409)
            .send({ error: 'team name already taken on this ladder', code: 'name_taken' });
        if (constraint === 'team_members_user_ladder_unique')
          return reply
            .code(409)
            .send({ error: 'already in a team on this ladder', code: 'already_in_team' });
        return reply.code(409).send({ error: 'conflict', code: 'conflict' });
      }
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const rows = await db
        .select()
        .from(teamMembersTable)
        .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
        .innerJoin(laddersTable, eq(laddersTable.id, teamsTable.ladderId))
        .where(eq(teamMembersTable.userId, userId))
        // Without an explicit sort Postgres is free to return the rows in any
        // order, so the team grid could reshuffle between two loads.
        .orderBy(asc(teamsTable.name));
      const teams = rows.map((row) => ({
        id: row.teams.id,
        name: row.teams.name,
        ladderId: row.ladders.id,
        ladder: row.ladders.name,
        format: row.ladders.format,
        gameId: row.ladders.gameId,
        isCaptain: row.teams.captainId === userId,
        logoUrl: row.teams.logoUrl,
      }));
      return reply.code(200).send({ teams });
    } catch (error) {
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        // team → ladder → game : c'est le JEU qui porte le provider requis (riot, steam…).
        const [team] = await db
          .select()
          .from(teamsTable)
          .innerJoin(laddersTable, eq(laddersTable.id, teamsTable.ladderId))
          .innerJoin(gamesTable, eq(gamesTable.id, laddersTable.gameId))
          .where(eq(teamsTable.id, id));
        if (!team) return reply.code(404).send({ error: 'team not found' });

        const requiredProvider = team.games.requiredProvider;

        const members = await db
          .select()
          .from(teamMembersTable)
          .innerJoin(usersTable, eq(usersTable.id, teamMembersTable.userId))
          .where(eq(teamMembersTable.teamId, id));

        // §5.1 — qui, parmi ces membres, a lié le compte exigé par CE jeu ?
        // Une seule requête pour tout le roster (pas un appel par membre).
        const memberIds = members.map((row) => row.users.id);
        const linked = memberIds.length
          ? await db
              .select({ userId: userExternalAccountsTable.userId })
              .from(userExternalAccountsTable)
              .where(
                and(
                  inArray(userExternalAccountsTable.userId, memberIds),
                  eq(userExternalAccountsTable.provider, requiredProvider),
                ),
              )
          : [];
        const linkedIds = new Set(linked.map((l) => l.userId));

        const membersSafe = members.map((row) => ({
          id: row.users.id,
          pseudo: row.users.pseudo,
          displayName: row.users.displayName,
          avatarUrl: row.users.avatarUrl,
          isCaptain: row.users.id === team.teams.captainId,
          // true = sélectionnable dans une lineup ; false = le front le grise
          hasLinkedAccount: linkedIds.has(row.users.id),
        }));
        const teamSafe = {
          id: team.teams.id,
          name: team.teams.name,
          ladderId: team.teams.ladderId,
          ladderName: team.ladders.name,
          format: team.ladders.format,
          gameId: team.ladders.gameId,
          requiredProvider, // le front sait quel logo/message afficher ("compte Riot non lié")
          captainId: team.teams.captainId,
          logoUrl: team.teams.logoUrl,
        };
        return reply.code(200).send({ team: teamSafe, members: membersSafe });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  // GET /teams/:id/matches — historique de match d'une équipe (B15). 100 % lecture, aucune
  // transaction, aucun verrou. Nombre de requêtes CONSTANT quel que soit le nombre de matchs
  // (une par table + des Map d'index, jamais d'await dans une boucle de map).
  //
  // ⚠️ Confidentialité : un non-membre ne voit QUE les matchs à 2 sides (un adversaire a
  // accepté). Filtrer sur le nombre de sides plutôt que sur `status !== 'pending'` est plus
  // robuste : un slot ouvert périmé passe `cancelled` via le job 24 h et fuiterait sinon le
  // créneau d'une équipe à un visiteur — ce que `GET /matches?ladderId=` anonymise déjà. Un
  // membre voit tout, y compris ses slots en attente, et seul un membre reçoit les lineups.
  server.get<{ Params: { id: string } }>(
    '/:id/matches',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        // Zod APRÈS `authenticate` (invariant repo) : anonyme → 401, malformé → 400.
        const { id: teamId } = idParamSchema.parse(request.params);

        // Team + appartenance en UNE requête (LEFT JOIN) : `memberId` non-null ⇔ membre.
        const [row] = await db
          .select({ teamId: teamsTable.id, memberId: teamMembersTable.id })
          .from(teamsTable)
          .leftJoin(
            teamMembersTable,
            and(eq(teamMembersTable.teamId, teamsTable.id), eq(teamMembersTable.userId, me)),
          )
          .where(eq(teamsTable.id, teamId));
        if (!row) return reply.code(404).send({ error: 'team not found' });
        const isMember = row.memberId !== null;

        // Tous les matchs où CETTE équipe a un side (exploite l'index `(team_id, match_id)`).
        const mySides = await db
          .select({ matchId: matchSidesTable.matchId })
          .from(matchSidesTable)
          .where(eq(matchSidesTable.teamId, teamId));
        const matchIds = [...new Set(mySides.map((s) => s.matchId))];
        if (matchIds.length === 0) return reply.code(200).send({ isMember, matches: [] });

        // Projection explicite : `winnerSideId` ne sert qu'à dériver `result` plus bas, il
        // n'est jamais renvoyé brut (les scores par camp suffisent au front). `ladderId` et
        // `maps` sont volontairement absents : les maps sont servies par `GET /matches/:id`
        // au clic sur une ligne d'historique (décision produit), pas sur la ligne de liste.
        const matches = await db
          .select({
            id: matchesTable.id,
            status: matchesTable.status,
            scheduledAt: matchesTable.scheduledAt,
            completedAt: matchesTable.completedAt,
            winnerSideId: matchesTable.winnerSideId,
          })
          .from(matchesTable)
          .where(inArray(matchesTable.id, matchIds))
          // `scheduledAt` est LA référence temporelle (invariant repo) et est NULLABLE en
          // base : Postgres remonte les NULL en tête d'un DESC sans `NULLS LAST` explicite.
          .orderBy(sql`${matchesTable.scheduledAt} desc nulls last`);

        // Tous les sides des matchs sélectionnés (les nôtres ET ceux de l'adversaire) en UNE
        // requête — pas une par match.
        const allSides = await db
          .select()
          .from(matchSidesTable)
          .where(inArray(matchSidesTable.matchId, matchIds));
        const sidesByMatch = new Map<string, (typeof allSides)[number][]>();
        for (const s of allSides) {
          const list = sidesByMatch.get(s.matchId) ?? [];
          list.push(s);
          sidesByMatch.set(s.matchId, list);
        }

        const visibleMatches = isMember
          ? matches
          : matches.filter((m) => (sidesByMatch.get(m.id)?.length ?? 0) === 2);

        const opponentTeamIds = new Set<string>();
        for (const m of visibleMatches) {
          for (const s of sidesByMatch.get(m.id) ?? []) {
            if (s.teamId && s.teamId !== teamId) opponentTeamIds.add(s.teamId);
          }
        }
        const teams = opponentTeamIds.size
          ? await db
              .select({ id: teamsTable.id, name: teamsTable.name, logoUrl: teamsTable.logoUrl })
              .from(teamsTable)
              .where(inArray(teamsTable.id, [...opponentTeamIds]))
          : [];
        const teamById = new Map(teams.map((t) => [t.id, t]));

        // Lineup : réservé aux membres. Deux requêtes de plus au total, jamais une par side.
        const participantsBySide = new Map<string, string[]>();
        const playerById = new Map<
          string,
          {
            id: string;
            pseudo: string | null;
            displayName: string | null;
            avatarUrl: string | null;
          }
        >();
        if (isMember) {
          const visibleSideIds = visibleMatches.flatMap((m) =>
            (sidesByMatch.get(m.id) ?? []).map((s) => s.id),
          );
          const participants = visibleSideIds.length
            ? await db
                .select()
                .from(matchParticipantsTable)
                .where(inArray(matchParticipantsTable.matchSideId, visibleSideIds))
            : [];
          for (const p of participants) {
            const list = participantsBySide.get(p.matchSideId) ?? [];
            list.push(p.userId);
            participantsBySide.set(p.matchSideId, list);
          }
          const userIds = [...new Set(participants.map((p) => p.userId))];
          // Projection explicite : jamais de select() nu sur users (fuite email/passwordHash).
          const players = userIds.length
            ? await db
                .select({
                  id: usersTable.id,
                  pseudo: usersTable.pseudo,
                  displayName: usersTable.displayName,
                  avatarUrl: usersTable.avatarUrl,
                })
                .from(usersTable)
                .where(inArray(usersTable.id, userIds))
            : [];
          for (const p of players) playerById.set(p.id, p);
        }

        // Litige : id + statut exposés SANS condition de statut de match — copier le
        // `if (status === 'disputed')` de GET /matches/:id ferait disparaître le badge
        // « litige » dès qu'un admin arbitre (le match repasse completed/cancelled, la
        // dispute reste `resolved`). `GET /disputes/:id` garde sa propre garde d'accès :
        // exposer l'id ici ne fuite rien.
        const visibleMatchIds = visibleMatches.map((m) => m.id);
        const disputes = await db
          .select({
            id: disputesTable.id,
            matchId: disputesTable.matchId,
            status: disputesTable.status,
          })
          .from(disputesTable)
          .where(inArray(disputesTable.matchId, visibleMatchIds));
        const disputeByMatch = new Map(disputes.map((d) => [d.matchId, d]));

        const shaped = visibleMatches.map((m) => {
          const sides = sidesByMatch.get(m.id) ?? [];
          const mySide = sides.find((s) => s.teamId === teamId);
          const oppSide = mySide ? sides.find((s) => s.id !== mySide.id) : undefined;
          const dispute = disputeByMatch.get(m.id);

          let result: 'win' | 'loss' | null = null;
          if (mySide && m.winnerSideId) result = m.winnerSideId === mySide.id ? 'win' : 'loss';

          const lineupOf = (side: typeof mySide) =>
            side
              ? (participantsBySide.get(side.id) ?? [])
                  .map((uid) => playerById.get(uid))
                  .filter((p): p is NonNullable<typeof p> => p !== undefined)
              : [];

          return {
            id: m.id,
            status: m.status,
            scheduledAt: m.scheduledAt,
            completedAt: m.completedAt,
            // null tant qu'aucun adversaire n'a accepté — n'arrive jamais pour un
            // non-membre, `visibleMatches` ne garde que les matchs à 2 sides pour lui.
            opponent: oppSide?.teamId ? (teamById.get(oppSide.teamId) ?? null) : null,
            // Colonnes `match_sides.score` des deux camps : `null` avant clôture ET après
            // un arbitrage admin (il tranche un vainqueur, pas un score) — le front doit
            // gérer `null` sur un match pourtant `completed`.
            score: { self: mySide?.score ?? null, opponent: oppSide?.score ?? null },
            // Uniquement celui de l'équipe consultée : l'autre camp n'a aucun usage ici.
            eloDelta: mySide?.eloDelta ?? null,
            result,
            disputeId: dispute?.id ?? null,
            disputeStatus: dispute?.status ?? null,
            // Composition nominative : uniquement si `isMember`, absente sinon (un
            // non-membre ne doit voir AUCUNE lineup, même sur un match visible).
            ...(isMember
              ? { lineup: { self: lineupOf(mySide), opponent: lineupOf(oppSide) } }
              : {}),
          };
        });

        return reply.code(200).send({ isMember, matches: shaped });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  // PATCH /teams/:id — ÉDITER l'organisation (nom et/ou logo), capitaine only.
  // Complète le module « Organization system » du sujet : « Create, EDIT, and delete
  // organizations » — la création et la dissolution existaient, l'édition manquait.
  server.patch<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        const { id: teamId } = idParamSchema.parse(request.params);
        const data = updateTeamSchema.parse(request.body);
        // `.partial()` accepte {} : sans ce garde on ferait un UPDATE qui ne change rien.
        if (Object.keys(data).length === 0)
          return reply.code(400).send({ error: 'no fields to update' });

        const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'team not found' });
        if (team.captainId !== me)
          return reply.code(403).send({ error: 'only the captain can edit the team' });

        const [updated] = await db
          .update(teamsTable)
          .set(data)
          .where(eq(teamsTable.id, teamId))
          .returning();
        if (!updated) return reply.code(404).send({ error: 'team not found' });

        // Le logo hébergé qui vient d'être DÉRÉFÉRENCÉ (remplacé par une URL externe, ou
        // retiré via `logoUrl: null`) n'a plus aucun porteur : sans ça il resterait dans le
        // bucket pour toujours. Même raisonnement que dans POST /:id/logo, et même ordre —
        // APRÈS l'UPDATE, sinon un UPDATE en échec laisserait l'équipe pointer sur un objet
        // qu'on aurait déjà détruit. Le test `updated.logoUrl !== team.logoUrl` couvre le cas
        // où `data` ne touche QUE le nom : rien n'est déréférencé, rien n'est supprimé.
        if (updated.logoUrl !== team.logoUrl)
          await removeHostedObject(request.log, team.logoUrl, 'team logo');

        return reply.code(200).send({ team: updated });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        // Renommer vers un nom déjà pris sur ce ladder viole unique(ladder_id, name) :
        // même traitement qu'à la création -> 409, pas 500.
        const constraint = uniqueViolationConstraint(error);
        if (constraint) {
          if (constraint === 'teams_ladder_name_unique')
            return reply.code(409).send({ error: 'team name already taken on this ladder' });
          return reply.code(409).send({ error: 'conflict' });
        }
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  // POST /teams/:id/logo — UPLOADER le logo de l'équipe (capitaine only). Calqué sur
  // `POST /users/me/avatar`. Complète `PATCH /teams/:id`, qui n'accepte qu'une URL https DÉJÀ
  // hébergée ailleurs : inutilisable en pratique pour un capitaine qui a juste un fichier.
  //
  // Le logo va dans le bucket PUBLIC `avatars` existant : un logo d'équipe est exactement aussi
  // public qu'un avatar (il s'affiche dans les listes de teams, les ladders, les matchs). Un
  // bucket dédié coûterait une variable d'env + du compose + de l'init MinIO pour zéro gain.
  //
  // ⚠️ `buildPublicUrl()` rend un chemin RELATIF `/media/avatars/<uuid>.<ext>`, qui ne satisfait
  // PAS la règle Zod `^https://` de `PATCH /teams/:id` — et c'est VOULU : cette valeur est
  // FABRIQUÉE par la route, jamais reçue d'un client. La règle https ne protège que les URL
  // SAISIES (contenu mixte, `javascript:`…) ; il n'y a rien à valider dans notre propre chemin.
  server.post<{ Params: { id: string } }>(
    '/:id/logo',
    {
      onRequest: [server.authenticate],
      // Même quota que l'avatar : 20 uploads/min PAR COMPTE (le `keyGenerator` global est
      // hérité, et la route est authentifiée → la clé est le `sub` du JWT, pas l'IP). Borne
      // le trafic MinIO sans jamais gêner un capitaine qui hésite entre trois logos.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      // Hissée hors du try (comme `key` dans POST /disputes/:id/evidence) : si l'objet est
      // uploadé mais qu'un échec survient ensuite, le catch le retire → aucun orphelin.
      let uploadedUrl: string | undefined;
      try {
        const me = request.user.sub;
        // Zod APRÈS `authenticate` : un anonyme sort en 401, jamais en 400 (invariant repo).
        const { id: teamId } = idParamSchema.parse(request.params);

        // Exactement la garde de PATCH /teams/:id : membre non-capitaine ET non-membre → 403.
        // Elle passe AVANT la lecture du corps : inutile d'avaler 2 Mo pour finir en 403.
        const [team] = await db
          .select({ captainId: teamsTable.captainId, logoUrl: teamsTable.logoUrl })
          .from(teamsTable)
          .where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'team not found' });
        if (team.captainId !== me)
          return reply.code(403).send({ error: 'only the captain can edit the team' });

        if (!request.isMultipart())
          return reply.code(400).send({ error: 'expected multipart/form-data' });
        const file = await request.file();
        if (!file) return reply.code(400).send({ error: 'no file uploaded' });
        // IMAGE_MIME, surtout PAS EVIDENCE_MIME : un logo est une image, seule une preuve de
        // dispute peut être un PDF. Les deux allowlists restent séparées (invariant repo).
        if (!(file.mimetype in IMAGE_MIME))
          return reply.code(400).send({ error: 'unsupported file type' });

        // ⚠️ On lit le fichier EN MÉMOIRE (`toBuffer`) au lieu de streamer `file.file` vers
        // MinIO, comme le fait déjà POST /disputes/:id/evidence. Ce n'est pas un détail de
        // style : brancher `file.file` directement sur `putObject` fait TRONQUER SANS BRUIT le
        // fichier à la limite (busboy coupe le flux, `@fastify/multipart` range l'erreur dans
        // un `lastError` que seul l'itérateur de parts consulte) → un fichier de 3 Mo était
        // stocké tel quel, amputé à exactement 2 097 152 octets, et la route répondait 200
        // avec une image corrompue. `toBuffer()` LÈVE `FST_REQ_FILE_TOO_LARGE` (→ 413 dans le
        // catch), et rien n'est écrit dans le bucket. Coût mémoire borné : 2 Mo (limite
        // globale) × 20 requêtes/min/IP (rate limit de la route).
        const buffer = await file.toBuffer();
        const ext = IMAGE_MIME[file.mimetype as keyof typeof IMAGE_MIME];
        const key = `${randomUUID()}.${ext}`;
        // Taille connue → un seul PUT côté MinIO, au lieu d'un upload multipart à l'aveugle.
        await minioClient.putObject(BUCKET_NAME, key, buffer, buffer.length, {
          'Content-Type': file.mimetype,
        });
        uploadedUrl = buildPublicUrl(key);

        const [updated] = await db
          .update(teamsTable)
          .set({ logoUrl: uploadedUrl })
          .where(eq(teamsTable.id, teamId))
          .returning({
            id: teamsTable.id,
            ladderId: teamsTable.ladderId,
            name: teamsTable.name,
            captainId: teamsTable.captainId,
            logoUrl: teamsTable.logoUrl,
            createdAt: teamsTable.createdAt,
            updatedAt: teamsTable.updatedAt,
          });
        // Équipe dissoute entre la garde et l'UPDATE : on retire l'objet fraîchement uploadé
        // au lieu de le laisser orphelin, et on sort en 404 (rien n'a planté, la cible a disparu).
        if (!updated) {
          await removeHostedObject(request.log, uploadedUrl, 'team logo');
          uploadedUrl = undefined;
          return reply.code(404).send({ error: 'team not found' });
        }

        // L'ancien logo, s'il était hébergé CHEZ NOUS, n'est plus référencé : on le supprime,
        // sinon le bucket accumule un fichier mort à chaque changement de logo. Une URL externe
        // héritée de l'ancien modèle n'a rien à supprimer (removeHostedObject → no-op).
        // APRÈS l'UPDATE : le supprimer avant aurait détruit le logo courant si l'UPDATE échouait.
        await removeHostedObject(request.log, team.logoUrl, 'team logo');

        return reply.code(200).send({ team: updated });
      } catch (error) {
        await removeHostedObject(request.log, uploadedUrl, 'team logo');
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        // La limite de 2 Mo est GLOBALE (server.ts) : le dépassement jette pendant la lecture
        // du flux par putObject. Sans ce mapping il remonterait en 500.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'FST_REQ_FILE_TOO_LARGE'
        )
          return reply.code(413).send({ error: 'File too large' });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.post<{ Params: { id: string } }>(
    '/:id/members',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const data = addMemberSchema.parse(request.body);
        const captainId = request.user.sub;
        const { id: teamId } = idParamSchema.parse(request.params);
        const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'no team found' });
        if (team.captainId !== captainId)
          return reply.code(403).send({ error: 'only the captain can add members' });
        // Les deux users en UNE requête : la cible (pour le 404) et le capitaine (dont le
        // pseudo part dans la notif). Deux SELECT séparés feraient un aller-retour de plus
        // sur une route qui n'en a pas besoin.
        const people = await db
          .select({ id: usersTable.id, pseudo: usersTable.pseudo })
          .from(usersTable)
          .where(inArray(usersTable.id, [captainId, data.userId]));
        const target = people.find((p) => p.id === data.userId);
        const actor = people.find((p) => p.id === captainId);
        if (!target) return reply.code(404).send({ error: 'user not found' });
        if (!actor) return reply.code(500).send({ error: 'Internal error' });
        const [row] = await db
          .select({ total: count() })
          .from(teamMembersTable)
          .where(eq(teamMembersTable.teamId, teamId));
        if (!row) return reply.code(500).send({ error: 'Internal error' });
        if (row.total >= 10) return reply.code(409).send({ error: 'team is full' });
        // B9 — notif DANS la transaction métier (atomique avec l'adhésion), push APRÈS le
        // commit. Destinataire : le joueur ajouté, jamais le capitaine qui agit.
        const notifs = await db.transaction(async (tx) => {
          await tx.insert(teamMembersTable).values({
            teamId,
            userId: data.userId,
            ladderId: team.ladderId,
          });
          return notify(tx, [data.userId], 'team_member_added', {
            teamId,
            teamName: team.name,
            ladderId: team.ladderId,
            byUserId: actor.id,
            byPseudo: actor.pseudo,
          });
        });
        pushNotifications(notifs);
        return reply.code(201).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        if (
          typeof error === 'object' &&
          error !== null &&
          'cause' in error &&
          typeof error.cause === 'object' &&
          error.cause !== null &&
          'code' in error.cause &&
          error.cause.code === '23505'
        ) {
          const constraint =
            'constraint_name' in error.cause ? error.cause.constraint_name : undefined;
          if (constraint === 'team_members_team_user_unique')
            return reply.code(409).send({ error: 'already a member' });
          if (constraint === 'team_members_user_ladder_unique')
            return reply.code(409).send({ error: 'already in a team on this ladder' });
          return reply.code(409).send({ error: 'conflict' });
        }
        // L'équipe a été dissoute entre la lecture et l'insertion : la clé étrangère
        // vers `teams` échoue (SQLSTATE 23503). C'est le cas que le `FOR UPDATE` de la
        // dissolution rend désormais atteignable — il doit sortir en 404 « équipe
        // introuvable », pas en 500 : rien n'a planté, la cible a simplement disparu.
        if (
          typeof error === 'object' &&
          error !== null &&
          'cause' in error &&
          typeof error.cause === 'object' &&
          error.cause !== null &&
          'code' in error.cause &&
          error.cause.code === '23503'
        )
          return reply.code(404).send({ error: 'no team found' });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.delete<{ Params: { id: string; userId: string } }>(
    '/:id/members/:userId',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        const { id: teamId, userId: targetId } = memberParamsSchema.parse(request.params);
        const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'no team found' });
        if (me !== team.captainId && me !== targetId)
          return reply.code(403).send({ error: 'no authorization' });
        if (targetId === team.captainId)
          return reply.code(400).send({ error: 'captain cannot leave, dissolve the team instead' });

        // Cette route sert À LA FOIS le kick (capitaine) et le départ volontaire.
        // On ne notifie QUE le kick : si le joueur part de lui-même il est l'acteur, et
        // la règle B9 est « jamais l'acteur ».
        const isKick = me !== targetId;
        const actor = isKick
          ? (
              await db
                .select({ id: usersTable.id, pseudo: usersTable.pseudo })
                .from(usersTable)
                .where(eq(usersTable.id, me))
            )[0]
          : undefined;

        const notifs = await db.transaction(async (tx) => {
          // ⚠️ `.returning()` : la route est IDEMPOTENTE (retirer un non-membre rend 200).
          // Sans ce garde, on notifierait « tu as été exclu » à quelqu'un qui n'a jamais
          // été dans l'équipe. On ne notifie que si une ligne a réellement disparu.
          const deleted = await tx
            .delete(teamMembersTable)
            .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetId)))
            .returning({ id: teamMembersTable.id });
          if (deleted.length === 0 || !isKick || !actor) return [];
          return notify(tx, [targetId], 'team_member_removed', {
            teamId,
            teamName: team.name,
            ladderId: team.ladderId,
            byUserId: actor.id,
            byPseudo: actor.pseudo,
          });
        });
        pushNotifications(notifs);
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        const { id: teamId } = idParamSchema.parse(request.params);

        const [actor] = await db
          .select({ id: usersTable.id, pseudo: usersTable.pseudo })
          .from(usersTable)
          .where(eq(usersTable.id, me));
        if (!actor) return reply.code(500).send({ error: 'Internal error' });

        // ⚠️ TOUT se joue DANS la transaction, sous verrou de ligne — piège #14.
        // Lire la team AVANT la transaction laissait passer deux dissolutions
        // simultanées : les deux lisaient le même roster, une seule supprimait
        // réellement, mais les deux notifiaient. Chaque membre recevait DEUX
        // `team_disbanded` (reproduit 5 fois sur 5 avec deux DELETE concurrents).
        const outcome = await db.transaction(async (tx) => {
          // `FOR UPDATE` sérialise les dissolutions concurrentes : la seconde attend,
          // puis ne retrouve plus la ligne et sort en 404 sans rien notifier. Il fait
          // aussi patienter un ajout de membre concurrent, dont la vérification de clé
          // étrangère prend un verrou sur cette même ligne.
          const [team] = await tx
            .select()
            .from(teamsTable)
            .where(eq(teamsTable.id, teamId))
            .for('update');
          if (!team) return { ok: false as const, status: 404, error: 'team not found' };
          if (team.captainId !== me)
            return {
              ok: false as const,
              status: 403,
              error: 'only the captain can dissolve the team',
            };

          // 🔑 Roster lu APRÈS le verrou et AVANT le DELETE : la suppression CASCADE
          // sur `team_members`, et plus aucun ajout ne peut s'intercaler entre les deux.
          const members = await tx
            .select({ userId: teamMembersTable.userId })
            .from(teamMembersTable)
            .where(eq(teamMembersTable.teamId, teamId));

          const deleted = await tx
            .delete(teamsTable)
            .where(eq(teamsTable.id, teamId))
            .returning({ id: teamsTable.id });
          // Sous verrou ce cas ne peut plus se produire ; le garde reste pour que la
          // règle « on ne notifie jamais une dissolution qui n'a pas eu lieu » soit
          // portée par le code et pas seulement par le raisonnement.
          if (deleted.length === 0) return { ok: true as const, notifs: [], logoUrl: null };

          // Tout le roster SAUF le capitaine : c'est lui qui dissout, il le sait déjà.
          const recipients = members.map((m) => m.userId).filter((id) => id !== me);
          const notifs = await notify(tx, recipients, 'team_disbanded', {
            teamId,
            teamName: team.name,
            ladderId: team.ladderId,
            byUserId: actor.id,
            byPseudo: actor.pseudo,
          });
          // `logoUrl` est LU SOUS VERROU et remonté hors de la transaction : l'équipe n'existe
          // plus après le commit, c'est la dernière occasion de savoir quel objet elle portait.
          return { ok: true as const, notifs, logoUrl: team.logoUrl };
        });

        if (!outcome.ok) return reply.code(outcome.status).send({ error: outcome.error });
        pushNotifications(outcome.notifs);
        // APRÈS le commit, jamais dedans : un rollback tardif ressusciterait une équipe dont on
        // aurait déjà détruit le logo. L'inverse — l'équipe disparaît, l'objet reste une seconde
        // de plus — est sans conséquence. Une URL externe n'a rien à supprimer (no-op).
        await removeHostedObject(request.log, outcome.logoUrl, 'team logo');
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
