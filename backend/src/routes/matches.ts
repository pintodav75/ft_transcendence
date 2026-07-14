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
  usersTable,
} from '../db/schema.js';
import { eq, and, ne, inArray, notInArray, sql, desc } from 'drizzle-orm';
import z from 'zod';

// §5.2 — seuls les matchs ACTIFS verrouillent : un match terminé ou annulé libère aussitôt.
const LOCKING_STATUSES: ('in_progress' | 'awaiting_confirmation' | 'disputed')[] = [
  'in_progress',
  'awaiting_confirmation',
  'disputed',
];

type Ladder = typeof laddersTable.$inferSelect;
type Game = typeof gamesTable.$inferSelect;

// `db` ou le `tx` d'une transaction : les deux exposent la même API de requête.
// Indispensable ici — le check du lockout DOIT pouvoir tourner à l'intérieur d'une
// transaction (sinon il lit un instantané pris avant le verrou → cf. isLockedOut).
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * §5.2 — un match ACTIF récent verrouille-t-il ce camp sur ce ladder ?
 *
 * Interroge par TEAM (2v2+) ou par JOUEUR (1v1). Extrait ici parce qu'il tourne
 * DEUX fois : une fois hors transaction (chemin rapide, message d'erreur propre),
 * et une fois DANS la transaction de l'accept, après le verrou — c'est celui-là
 * qui fait autorité.
 */
async function isLockedOut(
  executor: Executor,
  ladder: Ladder,
  teamId: string | null,
  userId: string,
): Promise<boolean> {
  const notExpired = sql`${matchesTable.startedAt} + make_interval(mins => ${ladder.lockoutMinutes}) > now()`;

  if (teamId) {
    const [locked] = await executor
      .select({ id: matchesTable.id })
      .from(matchSidesTable)
      .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
      .where(
        and(
          eq(matchSidesTable.teamId, teamId),
          inArray(matchesTable.status, LOCKING_STATUSES),
          notExpired,
        ),
      );
    return !!locked;
  }

  const [locked] = await executor
    .select({ id: matchesTable.id })
    .from(matchParticipantsTable)
    .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
    .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
    .where(
      and(
        eq(matchParticipantsTable.userId, userId),
        eq(matchesTable.ladderId, ladder.id),
        inArray(matchesTable.status, LOCKING_STATUSES),
        notExpired,
      ),
    );
  return !!locked;
}

/**
 * §5.2 — ce camp a-t-il déjà un slot OUVERT (`pending`) sur ce ladder ?
 *
 * Propre à la CRÉATION : ce n'est pas le côté qu'on valide, c'est l'action d'ouvrir.
 * Comme isLockedOut, il prend un `executor` : la vérification qui fait autorité tourne
 * DANS la transaction, sous verrou (sinon deux POST simultanés créent 2 slots).
 */
async function hasOpenSlot(
  executor: Executor,
  ladder: Ladder,
  teamId: string | null,
  userId: string,
): Promise<boolean> {
  if (teamId) {
    // Une team n'appartient qu'à un seul ladder → pas besoin de filtrer dessus.
    const [open] = await executor
      .select({ id: matchesTable.id })
      .from(matchSidesTable)
      .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
      .where(and(eq(matchSidesTable.teamId, teamId), eq(matchesTable.status, 'pending')));
    return !!open;
  }

  const [open] = await executor
    .select({ id: matchesTable.id })
    .from(matchParticipantsTable)
    .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
    .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
    .where(
      and(
        eq(matchParticipantsTable.userId, userId),
        eq(matchesTable.ladderId, ladder.id),
        eq(matchesTable.status, 'pending'),
      ),
    );
  return !!open;
}

/** Identité d'un camp sur un ladder : la team en 2v2+, le couple joueur+ladder en 1v1. */
function competitorKey(ladder: Ladder, teamId: string | null, userId: string): string {
  return teamId ? `team:${teamId}` : `user:${userId}:${ladder.id}`;
}

/**
 * Sérialise les engagements des camps concernés, dans un ORDRE DÉTERMINISTE.
 *
 * Deux problèmes, une seule solution.
 *
 * 1) Sans verrou du tout : deux accepts simultanés du même camp sur DEUX matchs
 *    différents passent tous les deux (chacun lit le lockout avant que l'autre
 *    n'ait commité, et l'update conditionnel ne les sérialise pas — lignes
 *    distinctes) → deux matchs actifs → §5.2 contourné.
 *
 * 2) Sans ORDRE : alice accepte le slot de bob pendant que bob accepte celui
 *    d'alice. Chaque transaction ne verrouillait que SON accepteur → clés
 *    différentes, aucune sérialisation. Puis chacune verrouille la ligne du match
 *    qu'elle démarre et réclame celle de l'autre (l'annulation croisée des slots
 *    ouverts) → T1 tient B et veut A, T2 tient A et veut B → **INTERBLOCAGE**.
 *    Postgres en tue une : 500 sur un conflit métier parfaitement normal.
 *
 * Le tri règle (2) : les deux transactions demandent les MÊMES verrous dans le
 * MÊME ordre, donc l'une attend l'autre au lieu de se mordre la queue. C'est le
 * remède canonique au deadlock — l'acquisition ordonnée des ressources.
 *
 * Les verrous sont *transactionnels* : Postgres les relâche seul au COMMIT/ROLLBACK.
 * Une collision de hachage ne ferait que sérialiser deux camps sans lien — inoffensif.
 */
async function lockCompetitors(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  keys: string[],
): Promise<void> {
  // Set = dédoublonne (un camp ne se verrouille pas deux fois) ; sort = l'ordre commun.
  for (const key of [...new Set(keys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

// Verdict du helper : soit le côté est valide et on sait à quoi il ressemble,
// soit il est refusé et on sait quoi répondre. Le helper n'a pas accès à `reply` :
// il rend un verdict, c'est la route qui le traduit en réponse HTTP.
type SideValidation =
  | { ok: true; sideTeamId: string | null; participantIds: string[] }
  // unlinkedPlayers : optionnel, rempli seulement quand l'échec vient du §5.1 en team.
  // Le front sait alors QUI surligner, au lieu de deviner parmi les 5 sélectionnés.
  | { ok: false; code: number; error: string; unlinkedPlayers?: string[] };

/**
 * Valide qu'un joueur peut engager un côté sur ce ladder, et décrit ce côté.
 *
 * Appelé DEUX fois : à la création du slot (side 0) et à l'acceptation (side 1).
 * C'est tout l'intérêt : les deux camps d'un match sont validés à l'identique.
 *
 * ⚠️ Le check « j'ai déjà un slot ouvert » n'est PAS ici : il ne valide pas le côté,
 * il valide l'action d'ouvrir un slot → il reste dans POST /.
 */
async function validateSide(
  ladder: Ladder,
  game: Game,
  me: string,
  lineup: string[] | undefined,
): Promise<SideValidation> {
  // ---- SOLO (1v1) : le joueur EST le côté, pas de team, pas de lineup ----
  if (ladder.format === '1v1') {
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
      return {
        ok: false,
        code: 400,
        error: `you must have a linked ${game.requiredProvider} account`,
      };

    // §5.2 lockout — un match ACTIF récent (moi, ce ladder) me verrouille.
    // ⚠️ Chemin RAPIDE seulement : la vérification qui fait autorité est refaite
    // dans la transaction de l'accept, après le verrou (course du double accept).
    if (await isLockedOut(db, ladder, null, me))
      return {
        ok: false,
        code: 409,
        error: `locked out for ${ladder.lockoutMinutes} min after your last match`,
      };

    return { ok: true, sideTeamId: null, participantIds: [me] };
  }

  // ---- TEAM (2v2+) : le capitaine engage sa team avec une lineup ----
  if (!lineup) return { ok: false, code: 400, error: 'lineup is required for team matches' };

  // ma team sur ce ladder + garde capitaine
  const [membership] = await db
    .select()
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
    .where(and(eq(teamMembersTable.userId, me), eq(teamMembersTable.ladderId, ladder.id)));
  if (!membership) return { ok: false, code: 400, error: 'you have no team on this ladder' };

  const team = membership.teams;
  if (team.captainId !== me)
    return { ok: false, code: 403, error: 'only the captain can engage the team' };

  // lineup = exactement format_size joueurs
  const formatSize = parseInt(ladder.format, 10);
  if (lineup.length !== formatSize)
    return { ok: false, code: 400, error: `lineup must contain exactly ${formatSize} players` };

  // lineup ⊆ roster
  const members = await db
    .select({ userId: teamMembersTable.userId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, team.id));
  const memberIds = new Set(members.map((m) => m.userId));
  if (!lineup.every((id) => memberIds.has(id)))
    return { ok: false, code: 400, error: 'every selected player must be on the team' };

  // §5.1 — chaque joueur de la lineup a un compte lié
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
  const unlinkedPlayers = lineup.filter((id) => !linkedIds.has(id));
  if (unlinkedPlayers.length)
    return {
      ok: false,
      code: 400,
      error: `every selected player must have a linked ${game.requiredProvider} account`,
      unlinkedPlayers,
    };

  // §5.2 lockout — un match ACTIF récent verrouille la team.
  // ⚠️ Chemin RAPIDE seulement (cf. la note du cas solo ci-dessus).
  if (await isLockedOut(db, ladder, team.id, me))
    return {
      ok: false,
      code: 409,
      error: `team is locked out for ${ladder.lockoutMinutes} min after its last match`,
    };

  return { ok: true, sideTeamId: team.id, participantIds: lineup };
}

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

const acceptMatchSchema = createMatchSchema.pick({ lineup: true });

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

      // Validation du côté créateur : §5.1 compte lié, lineup, capitaine, §5.2 lockout.
      // Le MÊME helper servira à l'accept → les deux camps validés à l'identique.
      const side = await validateSide(ladder, game, me, data.lineup);
      if (!side.ok) {
        // on transmet unlinkedPlayers seulement s'il est là (échec §5.1 en team)
        const body: { error: string; unlinkedPlayers?: string[] } = { error: side.error };
        if (side.unlinkedPlayers) body.unlinkedPlayers = side.unlinkedPlayers;
        return reply.code(side.code).send(body);
      }
      const { sideTeamId, participantIds } = side;

      // Spécifique à la CRÉATION : pas de 2e slot déjà ouvert sur ce ladder.
      // (Ce check ne valide pas le côté, il valide l'action d'ouvrir → il reste ici.)
      // ⚠️ Chemin RAPIDE seulement : la vérification qui fait autorité est refaite dans la
      // transaction, sous verrou (sinon 2 POST simultanés créent 2 slots — TOCTOU).
      if (await hasOpenSlot(db, ladder, sideTeamId, me))
        return reply
          .code(409)
          .send({ error: sideTeamId ? 'team already has an open slot' : 'you already have an open slot' });

      // tirage de 3 maps distinctes si le jeu a un pool, sinon []
      const drawn = await db
        .select({ name: gameMapsTable.name })
        .from(gameMapsTable)
        .where(eq(gameMapsTable.gameId, ladder.gameId))
        .orderBy(sql`random()`)
        .limit(3);
      const maps = drawn.map((m) => m.name);

      const created = await db.transaction(async (tx) => {
        // VERROU sur le créateur : deux POST simultanés du même camp se sérialisent ici.
        // Sans lui, les deux passent le check ci-dessus (aucun n'a encore commité) et
        // créent chacun un slot → 2 slots ouverts, invariant « un seul » violé.
        // Un seul camp est en jeu ici (on ouvre, on n'affronte encore personne).
        await lockCompetitors(tx, [competitorKey(ladder, sideTeamId, me)]);

        // Relectures SOUS le verrou — ce sont celles-ci qui font autorité.
        if (await hasOpenSlot(tx, ladder, sideTeamId, me)) return { raced: 'open_slot' } as const;
        // Un accept concurrent a pu m'engager dans un match entre-temps → §5.2.
        if (await isLockedOut(tx, ladder, sideTeamId, me)) return { raced: 'locked' } as const;

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
        return { raced: null, match: createdMatch } as const;
      });

      if (created.raced === 'open_slot')
        return reply
          .code(409)
          .send({ error: sideTeamId ? 'team already has an open slot' : 'you already have an open slot' });
      if (created.raced === 'locked')
        return reply.code(409).send({
          error: sideTeamId
            ? `team is locked out for ${ladder.lockoutMinutes} min after its last match`
            : `locked out for ${ladder.lockoutMinutes} min after your last match`,
        });

      return reply.code(201).send({ match: created.match });
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

      const conditions = [eq(matchesTable.ladderId, ladderId), eq(matchesTable.status, 'pending')];

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

        // Tous les ids dont on aura besoin, collectés UNE fois : ils servent à la garde
        // ci-dessous ET aux deux requêtes d'enrichissement plus bas.
        const sideTeamIds = sides.map((s) => s.teamId).filter((t): t is string => t !== null);
        const userIds = participants.map((p) => p.userId);

        // garde : participant direct (solo) OU membre d'une team engagée (team)
        let allowed = participants.some((p) => p.userId === me);
        if (!allowed && sideTeamIds.length) {
          const [teamMember] = await db
            .select({ id: teamMembersTable.id })
            .from(teamMembersTable)
            .where(
              and(eq(teamMembersTable.userId, me), inArray(teamMembersTable.teamId, sideTeamIds)),
            );
          allowed = !!teamMember;
        }
        if (!allowed) return reply.code(403).send({ error: 'not a participant of this match' });

        // DEUX requêtes pour tout le monde, pas une par joueur (N+1) : on a déjà les ids.
        const teams = sideTeamIds.length
          ? await db
              .select({
                id: teamsTable.id,
                name: teamsTable.name,
                logoUrl: teamsTable.logoUrl,
                captainId: teamsTable.captainId,
              })
              .from(teamsTable)
              .where(inArray(teamsTable.id, sideTeamIds))
          : [];
        // Projection explicite : surtout PAS de select() nu, on enverrait email/passwordHash.
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

        // Index clé → valeur. `.get(id)` répond en temps constant → aucune requête
        // dans la boucle d'assemblage ci-dessous.
        const teamById = new Map(teams.map((t) => [t.id, t]));
        const playerById = new Map(players.map((p) => [p.id, p]));

        const shapedSides = sides
          .sort((a, b) => a.sideIndex - b.sideIndex)
          .map((s) => ({
            sideIndex: s.sideIndex,
            // solo : pas de team → null. Le front distingue les deux cas là-dessus.
            team: s.teamId ? (teamById.get(s.teamId) ?? null) : null,
            players: participants
              .filter((p) => p.matchSideId === s.id)
              .map((p) => playerById.get(p.userId))
              .filter((p): p is NonNullable<typeof p> => p !== undefined),
          }));

        return reply.code(200).send({
          match: {
            id: match.id,
            ladderId: match.ladderId,
            status: match.status,
            scheduledAt: match.scheduledAt,
            startedAt: match.startedAt,
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
  server.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const me = request.user.sub;
        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, id));
        if (!match) return reply.code(404).send({ error: 'match not found' });

        // ⚠️ L'AUTORISATION D'ABORD, le statut ensuite.
        // Répondre 200 (déjà annulé) ou 409 (déjà démarré) avant de vérifier qui appelle
        // donnerait à n'importe quel inconnu un ORACLE sur l'état d'un match : 404 =
        // n'existe pas, 200 = annulé, 409 = en cours. Ça contournerait le 403 qui protège
        // justement l'anonymat des slots dans GET /matches/:id.
        const [side0] = await db
          .select()
          .from(matchSidesTable)
          .where(and(eq(matchSidesTable.matchId, id), eq(matchSidesTable.sideIndex, 0)));
        if (!side0) return reply.code(500).send({ error: 'internal error' });
        if (side0.teamId !== null) {
          const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, side0.teamId));
          if (!team) return reply.code(500).send({ error: 'internal error' });
          if (team.captainId !== me)
            return reply.code(403).send({ error: 'Only team captain can cancel a pending game' });
        } else {
          const [participant] = await db
            .select()
            .from(matchParticipantsTable)
            .where(
              and(
                eq(matchParticipantsTable.matchSideId, side0.id),
                eq(matchParticipantsTable.userId, me),
              ),
            );
          if (!participant)
            return reply.code(403).send({ error: 'only the creator can cancel this match' });
        }

        // Le créateur est identifié : on peut maintenant parler de l'état du match.
        if (match.status === 'cancelled') return reply.code(200).send({ ok: true });
        if (match.status !== 'pending')
          return reply.code(409).send({ error: 'match already in progress or completed' });

        const [cancelled] = await db
          .update(matchesTable)
          .set({ status: 'cancelled' })
          .where(and(eq(matchesTable.id, id), eq(matchesTable.status, 'pending')))
          .returning();
        if (!cancelled) return reply.code(409).send({ error: 'match is no longer pending' });

        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.post<{ Params: { id: string } }>(
    '/:id/accept',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const { lineup } = acceptMatchSchema.parse(request.body ?? {});
        const me = request.user.sub;
        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, id));
        if (!match) return reply.code(404).send({ error: 'match not found' });
        if (match.status !== 'pending')
          return reply.code(409).send({ error: "match isn't pending" });
        const [ladder] = await db
          .select()
          .from(laddersTable)
          .where(eq(laddersTable.id, match.ladderId));
        if (!ladder) return reply.code(404).send({ error: 'ladder not found' });
        const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, ladder.gameId));
        if (!game) return reply.code(404).send({ error: 'game not found' });
        const side = await validateSide(ladder, game, me, lineup);
        if (!side.ok) {
          // on transmet unlinkedPlayers seulement s'il est là (échec §5.1 en team)
          const body: { error: string; unlinkedPlayers?: string[] } = { error: side.error };
          if (side.unlinkedPlayers) body.unlinkedPlayers = side.unlinkedPlayers;
          return reply.code(side.code).send(body);
        }

        // Le side 0 = le côté du créateur. Il nous sert à refuser l'auto-acceptation.
        const [side0] = await db
          .select()
          .from(matchSidesTable)
          .where(and(eq(matchSidesTable.matchId, id), eq(matchSidesTable.sideIndex, 0)));
        if (!side0) return reply.code(500).send({ error: 'internal error' });

        // Les joueurs du side 0 : servent à la garde solo ci-dessous ET à l'option A.
        const side0Participants = await db
          .select({ userId: matchParticipantsTable.userId })
          .from(matchParticipantsTable)
          .where(eq(matchParticipantsTable.matchSideId, side0.id));

        if (side.sideTeamId !== null) {
          // Team : l'identité du côté EST la team. unique(user_id, ladder_id) garantit
          // qu'un joueur n'a qu'une team par ladder → cette seule comparaison suffit.
          if (side0.teamId === side.sideTeamId)
            return reply.code(400).send({ error: 'you cannot accept your own slot' });
        } else {
          // Solo : les deux sides ont team_id = NULL → comparer les teamId ne détecterait
          // rien (null === null). L'identité du côté, ici, c'est le JOUEUR.
          if (side0Participants.some((p) => p.userId === me))
            return reply.code(400).send({ error: 'you cannot accept your own slot' });
        }

        // Les DEUX camps du match, identifiés avant la transaction.
        // Il faut verrouiller les deux (pas seulement l'accepteur) : la transaction va
        // toucher les slots ouverts des deux côtés (option A, plus bas). Verrouiller un
        // seul camp laissait passer l'acceptation croisée → interblocage Postgres.
        const creatorUserId = side0Participants[0]?.userId;
        const lockKeys = [competitorKey(ladder, side.sideTeamId, me)];
        if (side0.teamId) lockKeys.push(competitorKey(ladder, side0.teamId, me));
        else if (creatorUserId) lockKeys.push(competitorKey(ladder, null, creatorUserId));

        const accepted = await db.transaction(async (tx) => {
          // 0. VERROUS des deux camps, pris dans un ORDRE DÉTERMINISTE (tri des clés).
          //    L'ordre est ce qui empêche l'interblocage : deux accepts croisés (alice
          //    prend le slot de bob pendant que bob prend celui d'alice) demandent les
          //    MÊMES clés — triées, elles sont réclamées dans le même ordre, donc l'une
          //    attend l'autre au lieu de se bloquer mutuellement.
          await lockCompetitors(tx, lockKeys);

          // 1. §5.2 REVÉRIFIÉ sous le verrou — c'est CETTE lecture qui fait autorité.
          //    Celle de validateSide date d'avant le verrou : elle a pu voir « libre »
          //    alors qu'un accept concurrent était en train de rendre le camp occupé.
          if (await isLockedOut(tx, ladder, side.sideTeamId, me)) return { raced: 'locked' } as const;

          // 2. Update CONDITIONNEL : seul un match encore `pending` bascule. Si deux
          //    équipes acceptent LE MÊME match, la 2e ne touche aucune ligne → 409.
          //    started_at = maintenant → c'est CE moment qui arme le lockout §5.2.
          const [updated] = await tx
            .update(matchesTable)
            .set({ status: 'in_progress', startedAt: new Date() })
            .where(and(eq(matchesTable.id, id), eq(matchesTable.status, 'pending')))
            .returning();
          if (!updated) return { raced: 'taken' } as const;

          // 3. Le side 1 (l'accepteur) + ses joueurs.
          const [createdSide] = await tx
            .insert(matchSidesTable)
            .values({ matchId: id, sideIndex: 1, teamId: side.sideTeamId })
            .returning();
          if (!createdSide) throw new Error('match side insert returned no row');
          await tx
            .insert(matchParticipantsTable)
            .values(side.participantIds.map((userId) => ({ matchSideId: createdSide.id, userId })));

          // 4. Les deux camps sont maintenant ENGAGÉS : leurs autres slots ouverts
          //    doivent tomber. Sinon une 3e équipe accepterait un slot d'un camp déjà
          //    en match → deux matchs actifs en parallèle, lockout §5.2 contourné.
          if (side.sideTeamId !== null && side0.teamId !== null) {
            // Team : on annule par TEAM. Indispensable — annuler par joueur raterait
            // un slot ouvert avec une lineup disjointe de celle qu'on vient d'engager.
            const theirSlots = tx
              .select({ id: matchSidesTable.matchId })
              .from(matchSidesTable)
              .where(inArray(matchSidesTable.teamId, [side0.teamId, side.sideTeamId]));
            await tx
              .update(matchesTable)
              .set({ status: 'cancelled' })
              .where(
                and(
                  eq(matchesTable.status, 'pending'),
                  ne(matchesTable.id, id),
                  inArray(matchesTable.id, theirSlots),
                ),
              );
          } else {
            // Solo : on annule par JOUEUR, et seulement sur CE ladder — le lockout est
            // par ladder, mes slots ouverts ailleurs ne me concernent pas.
            const userIds = [me, ...side0Participants.map((p) => p.userId)];
            const theirSlots = tx
              .select({ id: matchSidesTable.matchId })
              .from(matchParticipantsTable)
              .innerJoin(
                matchSidesTable,
                eq(matchSidesTable.id, matchParticipantsTable.matchSideId),
              )
              .where(inArray(matchParticipantsTable.userId, userIds));
            await tx
              .update(matchesTable)
              .set({ status: 'cancelled' })
              .where(
                and(
                  eq(matchesTable.status, 'pending'),
                  ne(matchesTable.id, id),
                  eq(matchesTable.ladderId, match.ladderId),
                  inArray(matchesTable.id, theirSlots),
                ),
              );
          }

          return { raced: null, match: updated } as const;
        });

        // Deux courses distinctes, deux messages : « on m'a doublé sur CE match »
        // (update conditionnel) vs « je viens de m'engager ailleurs » (verrou §5.2).
        if (accepted.raced === 'taken')
          return reply.code(409).send({ error: 'match is no longer pending' });
        if (accepted.raced === 'locked')
          return reply.code(409).send({
            error: side.sideTeamId
              ? `team is locked out for ${ladder.lockoutMinutes} min after its last match`
              : `locked out for ${ladder.lockoutMinutes} min after your last match`,
          });

        return reply.code(200).send({ match: accepted.match });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.get('/me', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const me = request.user.sub;
      const asPlayer = await db
        .select({ matchId: matchSidesTable.matchId })
        .from(matchParticipantsTable)
        .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
        .where(eq(matchParticipantsTable.userId, me));
      const myTeams = await db
        .select({ teamId: teamMembersTable.teamId })
        .from(teamMembersTable)
        .where(eq(teamMembersTable.userId, me));

      const teamIds = myTeams.map((t) => t.teamId);

      const asTeam = teamIds.length
        ? await db
            .select({ matchId: matchSidesTable.matchId })
            .from(matchSidesTable)
            .where(inArray(matchSidesTable.teamId, teamIds))
        : [];
      const allRows = [...asPlayer, ...asTeam]; // tableau d'objets, avec doublons
      const allIds = allRows.map((r) => r.matchId); // tableau de chaînes, doublons encore là
      const matchIds = [...new Set(allIds)]; // dédupliqué, prêt pour inArray

      if (!matchIds.length) return reply.code(200).send({ matches: [] });
      const matches = await db
        .select({
          id: matchesTable.id,
          ladderId: matchesTable.ladderId,
          status: matchesTable.status,
          scheduledAt: matchesTable.scheduledAt,
          startedAt: matchesTable.startedAt,
          maps: matchesTable.maps,
        })
        .from(matchesTable)
        .where(inArray(matchesTable.id, matchIds))
        .orderBy(desc(matchesTable.createdAt));

      return reply.code(200).send({ matches });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
};
