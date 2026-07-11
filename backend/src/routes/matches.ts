import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import {
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  laddersTable,
  gamesTable,
  teamsTable,
  teamMembersTable,
  gameMapsTable,
  userExternalAccountsTable,
} from '../db/schema.js';
import { eq, and, ne, inArray, notInArray, sql } from 'drizzle-orm';
import z from 'zod';

// §5.2 — seuls les matchs ACTIFS verrouillent : un match terminé ou annulé libère aussitôt.
const LOCKING_STATUSES: ('in_progress' | 'awaiting_confirmation' | 'disputed')[] = [
  'in_progress',
  'awaiting_confirmation',
  'disputed',
];

const createMatchSchema = z.object({
  ladderId: z.uuid(),
  scheduledAt: z.coerce.date().refine((date) => date.getTime() > Date.now(), {
    message: 'scheduledAt must be in the future',
  }),
  // lineup : requise pour les ladders d'équipe (2v2+), ignorée en 1v1 (solo = le créateur)
  lineup: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'lineup must not contain duplicate players',
    })
    .optional(),
});

const listQuerySchema = z.object({ ladderId: z.uuid() });
const idParamSchema = z.object({ id: z.uuid() });

export const matchesRoutes: FastifyPluginAsync = async (server) => {
  // POST /matches — ouvrir un slot (team pour 2v2+, solo pour 1v1).
  server.post('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const data = createMatchSchema.parse(request.body);
      const me = request.user.sub;

      const [ladder] = await db
        .select()
        .from(laddersTable)
        .where(eq(laddersTable.id, data.ladderId));
      if (!ladder) return reply.code(404).send({ error: 'ladder not found' });
      const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, ladder.gameId));
      if (!game) return reply.code(404).send({ error: 'game not found' });

      // le side 0 : team (2v2+) ou null (1v1) ; participants : lineup ou [moi]
      let sideTeamId: string | null;
      let participantIds: string[];

      if (ladder.format === '1v1') {
        // ---- SOLO ----
        sideTeamId = null;
        participantIds = [me];

        // §5.1 — j'ai un compte lié pour le provider du jeu
        const [linked] = await db
          .select({ userId: userExternalAccountsTable.userId })
          .from(userExternalAccountsTable)
          .where(
            and(
              eq(userExternalAccountsTable.userId, me),
              eq(userExternalAccountsTable.provider, game.requiredProvider),
            ),
          );
        if (!linked)
          return reply
            .code(400)
            .send({ error: `you must have a linked ${game.requiredProvider} account` });

        // §5.2 — pas de 2e slot ouvert (moi, ce ladder, pending)
        const [openSolo] = await db
          .select({ matchId: matchSidesTable.matchId })
          .from(matchParticipantsTable)
          .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
          .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
          .where(
            and(
              eq(matchParticipantsTable.userId, me),
              eq(matchesTable.ladderId, data.ladderId),
              eq(matchesTable.status, 'pending'),
            ),
          );
        if (openSolo) return reply.code(409).send({ error: 'you already have an open slot' });

        // §5.2 lockout — un match récent (moi, ce ladder) me verrouille
        const [lockedSolo] = await db
          .select({ startedAt: matchesTable.startedAt })
          .from(matchParticipantsTable)
          .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
          .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
          .where(
            and(
              eq(matchParticipantsTable.userId, me),
              eq(matchesTable.ladderId, data.ladderId),
              inArray(matchesTable.status, LOCKING_STATUSES),
              sql`${matchesTable.startedAt} + make_interval(mins => ${ladder.lockoutMinutes}) > now()`,
            ),
          );
        if (lockedSolo)
          return reply
            .code(409)
            .send({ error: `locked out for ${ladder.lockoutMinutes} min after your last match` });
      } else {
        // ---- TEAM (2v2+) ----
        const lineup = data.lineup;
        if (!lineup) return reply.code(400).send({ error: 'lineup is required for team matches' });

        // ma team sur ce ladder + garde capitaine
        const [membership] = await db
          .select()
          .from(teamMembersTable)
          .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
          .where(
            and(eq(teamMembersTable.userId, me), eq(teamMembersTable.ladderId, data.ladderId)),
          );
        if (!membership) return reply.code(400).send({ error: 'you have no team on this ladder' });
        const team = membership.teams;
        if (team.captainId !== me)
          return reply.code(403).send({ error: 'only the captain can create a match' });

        // lineup = format_size joueurs
        const formatSize = parseInt(ladder.format, 10);
        if (lineup.length !== formatSize)
          return reply
            .code(400)
            .send({ error: `lineup must contain exactly ${formatSize} players` });

        // lineup ⊆ roster
        const members = await db
          .select({ userId: teamMembersTable.userId })
          .from(teamMembersTable)
          .where(eq(teamMembersTable.teamId, team.id));
        const memberIds = new Set(members.map((m) => m.userId));
        if (!lineup.every((id) => memberIds.has(id)))
          return reply.code(400).send({ error: 'every selected player must be on the team' });

        // §5.1 — chaque joueur a un compte lié pour le provider du jeu
        const linked = await db
          .select({ userId: userExternalAccountsTable.userId })
          .from(userExternalAccountsTable)
          .where(
            and(
              inArray(userExternalAccountsTable.userId, lineup),
              eq(userExternalAccountsTable.provider, game.requiredProvider),
            ),
          );
        const linkedIds = new Set(linked.map((l) => l.userId));
        if (!lineup.every((id) => linkedIds.has(id)))
          return reply.code(400).send({
            error: `every selected player must have a linked ${game.requiredProvider} account`,
          });

        // §5.2 — pas de 2e slot ouvert (pending)
        const [openSlot] = await db
          .select({ matchId: matchSidesTable.matchId })
          .from(matchSidesTable)
          .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
          .where(and(eq(matchSidesTable.teamId, team.id), eq(matchesTable.status, 'pending')));
        if (openSlot) return reply.code(409).send({ error: 'team already has an open slot' });

        // §5.2 lockout — un match récent verrouille la team
        const [locked] = await db
          .select({ startedAt: matchesTable.startedAt })
          .from(matchSidesTable)
          .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
          .where(
            and(
              eq(matchSidesTable.teamId, team.id),
              inArray(matchesTable.status, LOCKING_STATUSES),
              sql`${matchesTable.startedAt} + make_interval(mins => ${ladder.lockoutMinutes}) > now()`,
            ),
          );
        if (locked)
          return reply
            .code(409)
            .send({ error: `team is locked out for ${ladder.lockoutMinutes} min after its last match` });

        sideTeamId = team.id;
        participantIds = lineup;
      }

      // tirage de 3 maps distinctes si le jeu a un pool, sinon []
      const drawn = await db
        .select({ name: gameMapsTable.name })
        .from(gameMapsTable)
        .where(eq(gameMapsTable.gameId, ladder.gameId))
        .orderBy(sql`random()`)
        .limit(3);
      const maps = drawn.map((m) => m.name);

      // match (pending) + side 0 + participants (transaction)
      const match = await db.transaction(async (tx) => {
        const [createdMatch] = await tx
          .insert(matchesTable)
          .values({ ladderId: data.ladderId, scheduledAt: data.scheduledAt, maps })
          .returning();
        if (!createdMatch) throw new Error('match insert returned no row');
        const [createdSide] = await tx
          .insert(matchSidesTable)
          .values({ matchId: createdMatch.id, sideIndex: 0, teamId: sideTeamId })
          .returning();
        if (!createdSide) throw new Error('match side insert returned no row');
        await tx
          .insert(matchParticipantsTable)
          .values(participantIds.map((userId) => ({ matchSideId: createdSide.id, userId })));
        return createdMatch;
      });

      return reply.code(201).send({ match });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // GET /matches?ladderId= — slots ouverts d'un ladder (créateur + maps masqués, mes slots exclus).
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const { ladderId } = listQuerySchema.parse(request.query);
      const me = request.user.sub;

      const [ladder] = await db.select().from(laddersTable).where(eq(laddersTable.id, ladderId));
      if (!ladder) return reply.code(404).send({ error: 'ladder not found' });

      const conditions = [
        eq(matchesTable.ladderId, ladderId),
        eq(matchesTable.status, 'pending'),
      ];

      if (ladder.format === '1v1') {
        // solo : exclure les matchs où je suis participant
        const mine = await db
          .select({ matchId: matchSidesTable.matchId })
          .from(matchParticipantsTable)
          .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
          .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
          .where(and(eq(matchParticipantsTable.userId, me), eq(matchesTable.ladderId, ladderId)));
        const mineIds = mine.map((m) => m.matchId);
        if (mineIds.length) conditions.push(notInArray(matchesTable.id, mineIds));
      } else {
        // team : exclure les slots de ma team
        const [membership] = await db
          .select({ teamId: teamMembersTable.teamId })
          .from(teamMembersTable)
          .where(and(eq(teamMembersTable.userId, me), eq(teamMembersTable.ladderId, ladderId)));
        if (membership) conditions.push(ne(matchSidesTable.teamId, membership.teamId));
      }

      const rows = await db
        .select({ id: matchesTable.id, scheduledAt: matchesTable.scheduledAt })
        .from(matchesTable)
        .innerJoin(matchSidesTable, eq(matchSidesTable.matchId, matchesTable.id))
        .where(and(...conditions));

      const slots = rows.map((r) => ({
        id: r.id,
        format: ladder.format,
        gameId: ladder.gameId,
        scheduledAt: r.scheduledAt,
      }));
      return reply.code(200).send({ slots });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // GET /matches/:id — détail brut, réservé aux participants (membre d'une team engagée OU joueur solo).
  server.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const me = request.user.sub;
        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, id));
        if (!match) return reply.code(404).send({ error: 'match not found' });

        const sides = await db
          .select()
          .from(matchSidesTable)
          .where(eq(matchSidesTable.matchId, id));
        const sideIds = sides.map((s) => s.id);
        const participants = sideIds.length
          ? await db
              .select()
              .from(matchParticipantsTable)
              .where(inArray(matchParticipantsTable.matchSideId, sideIds))
          : [];

        // garde : participant direct (solo) OU membre d'une team engagée (team)
        let allowed = participants.some((p) => p.userId === me);
        if (!allowed) {
          const sideTeamIds = sides
            .map((s) => s.teamId)
            .filter((t): t is string => t !== null);
          if (sideTeamIds.length) {
            const [teamMember] = await db
              .select({ id: teamMembersTable.id })
              .from(teamMembersTable)
              .where(
                and(eq(teamMembersTable.userId, me), inArray(teamMembersTable.teamId, sideTeamIds)),
              );
            allowed = !!teamMember;
          }
        }
        if (!allowed) return reply.code(403).send({ error: 'not a participant of this match' });

        const shapedSides = sides
          .sort((a, b) => a.sideIndex - b.sideIndex)
          .map((s) => ({
            sideIndex: s.sideIndex,
            teamId: s.teamId,
            participants: participants
              .filter((p) => p.matchSideId === s.id)
              .map((p) => p.userId),
          }));

        return reply.code(200).send({
          match: {
            id: match.id,
            ladderId: match.ladderId,
            status: match.status,
            scheduledAt: match.scheduledAt,
            maps: match.maps,
            createdAt: match.createdAt,
          },
          sides: shapedSides,
        });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
