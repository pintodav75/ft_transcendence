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
  disputesTable,
} from '../db/schema.js';
import { eq, and, ne, or, gt, lt, gte, inArray, notInArray, sql, desc } from 'drizzle-orm';
import z from 'zod';
import { completeMatchWithElo } from '../utils/rankings.js';
import {
  notify,
  pushNotifications,
  getAdminIds,
  type CreatedNotification,
} from '../utils/notifications.js';

// §5.2 — seuls les matchs ACTIFS verrouillent : un match terminé ou annulé libère aussitôt.
const LOCKING_STATUSES: ('in_progress' | 'awaiting_confirmation' | 'disputed')[] = [
  'in_progress',
  'awaiting_confirmation',
  'disputed',
];

// Les slots ne peuvent tomber que sur un quart fixe : :00, :15, :30, :45.
const SLOT_GRID_MINUTES = 15;

// Il faut au moins ce délai avant l'heure du match — pour créer ET pour accepter.
// Un slot qui passe sous cette barre est périmé : plus personne ne peut l'accepter.
const MIN_LEAD_MINUTES = 15;

// Un camp est ENGAGÉ par un slot ouvert (il peut être accepté à tout moment) comme par
// un match actif. Un match `completed` ou `cancelled` n'engage plus personne.
const ENGAGING_STATUSES: ('pending' | 'in_progress' | 'awaiting_confirmation' | 'disputed')[] = [
  'pending',
  ...LOCKING_STATUSES,
];

// Anti-spam : rien n'empêcherait une team d'ouvrir 50 slots pour saturer le tableau.
const MAX_OPEN_SLOTS = 5;

type Ladder = typeof laddersTable.$inferSelect;
type Game = typeof gamesTable.$inferSelect;

// `db` ou le `tx` d'une transaction : les deux exposent la même API de requête.
// Indispensable — les checks de disponibilité DOIVENT pouvoir tourner à l'intérieur
// d'une transaction (sinon ils lisent un instantané pris avant le verrou).
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * §5.2 — ce camp a-t-il déjà un match dont la FENÊTRE chevauche celle-ci ?
 *
 * Chaque match occupe [scheduled_at, scheduled_at + lockout_minutes]. Plutôt que de
 * comparer des intervalles, on retourne la question : un match me gêne si SON heure
 * tombe strictement dans ]mon_heure − lockout, mon_heure + lockout[.
 * Les deux bornes sont calculées EN JS → deux simples comparaisons colonne/valeur,
 * aucun SQL brut, et l'index (status, scheduled_at) est utilisé.
 *
 * ⚠️ INÉGALITÉS STRICTES (gt/lt, jamais gte/lte) : deux matchs qui se TOUCHENT
 * (21h–22h puis 22h–23h) ne se chevauchent PAS → l'enchaînement dos à dos est autorisé.
 * C'est le cas d'usage n°1 du ticket (« je planifie ma soirée »). Écrire gte/lte
 * casserait la feature.
 *
 * Remplace hasOpenSlot() + isLockedOut() : une seule question, posée à la création
 * ET à l'accept.
 *
 * ⚠️ PORTÉE : le « camp » est PAR LADDER, pas par personne (décision du 14/07).
 *   • 2v2+ → la TEAM (elle n'appartient qu'à un seul ladder)
 *   • 1v1  → le couple (JOUEUR, LADDER) — d'où le filtre eq(ladderId) dans la branche solo
 * Conséquence ASSUMÉE : un joueur peut avoir un match d'échecs ET un match Rocket League
 * à 21h. Un joueur aligné dans deux teams sur deux ladders peut être engagé deux fois.
 * CE N'EST PAS UN BUG — ne « corrigez » pas en retirant le filtre ladder.
 * Raison : la plateforme n'observe pas les parties ; l'absence se règle par dispute →
 * forfait ; et c'est une responsabilité humaine (le capitaine engage sa team en connaissance
 * de cause — si son joueur ne vient pas, c'est SA team qui perd). Cf. docs/schema.md §5.2.
 *
 * ⚠️ `statuses` DIFFÈRE selon l'appelant, et c'est essentiel :
 *   • CRÉATION → ENGAGING_STATUSES (pending + actifs). Je ne peux pas PROPOSER deux
 *     créneaux qui se chevauchent : si les deux slots étaient acceptés, je jouerais
 *     deux matchs à la fois.
 *   • ACCEPT   → LOCKING_STATUSES (actifs SEULEMENT). Mes slots `pending` qui
 *     chevauchent ne doivent PAS me bloquer : ce ne sont que des propositions, et
 *     l'option A (plus bas dans la transaction) va justement les RETIRER quand je
 *     m'engage pour de bon. Les compter ici reviendrait à me refuser un match à cause
 *     d'une offre que je m'apprête à annuler.
 *     La course « on accepte mon slot pendant que j'accepte le sien » reste couverte :
 *     le verrou sérialise, et la relecture sous verrou voit le match devenu ACTIF.
 */
async function hasConflictingMatch(
  executor: Executor,
  ladder: Ladder,
  teamId: string | null,
  userId: string,
  scheduledAt: Date,
  statuses: readonly ('pending' | 'in_progress' | 'awaiting_confirmation' | 'disputed')[],
  excludeMatchId?: string,
): Promise<boolean> {
  const lockoutMs = ladder.lockoutMinutes * 60 * 1000;
  const windowStart = new Date(scheduledAt.getTime() - lockoutMs);
  const windowEnd = new Date(scheduledAt.getTime() + lockoutMs);

  // Un slot `pending` dont l'heure approche à moins de MIN_LEAD_MINUTES est PÉRIMÉ :
  // plus personne ne peut l'accepter, il ne doit donc plus bloquer son propre créateur.
  const stillAcceptable = new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000);

  const conditions = [
    inArray(matchesTable.status, [...statuses]),
    gt(matchesTable.scheduledAt, windowStart),
    lt(matchesTable.scheduledAt, windowEnd),
    // « soit ce n'est pas un slot ouvert (donc un match actif : il compte toujours),
    //   soit c'est un slot ouvert encore acceptable »
    or(ne(matchesTable.status, 'pending'), gte(matchesTable.scheduledAt, stillAcceptable)),
  ];
  // À l'accept, le match qu'on accepte est DÉJÀ en base à cette heure exacte :
  // sans cette exclusion, il se déclarerait en conflit avec lui-même.
  if (excludeMatchId) conditions.push(ne(matchesTable.id, excludeMatchId));

  if (teamId) {
    // Une team n'appartient qu'à un seul ladder → pas besoin de filtrer dessus.
    const [conflict] = await executor
      .select({ id: matchesTable.id })
      .from(matchSidesTable)
      .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
      .where(and(eq(matchSidesTable.teamId, teamId), ...conditions));
    return !!conflict;
  }

  const [conflict] = await executor
    .select({ id: matchesTable.id })
    .from(matchParticipantsTable)
    .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
    .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
    .where(
      and(
        eq(matchParticipantsTable.userId, userId),
        eq(matchesTable.ladderId, ladder.id),
        ...conditions,
      ),
    );
  return !!conflict;
}

/**
 * Combien de slots ENCORE OUVERTS (et non périmés) ce camp a-t-il sur ce ladder ?
 *
 * Sert au plafond anti-spam. Les slots périmés ne comptent pas : ils sont morts, ils
 * n'ont pas à consommer un des 5 emplacements de leur créateur.
 */
async function countOpenSlots(
  executor: Executor,
  ladder: Ladder,
  teamId: string | null,
  userId: string,
): Promise<number> {
  const stillAcceptable = new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000);
  const conditions = [
    eq(matchesTable.status, 'pending' as const),
    gte(matchesTable.scheduledAt, stillAcceptable),
  ];

  if (teamId) {
    const rows = await executor
      .select({ id: matchesTable.id })
      .from(matchSidesTable)
      .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
      .where(and(eq(matchSidesTable.teamId, teamId), ...conditions));
    return rows.length;
  }

  const rows = await executor
    .select({ id: matchesTable.id })
    .from(matchParticipantsTable)
    .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
    .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
    .where(
      and(
        eq(matchParticipantsTable.userId, userId),
        eq(matchesTable.ladderId, ladder.id),
        ...conditions,
      ),
    );
  return rows.length;
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
 * ⚠️ Il ne dit RIEN du créneau. « Suis-je libre à cette heure ? » est une autre
 * question — c'est hasConflictingMatch(), appelé par les routes. validateSide valide
 * le CÔTÉ (qui joue), pas l'HORAIRE (quand).
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

  return { ok: true, sideTeamId: team.id, participantIds: lineup };
}

const createMatchSchema = z.object({
  ladderId: z.uuid(),
  scheduledAt: z.coerce
    .date()
    .refine(
      (date) =>
        date.getUTCMinutes() % SLOT_GRID_MINUTES === 0 &&
        date.getUTCSeconds() === 0 &&
        date.getUTCMilliseconds() === 0,
      { message: `scheduledAt must be on a ${SLOT_GRID_MINUTES}-minute slot (:00, :15, :30, :45)` },
    )
    .refine((date) => date.getTime() - Date.now() >= MIN_LEAD_MINUTES * 60 * 1000, {
      message: `scheduledAt must be at least ${MIN_LEAD_MINUTES} minutes from now`,
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
const winnerIdSchema = z.object({ winnerSideId: z.uuid() });

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

      // §5.2 — suis-je déjà pris à cette heure ? Un slot ouvert m'engage autant qu'un
      // match actif : les deux occupent le créneau. (Ce check ne valide pas le CÔTÉ,
      // il valide le CRÉNEAU → il ne peut pas vivre dans validateSide.)
      // ⚠️ Chemin RAPIDE : la vérification qui fait autorité est refaite dans la
      // transaction, sous verrou (sinon 2 POST simultanés passent tous les deux — TOCTOU).
      if (
        await hasConflictingMatch(db, ladder, sideTeamId, me, data.scheduledAt, ENGAGING_STATUSES)
      )
        return reply.code(409).send({
          error: sideTeamId
            ? 'your team already has a match around that time'
            : 'you already have a match around that time',
        });

      // Plafond anti-spam (chemin rapide, revérifié sous verrou).
      if ((await countOpenSlots(db, ladder, sideTeamId, me)) >= MAX_OPEN_SLOTS)
        return reply
          .code(409)
          .send({ error: `you cannot have more than ${MAX_OPEN_SLOTS} open slots on a ladder` });

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

        // Relectures SOUS le verrou — ce sont CELLES-CI qui font autorité. Un POST ou un
        // accept concurrent a pu m'engager sur ce créneau entre-temps.
        if (
          await hasConflictingMatch(tx, ladder, sideTeamId, me, data.scheduledAt, ENGAGING_STATUSES)
        )
          return { raced: 'conflict' } as const;
        if ((await countOpenSlots(tx, ladder, sideTeamId, me)) >= MAX_OPEN_SLOTS)
          return { raced: 'too_many' } as const;

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

      if (created.raced === 'conflict')
        return reply.code(409).send({
          error: sideTeamId
            ? 'your team already has a match around that time'
            : 'you already have a match around that time',
        });
      if (created.raced === 'too_many')
        return reply
          .code(409)
          .send({ error: `you cannot have more than ${MAX_OPEN_SLOTS} open slots on a ladder` });

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

      const conditions = [
        eq(matchesTable.ladderId, ladderId),
        eq(matchesTable.status, 'pending'),
        // Masquer les slots PÉRIMÉS : à moins de MIN_LEAD_MINUTES du coup d'envoi, plus
        // personne ne peut les accepter — ils n'ont plus rien à faire sur le tableau.
        // (Le job les passera à `cancelled` à sa prochaine passe ; en attendant, on ne
        //  les montre pas.)
        gte(matchesTable.scheduledAt, new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000)),
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
            // id du side : c'est ce que le front renvoie comme `winnerSideId` à POST /result.
            id: s.id,
            sideIndex: s.sideIndex,
            // état de soumission (B6) : le front affiche « en attente de l'adversaire… »
            // et calcule le temps restant (submittedAt + 24 h) côté client.
            submittedAt: s.submittedAt,
            submittedWinnerSideId: s.submittedWinnerSideId,
            // solo : pas de team → null. Le front distingue les deux cas là-dessus.
            team: s.teamId ? (teamById.get(s.teamId) ?? null) : null,
            players: participants
              .filter((p) => p.matchSideId === s.id)
              .map((p) => playerById.get(p.userId))
              .filter((p): p is NonNullable<typeof p> => p !== undefined),
          }));

        // Quand le match est en dispute, exposer l'id de la dispute pour que le front
        // puisse naviguer vers GET /disputes/:id. null dans tous les autres états.
        let disputeId: string | null = null;
        if (match.status === 'disputed') {
          const [dispute] = await db
            .select({ id: disputesTable.id })
            .from(disputesTable)
            .where(eq(disputesTable.matchId, match.id));
          disputeId = dispute?.id ?? null;
        }

        return reply.code(200).send({
          match: {
            id: match.id,
            ladderId: match.ladderId,
            status: match.status,
            scheduledAt: match.scheduledAt,
            startedAt: match.startedAt,
            completedAt: match.completedAt,
            winnerSideId: match.winnerSideId,
            maps: match.maps,
            createdAt: match.createdAt,
            disputeId,
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

        // EXPIRATION — un slot n'est plus acceptable à moins de MIN_LEAD_MINUTES de son
        // heure. Le job d'expiration tourne à la minute : il existe donc une fenêtre où le
        // slot est déjà mort mais encore `pending` en base. Cette garde la ferme.
        // (Le `!match.scheduledAt` ne devrait jamais arriver — Zod l'impose à la création —
        //  mais la colonne est nullable, donc TypeScript exige qu'on le traite.)
        if (
          !match.scheduledAt ||
          match.scheduledAt.getTime() - Date.now() < MIN_LEAD_MINUTES * 60 * 1000
        )
          return reply.code(409).send({
            error: `slot is no longer acceptable (less than ${MIN_LEAD_MINUTES} min before kickoff)`,
          });

        // L'heure du match, capturée dans une const : le narrowing de `match.scheduledAt`
        // (Date | null → Date) ne survit pas à l'intérieur du callback de la transaction.
        const kickoff = match.scheduledAt;

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

        // §5.2 — l'ACCEPTEUR est-il libre sur ce créneau ? (chemin rapide ; la vérif qui
        // fait autorité est refaite sous verrou dans la transaction). On EXCLUT le match
        // lui-même : il est déjà en base à cette heure exacte, il se déclarerait en
        // conflit avec lui-même.
        if (
          await hasConflictingMatch(db, ladder, side.sideTeamId, me, kickoff, LOCKING_STATUSES, id)
        )
          return reply.code(409).send({
            error: side.sideTeamId
              ? 'your team already has a match around that time'
              : 'you already have a match around that time',
          });

        // Les DEUX camps du match, identifiés avant la transaction.
        // Il faut verrouiller les deux (pas seulement l'accepteur) : la transaction va
        // toucher les slots ouverts des deux côtés (option A, plus bas). Verrouiller un
        // seul camp laissait passer l'acceptation croisée → interblocage Postgres.
        const creatorUserId = side0Participants[0]?.userId;
        const lockKeys = [competitorKey(ladder, side.sideTeamId, me)];
        if (side0.teamId) lockKeys.push(competitorKey(ladder, side0.teamId, me));
        else if (creatorUserId) lockKeys.push(competitorKey(ladder, null, creatorUserId));

        // La fenêtre occupée par le match qu'on accepte. Sert à l'option A ci-dessous :
        // seuls les slots qui CHEVAUCHENT cette fenêtre doivent tomber.
        const lockoutMs = ladder.lockoutMinutes * 60 * 1000;
        const windowStart = new Date(kickoff.getTime() - lockoutMs);
        const windowEnd = new Date(kickoff.getTime() + lockoutMs);

        const accepted = await db.transaction(async (tx) => {
          // 0. VERROUS des deux camps, pris dans un ORDRE DÉTERMINISTE (tri des clés).
          //    L'ordre est ce qui empêche l'interblocage : deux accepts croisés (alice
          //    prend le slot de bob pendant que bob prend celui d'alice) demandent les
          //    MÊMES clés — triées, elles sont réclamées dans le même ordre, donc l'une
          //    attend l'autre au lieu de se bloquer mutuellement.
          await lockCompetitors(tx, lockKeys);

          // 1. §5.2 REVÉRIFIÉ sous le verrou — c'est CETTE lecture qui fait autorité.
          //    Le chemin rapide date d'avant le verrou : il a pu voir « libre » alors
          //    qu'un accept concurrent était en train d'occuper le créneau.
          if (
            await hasConflictingMatch(
              tx,
              ladder,
              side.sideTeamId,
              me,
              kickoff,
              LOCKING_STATUSES,
              id,
            )
          )
            return { raced: 'conflict' } as const;

          // 2. Update CONDITIONNEL : seul un match encore `pending` bascule. Si deux
          //    équipes acceptent LE MÊME match, la 2e ne touche aucune ligne → 409.
          //    started_at = maintenant : historique de l'acceptation seulement.
          //    Aucune règle ne le lit — la dispo §5.2 est pilotée par scheduled_at.
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

          // B9 — « ton défi a été accepté » : les joueurs ALIGNÉS du camp créateur (side 0).
          // L'accepteur (l'acteur) n'y est jamais — la garde anti-auto-accept l'exclut du
          // side 0. Insert DANS la tx (un rollback ne doit pas notifier) ; push après commit.
          const notifs = await notify(
            tx,
            side0Participants.map((p) => p.userId),
            'match_accepted',
            { matchId: id, ladderId: match.ladderId, scheduledAt: kickoff.toISOString() },
          );

          // 4. Les deux camps sont maintenant ENGAGÉS sur ce CRÉNEAU : leurs slots ouverts
          //    qui CHEVAUCHENT cette fenêtre doivent tomber. Sinon une 3e équipe en
          //    accepterait un → deux matchs qui se recouvrent, §5.2 contourné.
          //
          //    ⚠️ On n'annule QUE ceux qui chevauchent — surtout PAS tous les slots ouverts.
          //    Une team qui a planifié 21h / 23h / 01h et se fait accepter celui de 21h doit
          //    GARDER ceux de 23h et 01h : ils ne se recouvrent pas. C'est tout l'objet de B5d.
          const overlapsWindow = [
            gt(matchesTable.scheduledAt, windowStart),
            lt(matchesTable.scheduledAt, windowEnd),
          ];

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
                  ...overlapsWindow,
                ),
              );
          } else {
            // Solo : on annule par JOUEUR, et seulement sur CE ladder — mes slots ouverts
            // sur d'autres ladders ne me concernent pas.
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
                  ...overlapsWindow,
                ),
              );
          }

          return { raced: null, match: updated, notifs } as const;
        });

        // Deux courses distinctes, deux messages : « on m'a doublé sur CE match »
        // (update conditionnel) vs « je viens de m'engager ailleurs » (verrou §5.2).
        if (accepted.raced === 'taken')
          return reply.code(409).send({ error: 'match is no longer pending' });
        if (accepted.raced === 'conflict')
          return reply.code(409).send({
            error: side.sideTeamId
              ? 'your team already has a match around that time'
              : 'you already have a match around that time',
          });

        // Push WS APRÈS le commit — best-effort, ne peut pas faire échouer l'accept.
        pushNotifications(accepted.notifs);
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
  // ===== B6 — Soumission de résultat & confirmation =====
  server.post<{ Params: { id: string } }>(
    '/:id/result',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const { winnerSideId } = winnerIdSchema.parse(request.body);
        const me = request.user.sub;

        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, id));
        if (!match) return reply.code(404).send({ error: 'match not found' });
        const sides = await db
          .select()
          .from(matchSidesTable)
          .where(eq(matchSidesTable.matchId, id));
        // On identifie le side de CELUI QUI SOUMET (capitaine en 2v2+, joueur en 1v1).
        // L'autorisation passe AVANT les gardes de statut : répondre 409/400 à un
        // non-participant lui donnerait un oracle sur l'état du match (même logique que
        // DELETE /:id). D'où le 403 d'abord, le reste ensuite.
        let mySide = null;
        for (const side of sides) {
          let owned = false;
          if (side.teamId !== null) {
            const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, side.teamId));
            owned = team?.captainId === me;
          } else {
            const [participant] = await db
              .select()
              .from(matchParticipantsTable)
              .where(
                and(
                  eq(matchParticipantsTable.matchSideId, side.id),
                  eq(matchParticipantsTable.userId, me),
                ),
              );
            owned = !!participant;
          }
          if (owned) {
            mySide = side;
            break;
          }
        }
        if (!mySide) return reply.code(403).send({ error: 'not a participant of this match' });
        if (match.status !== 'in_progress' && match.status !== 'awaiting_confirmation')
          return reply.code(409).send({ error: 'match is not awaiting a result' });
        // Le vainqueur déclaré doit être l'un des DEUX sides de CE match. Sans ce garde,
        // un uuid quelconque partirait en base sur submitted_winner_side_id (FK vers
        // match_sides.id) -> violation de contrainte -> 500 au lieu d'un 400 propre.
        if (!sides.some((s) => s.id === winnerSideId))
          return reply.code(400).send({ error: 'winnerSideId is not a side of this match' });
        if (!match.scheduledAt) return reply.code(500).send({ error: 'Internal error' });
        if (new Date() < match.scheduledAt)
          return reply.code(400).send({ error: 'match not started yet' });

        // Toutes les écritures sous verrou + re-lecture : deux camps qui soumettent en
        // même temps courent sur la même ligne match (TOCTOU, piège #14). Le verrou
        // sérialise, la re-lecture ci-dessous fait autorité (pas la lecture d'avant tx).
        const result = await db.transaction(
          async (
            tx,
          ): Promise<
            | { ok: true; status: string; notifs: CreatedNotification[] }
            | { ok: false; code: number; error: string }
          > => {
            await lockCompetitors(tx, [id]);
            const [currentMatch] = await tx
              .select({ status: matchesTable.status })
              .from(matchesTable)
              .where(eq(matchesTable.id, id));
            if (!currentMatch) return { ok: false, code: 500, error: 'Internal error' };
            if (
              currentMatch.status !== 'in_progress' &&
              currentMatch.status !== 'awaiting_confirmation'
            )
              // Course : le job ou une autre requête a complété/annulé le match entre le 1er
              // check (hors tx) et le verrou. C'est un CONFLIT (409), pas une erreur interne.
              return { ok: false, code: 409, error: 'match is no longer awaiting a result' };
            // Re-soumission = ÉCRASEMENT (choix assumé) : un camp peut corriger son verdict
            // tant que le match n'est pas résolu ; submitted_at est remis à maintenant, ce qui
            // relance sa propre fenêtre de 24 h. Le job d'auto-confirmation relit cette valeur
            // sous verrou, il ne peut donc pas valider un ancien vainqueur (cf. jobs/index.ts).
            await tx
              .update(matchSidesTable)
              .set({ submittedAt: new Date(), submittedWinnerSideId: winnerSideId })
              .where(eq(matchSidesTable.id, mySide.id));
            // L'AUTRE side est le point de bascule premier/deuxième soumetteur :
            //   - il n'a pas soumis (submittedAt null) -> je suis le 1er -> awaiting_confirmation
            //   - il a soumis                          -> je suis le 2e  -> on compare les vainqueurs
            // On regarde l'AUTRE side (pas le statut du match) pour ne pas confondre
            // « quelqu'un a soumis » avec « l'autre a soumis » (cas de ma re-soumission).
            const [otherSide] = await tx
              .select({
                id: matchSidesTable.id,
                submittedAt: matchSidesTable.submittedAt,
                submittedWinnerSideId: matchSidesTable.submittedWinnerSideId,
              })
              .from(matchSidesTable)
              .where(and(eq(matchSidesTable.matchId, id), ne(matchSidesTable.id, mySide.id)));
            if (!otherSide) return { ok: false, code: 500, error: 'Internal error' };

            // B9 — destinataires : les joueurs alignés, JAMAIS l'acteur (`me`). En équipe,
            // les coéquipiers de l'acteur restent notifiés (seul l'auteur du clic est exclu).
            // Une seule requête pour les deux sides — le filtrage se fait en mémoire.
            const participants = await tx
              .select({
                matchSideId: matchParticipantsTable.matchSideId,
                userId: matchParticipantsTable.userId,
              })
              .from(matchParticipantsTable)
              .where(
                inArray(
                  matchParticipantsTable.matchSideId,
                  sides.map((s) => s.id),
                ),
              );
            const bothSidesButMe = participants.map((p) => p.userId).filter((u) => u !== me);

            if (otherSide.submittedAt === null) {
              await tx
                .update(matchesTable)
                .set({ status: 'awaiting_confirmation' })
                .where(and(eq(matchesTable.id, id), eq(matchesTable.status, 'in_progress')));
              // Notifier UNIQUEMENT sur la VRAIE première soumission (transition
              // in_progress -> awaiting_confirmation), pas sur une re-soumission du même
              // camp pendant qu'il attend toujours l'autre : `otherSide.submittedAt===null`
              // reste vrai à CHAQUE re-soumission tant que l'adversaire n'a pas répondu,
              // ce qui spammait l'adversaire d'une notif par clic. `currentMatch.status` a
              // été lu SOUS VERROU avant toute écriture de cette transaction : il ne vaut
              // 'in_progress' que la toute première fois — une re-soumission le trouve déjà
              // à 'awaiting_confirmation' (posé par le 1er appel) et n'entre pas ici.
              // SEUL l'autre camp est prévenu (« l'adversaire a soumis un score, tu as
              // 24 h ») — mes coéquipiers n'ont rien à confirmer, eux.
              const notifs =
                currentMatch.status === 'in_progress'
                  ? await notify(
                      tx,
                      participants
                        .filter((p) => p.matchSideId === otherSide.id)
                        .map((p) => p.userId),
                      'result_submitted',
                      { matchId: id, ladderId: match.ladderId },
                    )
                  : [];
              return { ok: true, status: 'awaiting_confirmation', notifs };
            } else {
              if (otherSide.submittedWinnerSideId === winnerSideId) {
                // ACCORD : les deux camps ont désigné le même vainqueur -> match clos + ELO,
                // dans la MÊME transaction. Helper partagé avec le job d'auto-confirmation (B6)
                // et l'arbitrage admin (B7) — la logique de clôture + ELO vit à un seul endroit.
                await completeMatchWithElo(tx, id, match.ladderId, winnerSideId);
                const notifs = await notify(tx, bothSidesButMe, 'result_confirmed', {
                  matchId: id,
                  ladderId: match.ladderId,
                  winnerSideId,
                });
                return { ok: true, status: 'completed', notifs };
              } else {
                // DÉSACCORD : vainqueurs différents -> le match part en litige, on ouvre une
                // dispute et B7 (arbitrage admin / timeout 24 h) prend le relais. Aucun ELO ici.
                await tx
                  .update(matchesTable)
                  .set({ status: 'disputed' })
                  .where(eq(matchesTable.id, id));
                const [dispute] = await tx
                  .insert(disputesTable)
                  .values({ matchId: id })
                  .returning({ id: disputesTable.id });
                if (!dispute) return { ok: false, code: 500, error: 'Internal error' };
                // Deux fan-outs : les joueurs (« litige ouvert ») + TOUS les admins (« un
                // litige attend ton arbitrage » — c'est ce qui rend B7 push, pas pull).
                // Un admin qui serait aussi l'acteur n'est pas notifié (règle : jamais l'acteur).
                const admins = (await getAdminIds(tx)).filter((u) => u !== me);
                const notifs = [
                  ...(await notify(tx, bothSidesButMe, 'dispute_opened', {
                    matchId: id,
                    ladderId: match.ladderId,
                    disputeId: dispute.id,
                  })),
                  ...(await notify(tx, admins, 'dispute_needs_admin', {
                    matchId: id,
                    ladderId: match.ladderId,
                    disputeId: dispute.id,
                  })),
                ];
                return { ok: true, status: 'disputed', notifs };
              }
            }
          },
        );
        if (!result.ok) return reply.code(result.code).send({ error: result.error });
        // Push WS APRÈS le commit — un rollback ne notifie jamais.
        pushNotifications(result.notifs);
        return reply.code(200).send({ status: result.status });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
