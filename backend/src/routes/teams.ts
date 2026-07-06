import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { teamsTable, teamMembersTable, laddersTable, usersTable } from '../db/schema.js';
import { eq, and, count } from 'drizzle-orm';
import z from 'zod';

const createTeamSchema = z.object({
  ladderId: z.uuid(),
  name: z.string().trim().min(1).max(50),
});
const addMemberSchema = z.object({ userId: z.uuid() });

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
          .values({ ladderId: data.ladderId, name: data.name, captainId: userId })
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
        if (constraint === 'teams_ladder_name_unique')
          return reply.code(409).send({ error: 'team name already taken on this ladder' });
        if (constraint === 'team_members_user_ladder_unique')
          return reply.code(409).send({ error: 'already in a team on this ladder' });
        return reply.code(409).send({ error: 'conflict' });
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
        .where(eq(teamMembersTable.userId, userId));
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
        const id = request.params.id;
        const [team] = await db
          .select()
          .from(teamsTable)
          .innerJoin(laddersTable, eq(laddersTable.id, teamsTable.ladderId))
          .where(eq(teamsTable.id, id));
        if (!team) return reply.code(404).send({ error: 'team not found' });
        const members = await db
          .select()
          .from(teamMembersTable)
          .innerJoin(usersTable, eq(usersTable.id, teamMembersTable.userId))
          .where(eq(teamMembersTable.teamId, id));
        const membersSafe = members.map((row) => ({
          id: row.users.id,
          pseudo: row.users.pseudo,
          displayName: row.users.displayName,
          avatarUrl: row.users.avatarUrl,
          isCaptain: row.users.id === team.teams.captainId,
        }));
        const teamSafe = {
          id: team.teams.id,
          name: team.teams.name,
          ladderId: team.teams.ladderId,
          ladderName: team.ladders.name,
          format: team.ladders.format,
          gameId: team.ladders.gameId,
          captainId: team.teams.captainId,
          logoUrl: team.teams.logoUrl,
        };
        return reply.code(200).send({ team: teamSafe, members: membersSafe });
      } catch (error) {
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
        const teamId = request.params.id;
        const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'no team found' });
        if (team.captainId !== captainId)
          return reply.code(403).send({ error: 'only the captain can add members' });
        const [user] = await db.select().from(usersTable).where(eq(usersTable.id, data.userId));
        if (!user) return reply.code(404).send({ error: 'user not found' });
        const [row] = await db
          .select({ total: count() })
          .from(teamMembersTable)
          .where(eq(teamMembersTable.teamId, teamId));
        if (!row) return reply.code(500).send({ error: 'Internal error' });
        if (row.total >= 10) return reply.code(409).send({ error: 'team is full' });
        await db.insert(teamMembersTable).values({
          teamId,
          userId: data.userId,
          ladderId: team.ladderId,
        });
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
        const teamId = request.params.id;
        const targetId = request.params.userId;
        const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'no team found' });
        if (me !== team.captainId && me !== targetId)
          return reply.code(403).send({ error: 'no authorization' });
        if (targetId === team.captainId)
          return reply.code(400).send({ error: 'captain cannot leave, dissolve the team instead' });
        await db
          .delete(teamMembersTable)
          .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetId)));
        return reply.code(200).send({ ok: true });
      } catch (error) {
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
        const teamId = request.params.id;
        const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'team not found' });
        if (team.captainId !== me)
          return reply.code(403).send({ error: 'only the captain can dissolve the team' });
        await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
        return reply.code(200).send({ ok: true });
      } catch (error) {
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
