import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import {
  teamsTable,
  teamMembersTable,
  teamInvitationsTable,
  laddersTable,
  usersTable,
  gamesTable,
  userExternalAccountsTable,
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  disputesTable,
} from '../db/schema.js';
import { eq, ne, and, asc, desc, count, inArray, sql } from 'drizzle-orm';
import {
  notify,
  pushNotifications,
  getMatchParticipantIds,
  type CreatedNotification,
} from '../utils/notifications.js';
import { ENGAGING_STATUSES, LOCKING_STATUSES } from '../utils/match-status.js';
import { isBlocked } from '../utils/blocks.js';
import { minioClient, BUCKET_NAME, buildPublicUrl, removeHostedObject } from '../storage/minio.js';
import { IMAGE_MIME } from './users.js';
import { randomUUID } from 'node:crypto';
import { rlMax } from '../utils/rate-limit.js';
import z from 'zod';

// `logoUrl` est optionnel à la création : même règle HTTPS qu'à l'édition (voir le
// commentaire d'`updateTeamSchema` plus bas). Non fourni → la colonne reste `null`.
// Pas de `.nullable()` ici : on ne « retire » pas un logo sur une team qui n'existe pas.
const createTeamSchema = z.object({
  ladderId: z.uuid(),
  name: z.string().trim().min(1).max(50),
  logoUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .optional(),
});
const inviteSchema = z.object({ userId: z.uuid() });
const idParamSchema = z.object({ id: z.uuid() });
const memberParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });
const invitationParamsSchema = z.object({ id: z.uuid(), invitationId: z.uuid() });
const invitationIdParamSchema = z.object({ invitationId: z.uuid() });

/** Membres + invitations en attente : le roster « réservé » d'une équipe (B-INV). */
const MAX_ROSTER = 10;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Clé de verrou d'une ÉQUIPE — même convention que `competitorKey()` dans `matches.ts`. */
const teamKey = (teamId: string) => `team:${teamId}`;
// Cle de verrou d'un joueur sur un ladder : c'est la portee reelle de la regle "une seule
// equipe par ladder". Meme convention que competitorKey() cote solo.
const playerLadderKey = (userId: string, ladderId: string) => `user:${userId}:${ladderId}`;

// Prend les verrous qui protegent le roster, toujours dans le meme ordre.
//
// On verrouille pour deux raisons differentes. La cle team: protege le plafond de 10 joueurs,
// qui se verifie en comptant des lignes : deux transactions qui lisent "9" en meme temps
// passent toutes les deux. La cle user:<id>:<ladder> protege l'inscription du joueur, parce
// que l'acceptation d'une invitation touche des lignes qui appartiennent a d'AUTRES equipes.
//
// Le verrou d'equipe seul ne suffit pas. Si le meme joueur accepte deux invitations de deux
// equipes du meme ladder, les cles team: sont differentes, les deux transactions ne se voient
// pas et finissent par s'attendre l'une l'autre : Postgres en tue une et on rend une 500 la ou
// on voulait un 409. Ca arrive pour de vrai, il suffit de deux boutons Accepter dans la cloche.
//
// Le tri n'est pas cosmetique, c'est lui qui empeche l'interblocage. Toute route qui ecrit sur
// le roster doit passer par ici avec toutes ses cles, y compris celles qu'elle touche par
// cascade sans que ca se voie dans son code.
async function lockRoster(tx: Tx, keys: string[]): Promise<void> {
  // Set = dédoublonne, sort = l'ordre commun à toutes les transactions.
  for (const key of [...new Set(keys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

/** Places occupées : membres actuels + invitations encore en attente. */
async function countRosterSlots(tx: Tx, teamId: string): Promise<number> {
  const [members] = await tx
    .select({ total: count() })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId));
  const [pending] = await tx
    .select({ total: count() })
    .from(teamInvitationsTable)
    .where(
      and(eq(teamInvitationsTable.teamId, teamId), eq(teamInvitationsTable.status, 'pending')),
    );
  if (!members || !pending) throw new Error('roster count returned no row');
  return members.total + pending.total;
}

// Une invitation vue du cote de l'equipe : qui a ete sollicite. Deux routes la renvoient, et
// elles doivent rendre exactement la meme forme sinon le front gere deux objets differents.
function shapeInvitation(
  invitation: typeof teamInvitationsTable.$inferSelect,
  user: { id: string; pseudo: string; displayName: string | null; avatarUrl: string | null },
) {
  return {
    id: invitation.id,
    teamId: invitation.teamId,
    ladderId: invitation.ladderId,
    status: invitation.status,
    invitedBy: invitation.invitedBy,
    createdAt: invitation.createdAt,
    user,
  };
}

// Violation de cle etrangere : Drizzle range l'erreur du driver dans error.cause. En pratique
// ca veut dire que l'equipe a ete dissoute entre la lecture et l'ecriture, donc 404 et pas 500.
function foreignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === '23503'
  );
}

// Edition d'une equipe : les deux champs sont optionnels mais la route refuse un corps vide.
// logoUrl a null retire le logo.
// On force https a la main parce que z.url() tout seul accepte n'importe quel protocole, y
// compris javascript:. La valeur est stockee et reaffichee ailleurs, donc on refuse a l'entree
// plutot que de faire confiance a tous ceux qui la reliront plus tard.
const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    logoUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
  })
  .partial();

// Rend le nom de la contrainte d'unicite violee, ou undefined. Evite de redeballer
// error.cause dans chaque route.
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
        // 🔒 B-INV — cette route écrit désormais `team_invitations` (annulation en cascade
        // plus bas), donc elle rejoint le régime de `lockRoster`. La clé JOUEUR suffit :
        // l'équipe est créée ICI, personne d'autre ne connaît encore son id, il n'y a rien
        // à sérialiser de ce côté. Sans ce verrou, on rouvrirait exactement le cycle de la
        // review précédente — une acceptation concurrente tient une ligne d'invitation et
        // veut l'index `(user, ladder)`, pendant qu'on tient l'index et qu'on veut la ligne.
        await lockRoster(tx, [playerLadderKey(userId, data.ladderId)]);
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
        // B-INV — MÊME RÈGLE QU'À L'ACCEPTATION, et pour la même raison : le créateur a
        // désormais une équipe sur ce ladder, les invitations qu'il avait reçues ne
        // pourront plus JAMAIS aboutir (`409 already_in_team`). Les laisser `pending`
        // n'est pas cosmétique : elles restent affichées dans `GET /teams/invitations/me`
        // et surtout elles OCCUPENT une place du plafond de 10 de l'équipe qui les a
        // émises — un capitaine perdait un slot de roster à cause d'une invitation morte,
        // sans rien pour l'expliquer. `cancelled` et non `declined` : il n'a rien refusé.
        await tx
          .update(teamInvitationsTable)
          .set({ status: 'cancelled', respondedAt: new Date() })
          .where(
            and(
              eq(teamInvitationsTable.userId, userId),
              eq(teamInvitationsTable.ladderId, created.ladderId),
              eq(teamInvitationsTable.status, 'pending'),
            ),
          );
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
        const me = request.user.sub;
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

        // Projection EXPLICITE sur `users` (invariant #6). Un `select()` nu sur ce join
        // remontait toute la ligne — `password_hash`, `email`, `totp_secret` compris. Rien
        // ne fuitait sur le fil (la projection se faisait plus bas, en JS), mais l'invariant
        // porte sur le CHARGEMENT : ces colonnes ne doivent pas quitter la base, sous peine
        // qu'un futur `res.send(row)` les publie sans que personne ne le remarque.
        const members = await db
          .select({
            id: usersTable.id,
            pseudo: usersTable.pseudo,
            displayName: usersTable.displayName,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(teamMembersTable)
          .innerJoin(usersTable, eq(usersTable.id, teamMembersTable.userId))
          .where(eq(teamMembersTable.teamId, id));

        // §5.1 — qui, parmi ces membres, a lié le compte exigé par CE jeu ?
        // Une seule requête pour tout le roster (pas un appel par membre).
        const memberIds = members.map((row) => row.id);
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
          ...row,
          isCaptain: row.id === team.teams.captainId,
          // true = sélectionnable dans une lineup ; false = le front le grise
          hasLinkedAccount: linkedIds.has(row.id),
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

        // Divulgation progressive, même patron que `isMember` sur GET /teams/:id/matches :
        // les invitations en attente ne sortent QU'AUX MEMBRES. C'est ce qui permet au
        // capitaine de voir « joueur X · en attente » ; un visiteur ne doit pas apprendre
        // qui a été sollicité (ni qu'une équipe recrute). Champ ABSENT pour un non-membre,
        // pas vide : même choix que `lineup` sur l'historique de matchs.
        const isMember = members.some((row) => row.id === me);
        const invitations = isMember
          ? (
              await db
                // Projection explicite des DEUX côtés du join (invariant #6) : `usersTable`
                // en entier chargerait `password_hash`/`email`/`totp_secret` pour rien.
                .select({
                  invitation: teamInvitationsTable,
                  user: {
                    id: usersTable.id,
                    pseudo: usersTable.pseudo,
                    displayName: usersTable.displayName,
                    avatarUrl: usersTable.avatarUrl,
                  },
                })
                .from(teamInvitationsTable)
                .innerJoin(usersTable, eq(usersTable.id, teamInvitationsTable.userId))
                .where(
                  and(
                    eq(teamInvitationsTable.teamId, id),
                    eq(teamInvitationsTable.status, 'pending'),
                  ),
                )
                .orderBy(asc(teamInvitationsTable.createdAt))
            ).map((row) => shapeInvitation(row.invitation, row.user))
          : undefined;

        return reply.code(200).send({
          team: teamSafe,
          members: membersSafe,
          isMember,
          ...(invitations ? { invitations } : {}),
        });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  // Historique des matchs d'une equipe. Que de la lecture, et un nombre de requetes constant
  // quel que soit le nombre de matchs : une par table puis des Map, jamais d'await en boucle.
  // Un non-membre ne voit que les matchs qui ont deux camps, donc ceux qu'un adversaire a
  // acceptes. On filtre sur le nombre de camps plutot que sur le statut parce qu'un creneau
  // perime finit en cancelled et fuiterait quand meme aux visiteurs. Un membre voit tout,
  // et lui seul recoit les compositions.
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
  // Upload du logo d'equipe, reserve au capitaine, calque sur l'avatar. PATCH /teams/:id
  // n'accepte qu'une URL deja hebergee ailleurs, ce qui ne sert a rien quand on a un fichier.
  // On range le logo dans le bucket public des avatars : il est tout aussi public, et un
  // bucket dedie coutait de la config pour rien.
  // L'URL qu'on fabrique est un chemin relatif, elle ne passe donc pas la regle https de
  // PATCH. C'est normal : cette regle protege les URL saisies par un utilisateur, pas les
  // notres.
  server.post<{ Params: { id: string } }>(
    '/:id/logo',
    {
      onRequest: [server.authenticate],
      // Même quota que l'avatar : 20 uploads/min PAR COMPTE (le `keyGenerator` global est
      // hérité, et la route est authentifiée → la clé est le `sub` du JWT, pas l'IP). Borne
      // le trafic MinIO sans jamais gêner un capitaine qui hésite entre trois logos.
      config: { rateLimit: { max: rlMax(20), timeWindow: '1 minute' } },
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

        // On charge le fichier en memoire au lieu de le streamer vers MinIO. Ce n'est pas du
        // style : brancher le flux directement sur putObject tronque le fichier sans rien
        // dire une fois la limite atteinte, et on stockait une image coupee en repondant 200.
        // toBuffer leve une erreur qu'on transforme en 413, et rien ne part dans le bucket.
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
  // Les invitations.
  // L'ajout force d'un membre a ete supprime : comme on ne peut etre que dans une equipe par
  // ladder, ajouter quelqu'un sans son accord ne lui rendait pas service, ca le bloquait sur
  // tout le ladder. Maintenant le capitaine propose et le joueur accepte ou refuse.
  // L'invitation a sa propre table plutot qu'une colonne de statut sur team_members : cette
  // table est lue partout et chaque lecture veut dire "X est membre de Y". Y ajouter un statut
  // rendrait toutes ces lectures fausses par defaut.

  // POST /teams/:id/invitations — inviter un joueur (capitaine only).
  server.post<{ Params: { id: string } }>(
    '/:id/invitations',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        // Zod APRÈS `authenticate` (invariant repo) : anonyme → 401, malformé → 400.
        const { id: teamId } = idParamSchema.parse(request.params);
        const data = inviteSchema.parse(request.body);

        const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'team not found', code: 'team_not_found' });
        if (team.captainId !== me)
          return reply
            .code(403)
            .send({ error: 'only the captain can invite players', code: 'not_captain' });

        // Les deux users en UNE requête : la cible (404 + affichage côté front) et le
        // capitaine (dont le pseudo part dans la notif). Projection explicite : jamais de
        // `select()` nu sur `users` (fuite email/passwordHash).
        const people = await db
          .select({
            id: usersTable.id,
            pseudo: usersTable.pseudo,
            displayName: usersTable.displayName,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, [me, data.userId]));
        const target = people.find((p) => p.id === data.userId);
        const actor = people.find((p) => p.id === me);
        if (!target)
          return reply.code(404).send({ error: 'user not found', code: 'user_not_found' });
        if (!actor) return reply.code(500).send({ error: 'Internal error' });

        // Blocage : l'invitation est un CANAL DE CONTACT de plus (elle pousse une
        // notification non sollicitée). Les 4 autres canaux le filtrent déjà — `friends.ts`,
        // `chat.ts`, `messages.ts`, `users.ts` —, celui-ci ne peut pas être l'exception.
        // Symétrique (le helper teste les deux sens) et **indistinguable d'un user
        // inexistant**, exactement comme `POST /friends` : un 403 « vous êtes bloqué »
        // confirmerait le blocage à celui qui le sonde.
        if (await isBlocked(me, target.id))
          return reply.code(404).send({ error: 'user not found', code: 'user_not_found' });

        const outcome = await db.transaction(async (tx) => {
          // 🔒 Piège #14 : un check en code n'est jamais atomique. Sans verrou, deux
          // invitations simultanées à 9 places occupées franchiraient le plafond ensemble.
          // Les DEUX clés, triées (piège #15) : `team:` pour le plafond, `user:…:ladder`
          // pour la garde « déjà une équipe sur ce ladder », dont la portée est le joueur
          // et non l'équipe. Prendre le même jeu de clés que l'acceptation est ce qui
          // garantit qu'aucune paire de routes ne peut se croiser en ordre inverse.
          // ⚠️ `team.ladderId` vient de la lecture rapide : la colonne est IMMUABLE (aucune
          // route ne déplace une équipe de ladder), la clé est donc stable avant le verrou.
          await lockRoster(tx, [teamKey(teamId), playerLadderKey(data.userId, team.ladderId)]);

          // Relecture SOUS le verrou : c'est CELLE-CI qui fait autorité (l'équipe a pu
          // être dissoute, renommée, ou le capitanat changer depuis le fast-path).
          const [current] = await tx.select().from(teamsTable).where(eq(teamsTable.id, teamId));
          if (!current)
            return {
              ok: false as const,
              status: 404,
              error: 'team not found',
              code: 'team_not_found',
            };
          if (current.captainId !== me)
            return {
              ok: false as const,
              status: 403,
              error: 'only the captain can invite players',
              code: 'not_captain',
            };

          // Déjà membre de CETTE équipe ? Message dédié — c'est un sous-cas du suivant
          // (une équipe de ce ladder), mais le capitaine mérite mieux que « il a déjà
          // une équipe » alors qu'il s'agit de la sienne. Couvre aussi l'auto-invitation.
          const [alreadyHere] = await tx
            .select({ id: teamMembersTable.id })
            .from(teamMembersTable)
            .where(
              and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, target.id)),
            );
          if (alreadyHere)
            return {
              ok: false as const,
              status: 409,
              error: 'this player is already in the team',
              code: 'already_member',
            };

          // Une seule équipe par ladder : l'information est connue MAINTENANT, on refuse
          // au clic plutôt que de laisser le joueur découvrir l'impasse à l'acceptation.
          const [otherTeam] = await tx
            .select({ id: teamMembersTable.id })
            .from(teamMembersTable)
            .where(
              and(
                eq(teamMembersTable.userId, target.id),
                eq(teamMembersTable.ladderId, current.ladderId),
              ),
            );
          if (otherTeam)
            return {
              ok: false as const,
              status: 409,
              error: 'this player already has a team on this ladder',
              code: 'already_in_team_on_ladder',
            };

          const [existing] = await tx
            .select({ id: teamInvitationsTable.id })
            .from(teamInvitationsTable)
            .where(
              and(
                eq(teamInvitationsTable.teamId, teamId),
                eq(teamInvitationsTable.userId, target.id),
                eq(teamInvitationsTable.status, 'pending'),
              ),
            );
          if (existing)
            return {
              ok: false as const,
              status: 409,
              error: 'this player already has a pending invitation',
              code: 'already_invited',
            };

          // Plafond « membres + invitations en attente ≤ 10 », vérifié À L'INVITATION :
          // si l'invariant tient ici, aucune acceptation ne peut faire dépasser 10.
          const used = await countRosterSlots(tx, teamId);
          if (used >= MAX_ROSTER)
            return {
              ok: false as const,
              status: 409,
              error: 'team is full (members and pending invitations)',
              code: 'roster_full',
            };

          const [invitation] = await tx
            .insert(teamInvitationsTable)
            .values({
              teamId,
              userId: target.id,
              ladderId: current.ladderId,
              invitedBy: me,
            })
            .returning();
          if (!invitation) throw new Error('invitation insert returned no row');

          // B9 — notif DANS la transaction (atomique avec l'invitation), push APRÈS le
          // commit. Destinataire : le joueur sollicité, jamais le capitaine qui agit.
          const notifs = await notify(tx, [target.id], 'team_invitation_received', {
            invitationId: invitation.id,
            teamId,
            teamName: current.name,
            ladderId: current.ladderId,
            byUserId: actor.id,
            byPseudo: actor.pseudo,
          });
          return { ok: true as const, invitation, notifs };
        });

        if (!outcome.ok)
          return reply.code(outcome.status).send({ error: outcome.error, code: outcome.code });
        pushNotifications(outcome.notifs);
        return reply.code(201).send({ invitation: shapeInvitation(outcome.invitation, target) });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        // Filet de sécurité : l'index unique PARTIEL fait foi même si le verrou était
        // contourné un jour (deux backends, un `psql` manuel…).
        const constraint = uniqueViolationConstraint(error);
        if (constraint === 'team_invitations_team_user_pending_unique')
          return reply.code(409).send({
            error: 'this player already has a pending invitation',
            code: 'already_invited',
          });
        if (constraint) return reply.code(409).send({ error: 'conflict', code: 'conflict' });
        // Équipe dissoute entre le verrou et l'insert : la FK échoue (23503). Rien n'a
        // planté, la cible a disparu → 404, pas 500.
        if (foreignKeyViolation(error))
          return reply.code(404).send({ error: 'team not found', code: 'team_not_found' });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  // DELETE /teams/:id/invitations/:invitationId — le capitaine ANNULE une invitation
  // encore en attente. ⚠️ Distinct du kick (`DELETE /teams/:id/members/:userId`), qui vire
  // un membre DÉJÀ dans l'équipe : ici le joueur n'a jamais rejoint quoi que ce soit.
  // Pas de notification : le capitaine est l'acteur, et prévenir l'invité d'une sollicitation
  // retirée n'apporte rien (règle produit de la carte).
  server.delete<{ Params: { id: string; invitationId: string } }>(
    '/:id/invitations/:invitationId',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        const { id: teamId, invitationId } = invitationParamsSchema.parse(request.params);

        const [team] = await db
          .select({ captainId: teamsTable.captainId })
          .from(teamsTable)
          .where(eq(teamsTable.id, teamId));
        if (!team) return reply.code(404).send({ error: 'team not found', code: 'team_not_found' });
        if (team.captainId !== me)
          return reply
            .code(403)
            .send({ error: 'only the captain can cancel an invitation', code: 'not_captain' });

        // UPDATE CONDITIONNEL : seule une invitation encore `pending` bascule. Deux
        // annulations concurrentes visent LA MÊME ligne → Postgres les sérialise, la
        // seconde ne touche rien et sort en 404. Aucun verrou nécessaire ici : la garde
        // porte sur une ligne unique, pas sur un agrégat (contrairement au plafond).
        const [cancelled] = await db
          .update(teamInvitationsTable)
          .set({ status: 'cancelled', respondedAt: new Date() })
          .where(
            and(
              eq(teamInvitationsTable.id, invitationId),
              eq(teamInvitationsTable.teamId, teamId),
              eq(teamInvitationsTable.status, 'pending'),
            ),
          )
          .returning({ id: teamInvitationsTable.id });
        if (!cancelled)
          return reply
            .code(404)
            .send({ error: 'pending invitation not found', code: 'invitation_not_found' });
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  // GET /teams/invitations/me — MES invitations en attente (celles que J'AI reçues).
  // ⚠️ Segment statique : find-my-way le fait passer AVANT `/teams/:id`, aucun conflit.
  server.get('/invitations/me', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const me = request.user.sub;
      const rows = await db
        .select({
          id: teamInvitationsTable.id,
          status: teamInvitationsTable.status,
          createdAt: teamInvitationsTable.createdAt,
          teamId: teamsTable.id,
          teamName: teamsTable.name,
          teamLogoUrl: teamsTable.logoUrl,
          ladderId: laddersTable.id,
          ladderName: laddersTable.name,
          format: laddersTable.format,
          gameId: laddersTable.gameId,
          // Projection explicite sur `users` (l'inviteur), jamais de select() nu.
          byUserId: usersTable.id,
          byPseudo: usersTable.pseudo,
          byDisplayName: usersTable.displayName,
          byAvatarUrl: usersTable.avatarUrl,
        })
        .from(teamInvitationsTable)
        .innerJoin(teamsTable, eq(teamsTable.id, teamInvitationsTable.teamId))
        .innerJoin(laddersTable, eq(laddersTable.id, teamInvitationsTable.ladderId))
        .innerJoin(usersTable, eq(usersTable.id, teamInvitationsTable.invitedBy))
        .where(and(eq(teamInvitationsTable.userId, me), eq(teamInvitationsTable.status, 'pending')))
        // Sans tri explicite Postgres est libre de réordonner entre deux chargements.
        .orderBy(desc(teamInvitationsTable.createdAt));

      const invitations = rows.map((row) => ({
        id: row.id,
        status: row.status,
        createdAt: row.createdAt,
        team: {
          id: row.teamId,
          name: row.teamName,
          logoUrl: row.teamLogoUrl,
          ladderId: row.ladderId,
          ladderName: row.ladderName,
          format: row.format,
          gameId: row.gameId,
        },
        invitedBy: {
          id: row.byUserId,
          pseudo: row.byPseudo,
          displayName: row.byDisplayName,
          avatarUrl: row.byAvatarUrl,
        },
      }));
      return reply.code(200).send({ invitations });
    } catch (error) {
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // POST /teams/invitations/:invitationId/accept — le joueur invité ACCEPTE.
  // C'est ici que naît l'appartenance ; et c'est la seule route de ce ticket qui touche
  // à `team_members`.
  server.post<{ Params: { invitationId: string } }>(
    '/invitations/:invitationId/accept',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        const { invitationId } = invitationIdParamSchema.parse(request.params);

        const [actor] = await db
          .select({ id: usersTable.id, pseudo: usersTable.pseudo })
          .from(usersTable)
          .where(eq(usersTable.id, me));
        if (!actor) return reply.code(500).send({ error: 'Internal error' });

        const outcome = await db.transaction(async (tx) => {
          // 1er passage : on ne cherche que le `teamId` (immuable) pour savoir QUOI
          // verrouiller — plus la garde d'appartenance, qui ne dépend pas du roster.
          const [invitation] = await tx
            .select()
            .from(teamInvitationsTable)
            .where(eq(teamInvitationsTable.id, invitationId));
          if (!invitation)
            return {
              ok: false as const,
              status: 404,
              error: 'invitation not found',
              code: 'invitation_not_found',
            };
          if (invitation.userId !== me)
            return {
              ok: false as const,
              status: 403,
              error: 'this invitation is not yours',
              code: 'not_your_invitation',
            };

          // Les deux verrous, tries : celui de l'equipe pour le plafond de 10, celui du
          // joueur sur le ladder pour l'insertion et pour l'annulation en cascade juste en
          // dessous, qui touche des lignes d'autres equipes. Voir lockRoster.
          // Les deux valeurs viennent de l'invitation lue au dessus et ne changent pas, donc
          // verrouiller avant la relecture ne pose pas de probleme.
          await lockRoster(tx, [
            teamKey(invitation.teamId),
            playerLadderKey(me, invitation.ladderId),
          ]);

          const [team] = await tx
            .select()
            .from(teamsTable)
            .where(eq(teamsTable.id, invitation.teamId));
          // L'équipe a été dissoute : la cascade a en principe déjà emporté l'invitation.
          if (!team)
            return {
              ok: false as const,
              status: 404,
              error: 'team not found',
              code: 'team_not_found',
            };

          const [members] = await tx
            .select({ total: count() })
            .from(teamMembersTable)
            .where(eq(teamMembersTable.teamId, invitation.teamId));
          if (!members) throw new Error('member count returned no row');
          if (members.total >= MAX_ROSTER)
            return { ok: false as const, status: 409, error: 'team is full', code: 'roster_full' };

          // UPDATE CONDITIONNEL : deux accepts concurrents de LA MÊME invitation visent la
          // même ligne, Postgres les sérialise et le second ne touche rien → 409. C'est
          // aussi ce qui rejette une invitation annulée ou déjà refusée entre-temps.
          const [accepted] = await tx
            .update(teamInvitationsTable)
            .set({ status: 'accepted', respondedAt: new Date() })
            .where(
              and(
                eq(teamInvitationsTable.id, invitationId),
                eq(teamInvitationsTable.status, 'pending'),
              ),
            )
            .returning({ id: teamInvitationsTable.id });
          if (!accepted)
            return {
              ok: false as const,
              status: 409,
              error: 'invitation is no longer pending',
              code: 'not_pending',
            };

          // L'appartenance. Une violation 23505 ici (le joueur a rejoint une AUTRE équipe
          // du ladder entre-temps) fait remonter l'erreur : la transaction ROLLBACK, donc
          // l'invitation reste `pending` et rien n'est notifié. Traduite en 409 par le catch.
          await tx.insert(teamMembersTable).values({
            teamId: invitation.teamId,
            userId: me,
            ladderId: invitation.ladderId,
          });

          // Les autres sollicitations du joueur sur CE ladder deviennent caduques : il a
          // désormais une équipe, elles ne pourraient plus aboutir. `cancelled` et non
          // `declined` — le joueur n'a rien refusé, c'est le système qui les retire.
          await tx
            .update(teamInvitationsTable)
            .set({ status: 'cancelled', respondedAt: new Date() })
            .where(
              and(
                eq(teamInvitationsTable.userId, me),
                eq(teamInvitationsTable.ladderId, invitation.ladderId),
                eq(teamInvitationsTable.status, 'pending'),
                ne(teamInvitationsTable.id, invitationId),
              ),
            );

          // Destinataire : le capitaine (le camp concerné), jamais l'acteur. Le filtre
          // couvre le cas théorique où l'acceptant serait lui-même capitaine de l'équipe.
          const notifs = await notify(
            tx,
            [team.captainId].filter((id) => id !== me),
            'team_invitation_accepted',
            {
              invitationId,
              teamId: team.id,
              teamName: team.name,
              ladderId: team.ladderId,
              byUserId: actor.id,
              byPseudo: actor.pseudo,
            },
          );
          return { ok: true as const, teamId: team.id, notifs };
        });

        if (!outcome.ok)
          return reply.code(outcome.status).send({ error: outcome.error, code: outcome.code });
        pushNotifications(outcome.notifs);
        return reply.code(200).send({ ok: true, teamId: outcome.teamId });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        const constraint = uniqueViolationConstraint(error);
        if (constraint === 'team_members_user_ladder_unique')
          return reply
            .code(409)
            .send({ error: 'you already have a team on this ladder', code: 'already_in_team' });
        if (constraint === 'team_members_team_user_unique')
          return reply
            .code(409)
            .send({ error: 'you are already in this team', code: 'already_member' });
        if (constraint) return reply.code(409).send({ error: 'conflict', code: 'conflict' });
        // Équipe dissoute entre le verrou et l'insert : FK en échec (23503) → 404.
        if (foreignKeyViolation(error))
          return reply.code(404).send({ error: 'team not found', code: 'team_not_found' });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  // POST /teams/invitations/:invitationId/decline — le joueur invité REFUSE.
  // Aucune écriture sur `team_members`, aucun verrou : la garde porte sur une seule ligne,
  // l'UPDATE conditionnel suffit à sérialiser les réponses concurrentes.
  server.post<{ Params: { invitationId: string } }>(
    '/invitations/:invitationId/decline',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        const { invitationId } = invitationIdParamSchema.parse(request.params);

        const [actor] = await db
          .select({ id: usersTable.id, pseudo: usersTable.pseudo })
          .from(usersTable)
          .where(eq(usersTable.id, me));
        if (!actor) return reply.code(500).send({ error: 'Internal error' });

        const outcome = await db.transaction(async (tx) => {
          const [invitation] = await tx
            .select()
            .from(teamInvitationsTable)
            .where(eq(teamInvitationsTable.id, invitationId));
          if (!invitation)
            return {
              ok: false as const,
              status: 404,
              error: 'invitation not found',
              code: 'invitation_not_found',
            };
          if (invitation.userId !== me)
            return {
              ok: false as const,
              status: 403,
              error: 'this invitation is not yours',
              code: 'not_your_invitation',
            };

          const [declined] = await tx
            .update(teamInvitationsTable)
            .set({ status: 'declined', respondedAt: new Date() })
            .where(
              and(
                eq(teamInvitationsTable.id, invitationId),
                eq(teamInvitationsTable.status, 'pending'),
              ),
            )
            .returning({ id: teamInvitationsTable.id });
          if (!declined)
            return {
              ok: false as const,
              status: 409,
              error: 'invitation is no longer pending',
              code: 'not_pending',
            };

          // L'équipe a pu être dissoute : la cascade aurait alors emporté l'invitation et
          // on serait sorti en 404 plus haut. Le garde reste pour ne jamais notifier dans
          // le vide.
          const [team] = await tx
            .select()
            .from(teamsTable)
            .where(eq(teamsTable.id, invitation.teamId));
          if (!team) return { ok: true as const, notifs: [] };

          const notifs = await notify(
            tx,
            [team.captainId].filter((id) => id !== me),
            'team_invitation_declined',
            {
              invitationId,
              teamId: team.id,
              teamName: team.name,
              ladderId: team.ladderId,
              byUserId: actor.id,
              byPseudo: actor.pseudo,
            },
          );
          return { ok: true as const, notifs };
        });

        if (!outcome.ok)
          return reply.code(outcome.status).send({ error: outcome.error, code: outcome.code });
        pushNotifications(outcome.notifs);
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
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
        // On ne notifie `team_member_removed` QUE sur le kick : si le joueur part de
        // lui-même il est l'acteur, et la règle B9 est « jamais l'acteur ».
        const isKick = me !== targetId;

        // Deux pseudos, deux rôles, et sur un kick ce n'est PAS la même personne :
        // l'ACTEUR signe l'exclusion (`team_member_removed`), la CIBLE nomme la cause de
        // l'annulation de créneau (`match_cancelled_member_left`). Lus en une requête,
        // projection explicite — jamais de `select()` nu sur `users` (invariant #6).
        const people = await db
          .select({ id: usersTable.id, pseudo: usersTable.pseudo })
          .from(usersTable)
          .where(inArray(usersTable.id, [...new Set([me, targetId])]));
        const actor = people.find((u) => u.id === me);
        const target = people.find((u) => u.id === targetId);
        if (!actor) return reply.code(500).send({ error: 'Internal error' });
        // Cible inexistante : aucune ligne `team_members` ne peut la référencer (FK), donc
        // il n'y a rien à retirer. On rend le 200 idempotent de la route, pas un 404 —
        // c'est le contrat historique et le front s'en sert.
        if (!target) return reply.code(200).send({ ok: true });

        const outcome = await db.transaction(async (tx) => {
          // Verrou obligatoire depuis que cette route ne se contente plus de retirer une
          // ligne : elle annule aussi les creneaux ou le partant etait aligne, et elle decide
          // d'apres une lecture. Sans verrou, une creation de creneau qui tourne en meme temps
          // voit le joueur encore membre pendant qu'on ne voit pas encore son creneau : les
          // deux passent, et on se retrouve avec un creneau tout neuf qui aligne un non-membre.
          //
          // Le verrou seul ne suffit pas : serialiser deux transactions ne rafraichit pas une
          // lecture faite avant elles, et la creation de creneau lit le roster hors
          // transaction. Il faut aussi la re-verification cote matches.ts, sous ce meme verrou.
          // Retirer l'un des deux rouvre le trou.
          //
          // Une seule cle, celle de l'equipe, parce que c'est la portee de ce qu'on protege :
          // aucun non-membre aligne dans un creneau de cette equipe. Elle est identique a
          // celle de matches.ts, donc on est serialise avec la creation et l'acceptation.
          // On la prend avant toute ecriture, et n'en prendre qu'une garantit qu'on ne peut
          // pas participer a un interblocage.
          await lockRoster(tx, [teamKey(teamId)]);

          // Adhésion relue SOUS le verrou : c'est CETTE lecture qui fait autorité.
          const [membership] = await tx
            .select({ id: teamMembersTable.id })
            .from(teamMembersTable)
            .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetId)));
          // On rend 200 avant de verifier quoi que ce soit : retirer quelqu'un qui n'est
          // deja plus la doit reussir. Un 409 demanderait au capitaine d'annuler un match
          // pour virer une personne qui n'est plus dans l'equipe.
          if (!membership) return { ok: true as const, notifs: [] };

          // Un match actif bloque le depart, et on n'ecrit rien.
          // Attention, la liste de statuts est plus etroite qu'a la suppression de compte :
          // la, un creneau en attente empeche de partir, ici il ne bloque pas, on l'annule
          // juste apres. C'est voulu, ne pas uniformiser les deux listes.
          // On ne regarde que les matchs de cette equipe : un match en cours avec une autre
          // equipe ne concerne pas ce roster et le refus serait incomprehensible.
          const [locking] = await tx
            .select({ matchId: matchesTable.id })
            .from(matchParticipantsTable)
            .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
            .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
            .where(
              and(
                eq(matchParticipantsTable.userId, targetId),
                eq(matchSidesTable.teamId, teamId),
                inArray(matchesTable.status, LOCKING_STATUSES),
              ),
            )
            .limit(1);
          if (locking)
            return {
              ok: false as const,
              status: 409,
              error: 'this player is aligned in an ongoing match — finish or cancel it first',
              code: 'engaged_in_match' as const,
            };

          // ── ② CRÉNEAUX `pending` → on laisse partir, mais on annule ─────────────────
          // Décision produit de la carte : refuser ici fabriquerait un cul-de-sac, seul le
          // capitaine peut annuler un créneau — un simple membre n'aurait AUCUNE action
          // possible pour se débloquer. Un créneau dont la composition n'est plus valide
          // ne doit pas rester acceptable : il tombe.
          const slots = await tx
            .select({
              matchId: matchesTable.id,
              ladderId: matchesTable.ladderId,
              scheduledAt: matchesTable.scheduledAt,
              sideId: matchSidesTable.id,
            })
            .from(matchParticipantsTable)
            .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
            .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
            .where(
              and(
                eq(matchParticipantsTable.userId, targetId),
                eq(matchSidesTable.teamId, teamId),
                eq(matchesTable.status, 'pending'),
              ),
            );

          // ⚠️ `.returning()` MALGRÉ la lecture d'adhésion sous verrou, et ce n'est pas une
          // ceinture inutile : `DELETE /users/me` supprime la ligne `team_members` PAR
          // CASCADE, sans transaction ni verrou — elle peut donc passer entre notre SELECT
          // et ce DELETE. Sans ce garde, on notifierait un compte qui n'existe plus et la
          // FK de `notifications` remonterait un 23503 (500 opaque pour le capitaine).
          const deleted = await tx
            .delete(teamMembersTable)
            .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetId)))
            .returning({ id: teamMembersTable.id });
          if (deleted.length === 0) return { ok: true as const, notifs: [] };

          const created: CreatedNotification[] = [];
          for (const slot of slots) {
            // Destinataires lus AVANT le nettoyage : on veut la composition telle qu'elle
            // était, et exclure le partant EXPLICITEMENT plutôt que par effet de bord.
            const lineup = await getMatchParticipantIds(tx, slot.matchId);
            await tx
              .delete(matchParticipantsTable)
              .where(
                and(
                  eq(matchParticipantsTable.matchSideId, slot.sideId),
                  eq(matchParticipantsTable.userId, targetId),
                ),
              );
            // UPDATE CONDITIONNEL : si un tiers a annulé ou fait expirer ce créneau entre
            // la lecture et ici, aucune ligne ne bouge et on ne notifie pas une annulation
            // qu'on n'a pas faite.
            const [cancelled] = await tx
              .update(matchesTable)
              .set({ status: 'cancelled' })
              .where(and(eq(matchesTable.id, slot.matchId), eq(matchesTable.status, 'pending')))
              .returning({ id: matchesTable.id });
            if (!cancelled) continue;
            // Invariant #2 : le camp concerné, JAMAIS l'acteur. Le partant non plus — il
            // sait qu'il part. Le capitaine est ajouté car il peut être hors composition
            // et c'est le seul à pouvoir rouvrir un créneau. `notify()` dédoublonne quand
            // il est aussi dans la lineup.
            const recipients = [...lineup, team.captainId].filter(
              (userId) => userId !== targetId && userId !== me,
            );
            created.push(
              ...(await notify(tx, recipients, 'match_cancelled_member_left', {
                matchId: slot.matchId,
                ladderId: slot.ladderId,
                // Colonne nullable en base (seul Zod l'impose à la création) : on rend
                // l'absence visible plutôt que de faire échouer une annulation légitime
                // sur un champ d'affichage.
                scheduledAt: slot.scheduledAt ? slot.scheduledAt.toISOString() : null,
                teamId,
                teamName: team.name,
                playerId: target.id,
                playerPseudo: target.pseudo,
              })),
            );
          }

          if (isKick)
            created.push(
              ...(await notify(tx, [targetId], 'team_member_removed', {
                teamId,
                teamName: team.name,
                ladderId: team.ladderId,
                byUserId: actor.id,
                byPseudo: actor.pseudo,
              })),
            );
          return { ok: true as const, notifs: created };
        });

        if (!outcome.ok)
          return reply.code(outcome.status).send({ error: outcome.error, code: outcome.code });
        pushNotifications(outcome.notifs);
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
          // Le meme verrou que les routes d'invitation, et avant le FOR UPDATE.
          // La dissolution ecrit team_invitations sans que ca se voie : c'est la cascade du
          // DELETE. Elle rentre donc dans le regime de lockRoster comme les autres.
          // Sans ce verrou on boucle : l'acceptation tient la ligne d'invitation et attend la
          // ligne de l'equipe, la dissolution tient la ligne de l'equipe et attend celle de
          // l'invitation. Resultat, le capitaine se prenait un 500 en dissolvant son equipe.
          // Une seule cle suffit, la cascade ne depasse pas l'equipe.
          await lockRoster(tx, [teamKey(teamId)]);
          // FOR UPDATE met les dissolutions simultanees a la queue leu leu : la seconde
          // attend, ne retrouve plus la ligne et sort en 404 sans notifier personne.
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

          // On ne dissout pas une equipe qui a un match en cours. La colonne team_id du camp
          // passe a null quand l'equipe disparait : le creneau orphelin sort des listes mais
          // reste acceptable par son id, donc quelqu'un pouvait jouer contre une equipe
          // fantome et faire bouger l'Elo d'une vraie equipe en face.
          // Le controle est dans la transaction et apres le verrou, sinon une creation de
          // match se glisse entre la verification et la suppression.
          const [engaged] = await tx
            .select({ matchId: matchesTable.id })
            .from(matchSidesTable)
            .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
            .where(
              and(
                eq(matchSidesTable.teamId, teamId),
                inArray(matchesTable.status, ENGAGING_STATUSES),
              ),
            )
            .limit(1);
          if (engaged)
            return {
              ok: false as const,
              status: 409,
              error: 'cancel or finish the team matches before dissolving it',
              code: 'team_engaged_in_match' as const,
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

        // `code` n'est présent que sur les refus qui en portent un (409) : le front mappe
        // dessus, il ne parse jamais la prose. Les 403/404 gardent leur forme historique.
        if (!outcome.ok)
          return reply
            .code(outcome.status)
            .send({ error: outcome.error, ...('code' in outcome ? { code: outcome.code } : {}) });
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
