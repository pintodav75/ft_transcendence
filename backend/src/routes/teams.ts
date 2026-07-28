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
import { notify, pushNotifications } from '../utils/notifications.js';
import { isBlocked } from '../utils/blocks.js';
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
/**
 * Clé de verrou d'un JOUEUR SUR UN LADDER. Même convention que le côté solo de
 * `competitorKey()` : c'est la portée réelle de « une seule équipe par ladder ».
 */
const playerLadderKey = (userId: string, ladderId: string) => `user:${userId}:${ladderId}`;

/**
 * Sérialise ce qui touche au roster, sur des clés données, dans un ORDRE DÉTERMINISTE.
 * Copie assumée de `lockCompetitors()` (`routes/matches.ts:223`) — même problème, même remède.
 *
 * DEUX raisons de verrouiller, et elles n'ont pas la même portée :
 *
 * 1. **`team:<id>`** — le plafond des 10 est un AGRÉGAT (compter des lignes), pas une garde
 *    de ligne : aucun `UPDATE … WHERE` ne le rend atomique, deux transactions qui lisent
 *    « 9 » passent ensemble (piège #14).
 * 2. **`user:<id>:<ladder>`** — l'acceptation écrit DEUX ressources dont la portée est
 *    (joueur, ladder) et **pas** l'équipe : l'index unique `team_members_user_ladder_unique`,
 *    et l'UPDATE d'annulation en cascade, filtré sur `user_id + ladder_id`, qui touche des
 *    lignes appartenant à d'AUTRES équipes.
 *
 * ⚠️ **Le verrou d'équipe seul ne suffit PAS, et le croire coûte un 500.** Deux acceptations
 * du MÊME joueur sur DEUX équipes du même ladder prennent des clés `team:` disjointes : elles
 * ne se voient pas, puis se croisent sur les verrous de ligne ci-dessus. T1 tient l'invitation
 * de T2 et veut l'index, T2 tient l'index et veut l'invitation → **interblocage**, Postgres
 * tue une transaction, et le conflit métier (`409 already_in_team`) sort en **500**. Reproduit
 * 8 fois sur 8 (`test_teams_invitations.py`, section « course INTER-ÉQUIPES »), et c'est un
 * scénario NORMAL : deux boutons « Accepter » côte à côte dans la cloche de notifications.
 *
 * ⚠️ Le tri n'est pas cosmétique : c'est LUI qui interdit le cycle (piège #15). Toute route
 * qui écrit ces ressources doit passer par ici, avec le jeu de clés complet.
 *
 * 📋 **INVENTAIRE DES ÉCRIVAINS — à tenir à jour** (tous dans CE fichier ; `matches.ts` et
 * `disputes.ts` ne font que LIRE `team_members`). ⚠️ Une route peut écrire **sans que ça se
 * voie dans son code** : la dissolution n'écrit `team_invitations` que par `ON DELETE
 * CASCADE`, et c'est précisément celle qui avait été oubliée (500 pour le capitaine).
 *
 * | Route                                   | Écrit                          | Verrous          |
 * |-----------------------------------------|--------------------------------|------------------|
 * | `POST /teams/:id/invitations`           | `team_invitations`             | team + user✱     |
 * | `POST /teams/invitations/:id/accept`    | les deux (+ cascade métier)    | team + user      |
 * | `DELETE /teams/:id`                     | **4 tables par cascade DB**    | team            |
 * | `POST /teams` (création)                | `team_members` + cascade métier | user            |
 * | `DELETE /teams/:id/invitations/:invId`  | 1 ligne `team_invitations`     | aucun — voir ci-dessous |
 * | `POST /teams/invitations/:id/decline`   | 1 ligne `team_invitations`     | aucun — voir ci-dessous |
 * | `DELETE /teams/:id/members/:userId`     | 1 ligne `team_members`         | aucun — voir ci-dessous |
 *
 * ✱ la clé `user:` de l'invitation porte sur le JOUEUR INVITÉ (pas sur le capitaine).
 *
 * ⚠️ **Les 4 cascades de `DELETE /teams/:id`, en toutes lettres** — un inventaire qui n'énumère
 * pas ne sert à rien (relevé en base, `pg_constraint` sur `confrelid = 'teams'`) :
 *   `team_members` CASCADE · `team_invitations` CASCADE · `rankings` CASCADE ·
 *   `match_sides` **SET NULL**.
 * Seules les deux premières entrent dans le périmètre de `lockRoster`. Les deux autres ont été
 * sondées (dissolution × acceptation de match) : **aucun cycle supplémentaire** — les échecs
 * qu'on y observe sont des `23503` (FK), pas des `40P01` (interblocage), et relèvent d'un autre
 * ticket (`matches.ts` n'a pas d'équivalent de `foreignKeyViolation()` et rend 500 au lieu de
 * 404/409). ⚠️ Ne pas retirer cette énumération : c'est l'omission d'une cascade qui a coûté
 * la livraison précédente.
 *
 * **Pourquoi les quatre dernières n'ont pas besoin de verrou** — et ce n'est pas un oubli :
 * elles n'écrivent **qu'une seule ligne, adressée par son id** (ou une ligne neuve dont
 * personne d'autre ne connaît la clé), et ne prennent **aucun second verrou ensuite**. Une
 * transaction qui ne détient qu'une ressource ne peut pas fermer un cycle : elle fait
 * attendre, elle n'attend pas en retour. Leurs invariants sont portés par la base — `UPDATE …
 * WHERE status='pending'` (sérialise sur LA ligne), `team_members_user_ladder_unique`,
 * `team_invitations_team_user_pending_unique` — et pas par un comptage, donc pas d'agrégat à
 * protéger. ⚠️ Le jour où l'une d'elles gagne une 2e écriture (ou une cascade), elle rejoint
 * le tableau du haut : c'est exactement l'erreur commise sur la dissolution.
 */
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

/**
 * Vue « côté équipe » d'une invitation : QUI a été sollicité. Servie par
 * `POST /teams/:id/invitations` et par le bloc `invitations` de `GET /teams/:id` — les deux
 * doivent avoir exactement la même forme, sinon le front doit gérer deux objets pour la
 * même chose.
 */
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

/**
 * Violation de clé étrangère Postgres (SQLSTATE 23503) — Drizzle emballe l'erreur du driver
 * dans `error.cause`. Cas typique : l'équipe a été dissoute entre la lecture et l'insertion.
 * Rien n'a planté, la cible a disparu → 404, jamais 500.
 */
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
    logoUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
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
  // ═════════════════════════════════════════════════════════════════════════════════
  // B-INV — INVITATIONS
  //
  // `POST /teams/:id/members` (ajout FORCÉ) a été SUPPRIMÉE. Motif : la contrainte
  // `team_members_user_ladder_unique` n'autorise qu'UNE équipe par ladder — un ajout sans
  // accord ne « rendait pas service » au joueur, il le VERROUILLAIT sur tout le ladder.
  // Le capitaine sollicite désormais, le joueur accepte ou refuse.
  //
  // ⚠️ L'invitation vit dans sa PROPRE table, jamais en colonne de statut sur
  // `team_members` : cette table est lue à ~40 endroits (matches, disputes, teams) et chacun
  // signifie « X est membre de Y ». Un statut y rendrait ces 40 lectures fausses par défaut.
  // ═════════════════════════════════════════════════════════════════════════════════

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

          // 🔒 DEUX verrous, TRIÉS (piège #15) — le verrou d'équipe seul ne suffit pas :
          //   * `team:<id>`  → le plafond des 10, qui est un agrégat (piège #14) ;
          //   * `user:<id>:<ladder>` → l'insertion dans `team_members` (index unique
          //     `user_ladder`) ET l'annulation en cascade ci-dessous, qui écrit des lignes
          //     d'AUTRES équipes. Sans cette 2e clé, deux acceptations du même joueur sur
          //     deux équipes du même ladder s'interbloquent → 500 au lieu de 409 (reproduit
          //     8/8, cf. le commentaire de `lockRoster`).
          // Les deux valeurs viennent de l'invitation, lue juste au-dessus, et sont
          // immuables : verrouiller AVANT la relecture autoritative est donc sûr.
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
          // 🔒 B-INV — LE MÊME VERROU QUE LES ROUTES D'INVITATION, ET AVANT LE `FOR UPDATE`.
          // Depuis B-INV, la dissolution écrit `team_invitations` : pas explicitement, mais
          // **par CASCADE**. Elle est donc, elle aussi, une route qui écrit les ressources
          // protégées par `lockRoster` — et la règle posée là-bas vaut pour elle.
          // Sans ce verrou, le cycle est complet :
          //   * `accept` tient la ligne `team_invitations` (UPDATE → `accepted`) puis
          //     demande le `FOR KEY SHARE` sur `teams` que réclame la FK de son INSERT
          //     dans `team_members` ;
          //   * la dissolution tient le `FOR UPDATE` sur `teams` puis demande cette même
          //     ligne d'invitation (cascade du DELETE).
          // → interblocage, et c'est le CAPITAINE qui prenait un 500 sur une dissolution
          // parfaitement légitime. Reproduit par l'API publique (cf. la section « course
          // DISSOLUTION × ACCEPTATION » de test_teams_invitations.py).
          // ⚠️ Une clé suffit ici : la portée de la cascade est l'ÉQUIPE. Les clés
          // (joueur, ladder) de l'acceptation seraient non bornées (un roster entier), et
          // sont inutiles — une acceptation concurrente tient déjà `team:<id>` du début à
          // la fin de sa transaction, donc elle sérialise cette dissolution.
          await lockRoster(tx, [teamKey(teamId)]);
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
