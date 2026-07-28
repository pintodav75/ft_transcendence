import {
  pgTable,
  varchar,
  uuid,
  timestamp,
  text,
  unique,
  boolean,
  pgEnum,
  index,
  smallint,
  check,
  integer,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const friendshipStatusEnum = pgEnum('friendship_status', ['pending', 'accepted']);
export const providerEnum = pgEnum('provider_enum', ['riot', 'steam', 'epic', 'chess_com']);
export const formatEnum = pgEnum('format_enum', ['1v1', '2v2', '3v3', '5v5']);
export const matchStatusEnum = pgEnum('match_status_enum', [
  'pending',
  'in_progress',
  'awaiting_confirmation',
  'completed',
  'disputed',
  'cancelled',
]);
export const disputeStatusEnum = pgEnum('dispute_status_enum', ['open', 'resolved']);
export const disputeResolutionEnum = pgEnum('dispute_resolution_enum', [
  'side_0_wins',
  'side_1_wins',
  'cancelled',
]);

// ⚠️ INDEX EXISTANTS HORS SCHÉMA (posés en migration custom, invisibles ici) :
//   - 0015 `users_pseudo_lower_unique`      : unique sur lower(pseudo), unicité insensible à la casse
//   - 0018 `users_pseudo_lower_prefix_idx`  : lower(pseudo) text_pattern_ops, recherche préfixe GET /search
//   - 0018 `teams_name_lower_prefix_idx`    : idem sur teams.name
// Drizzle ne sait pas exprimer proprement une classe d'opérateurs sur une expression :
// ils ne sont donc PAS dans les snapshots. `generate` les ignore (il ne diffe que
// schema.ts contre le snapshot), mais un `drizzle-kit push` — qui aligne la BASE sur
// le schéma — les SUPPRIMERAIT sans prévenir. On n'utilise que `generate` + `migrate`.
export const usersTable = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    pseudo: varchar().notNull().unique(),
    email: varchar().notNull().unique(),
    passwordHash: text('password_hash'),
    displayName: varchar('display_name', { length: 50 }),
    bio: text(),
    avatarUrl: text('avatar_url'),
    oauthProvider: text('oauth_provider'),
    oauthId: text('oauth_id'),
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    isAdmin: boolean('is_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('users_oauth_identity_unique').on(table.oauthProvider, table.oauthId)],
);

export const friendshipsTable = pgTable(
  'friendships',
  {
    id: uuid().primaryKey().defaultRandom(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    status: friendshipStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('friendships_pair_unique').on(table.requesterId, table.addresseeId)],
);
export const messagesTable = pgTable('messages', {
  id: uuid().primaryKey().defaultRandom(),
  senderId: uuid('sender_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  receiverId: uuid('receiver_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  content: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const blocksTable = pgTable(
  'blocks',
  {
    id: uuid().primaryKey().defaultRandom(),
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('blocks_pair_unique').on(table.blockerId, table.blockedId)],
);

export const gamesTable = pgTable('games', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  requiredProvider: providerEnum('required_provider').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userExternalAccountsTable = pgTable(
  'user_external_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    provider: providerEnum('provider').notNull(),
    externalId: text('external_id').notNull(),
    verified: boolean('verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('user_external_accounts_user_provider_unique').on(table.userId, table.provider),
    index('user_external_accounts_provider_ext_idx').on(table.provider, table.externalId),
  ],
);

export const laddersTable = pgTable(
  'ladders',
  {
    id: uuid().primaryKey().defaultRandom(),
    gameId: text('game_id')
      .notNull()
      .references(() => gamesTable.id, { onDelete: 'restrict' }),
    format: formatEnum('format').notNull(),
    name: varchar('name', { length: 50 }).notNull(),
    lockoutMinutes: smallint('lockout_minutes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('ladders_game_format_unique').on(table.gameId, table.format)],
);

export const teamsTable = pgTable(
  'teams',
  {
    id: uuid().primaryKey().defaultRandom(),
    ladderId: uuid('ladder_id')
      .notNull()
      .references(() => laddersTable.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 50 }).notNull(),
    captainId: uuid('captain_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    logoUrl: text('logo_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('teams_ladder_name_unique').on(table.ladderId, table.name)],
);

export const teamMembersTable = pgTable(
  'team_members',
  {
    id: uuid().primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teamsTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    ladderId: uuid('ladder_id')
      .notNull()
      .references(() => laddersTable.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('team_members_team_user_unique').on(table.teamId, table.userId),
    unique('team_members_user_ladder_unique').on(table.userId, table.ladderId),
    index('team_members_user_idx').on(table.userId),
  ],
);

// ⚠️ `export` obligatoire (piège #8) : un enum non exporté n'est pas vu par drizzle-kit.
// `cancelled` couvre DEUX cas distincts et c'est volontaire : l'annulation par le capitaine
// ET l'annulation automatique quand le joueur accepte ailleurs sur le même ladder (B-INV).
// Sans elle, le capitaine lirait « refusée » là où le joueur n'a jamais rien refusé.
export const teamInvitationStatusEnum = pgEnum('team_invitation_status', [
  'pending',
  'accepted',
  'declined',
  'cancelled',
]);

// B-INV — l'invitation est une table DÉDIÉE, surtout pas une colonne de statut sur
// `team_members` : `team_members` est lu à ~40 endroits (matches, disputes, teams) et chacun
// signifie « X est membre de Y ». Un statut sur cette table rendrait ces 40 lectures fausses
// par défaut, et en oublier une ne se verrait pas (un joueur jamais accepté deviendrait
// alignable en match). Ici, rien de ce qui existe ne change de sens.
export const teamInvitationsTable = pgTable(
  'team_invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teamsTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    // Dénormalisé depuis la team : c'est la clé de la règle « une seule équipe par ladder ».
    // La porter ici évite un join à chaque annulation en cascade métier (acceptation).
    ladderId: uuid('ladder_id')
      .notNull()
      .references(() => laddersTable.id, { onDelete: 'cascade' }),
    status: teamInvitationStatusEnum('status').notNull().default('pending'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (table) => [
    // Index unique PARTIEL (même patron que `rankings_ladder_user_unique`) : une seule
    // invitation VIVANTE par (team, joueur), mais réinviter après un refus ou une annulation
    // reste possible — un unique nu interdirait la 2e invitation pour toujours.
    uniqueIndex('team_invitations_team_user_pending_unique')
      .on(table.teamId, table.userId)
      .where(sql`${table.status} = 'pending'`),
    // ⚠️ AUCUNE unicité par ladder ici : plusieurs équipes doivent pouvoir solliciter le même
    // joueur. Seule l'ACCEPTATION est exclusive, et elle bute alors sur la contrainte
    // `team_members_user_ladder_unique` qui existe déjà.
    index('team_invitations_user_status_idx').on(table.userId, table.status),
  ],
);

export const matchesTable = pgTable(
  'matches',
  {
    id: uuid().primaryKey().defaultRandom(),
    ladderId: uuid('ladder_id')
      .notNull()
      .references(() => laddersTable.id, { onDelete: 'restrict' }),
    status: matchStatusEnum('status').notNull().default('pending'),
    maps: text('maps').array().notNull().default([]),
    winnerSideId: uuid('winner_side_id').references((): any => matchSidesTable.id),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('matches_ladder_status_idx').on(table.ladderId, table.status),
    index('matches_ladder_completed_at_idx').on(table.ladderId, table.completedAt.desc()),
    index('matches_status_scheduled_at_idx').on(table.status, table.scheduledAt),
  ],
);

export const matchSidesTable = pgTable(
  'match_sides',
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .notNull()
      .references((): any => matchesTable.id, { onDelete: 'cascade' }),
    sideIndex: smallint('side_index').notNull(),
    teamId: uuid('team_id').references(() => teamsTable.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedWinnerSideId: uuid('submitted_winner_side_id').references(
      (): any => matchSidesTable.id,
    ),
    // Score Bo3 tel que soumis par CE camp, relatif au soumetteur (« moi / lui »),
    // délibérément pas indexé sur sideIndex : la comparaison croisée entre les
    // deux soumissions devient triviale et supprime toute confusion de camp.
    submittedScoreSelf: smallint('submitted_score_self'),
    submittedScoreOpponent: smallint('submitted_score_opponent'),
    // Score final (nombre de manches gagnées : 0, 1 ou 2), écrit à la clôture du match.
    score: smallint('score'),
    // Gain/perte d'Elo pour ce camp sur CE match précis : dépend de l'écart d'Elo au
    // moment du match, donc non recalculable a posteriori — doit être persisté ici.
    eloDelta: smallint('elo_delta'),
    // Elo de ce camp immédiatement après ce match.
    eloAfter: integer('elo_after'),
  },
  (table) => [
    unique('match_sides_match_side_unique').on(table.matchId, table.sideIndex),
    check('match_sides_side_index_check', sql`${table.sideIndex} IN (0, 1)`),
    index('match_sides_team_match_idx').on(table.teamId, table.matchId),
  ],
);

export const matchParticipantsTable = pgTable(
  'match_participants',
  {
    id: uuid().primaryKey().defaultRandom(),
    matchSideId: uuid('match_side_id')
      .notNull()
      .references(() => matchSidesTable.id, { onDelete: 'cascade' }),
    // ⚠️ CASCADE, pas RESTRICT (BX-DEL). En `restrict`, tout joueur ayant été aligné UNE
    // fois — même dans un match terminé il y a des mois — ne pouvait plus JAMAIS supprimer
    // son compte : la contrainte remontait en erreur Postgres 23503 et l'utilisateur
    // recevait un 500 opaque. Ce qui compte (score, vainqueur, delta d'Elo) vit sur
    // `matches` / `match_sides` : supprimer un compte ne fait perdre que « qui était aligné »
    // dans les vieilles compositions, jamais un résultat ni un classement.
    // 🔑 La règle produit — on ne peut pas partir en laissant un match EN COURS — n'est PAS
    // portée par cette contrainte mais par une garde explicite dans `DELETE /users/me`, qui
    // rend un 409 `engaged_in_match`. Une contrainte de FK ne sait pas lire un statut.
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique('match_participants_side_user_unique').on(table.matchSideId, table.userId),
    index('match_participants_user_idx').on(table.userId, table.matchSideId),
  ],
);

export const disputesTable = pgTable(
  'disputes',
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .notNull()
      .unique('disputes_match_unique')
      .references(() => matchesTable.id, { onDelete: 'cascade' }),
    status: disputeStatusEnum('status').notNull().default('open'),
    resolution: disputeResolutionEnum('resolution'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => usersTable.id, {
      onDelete: 'set null',
    }),
    resolutionNotes: text('resolution_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [index('disputes_status_created_at_idx').on(table.status, table.createdAt)],
);

export const disputeEvidenceTable = pgTable(
  'dispute_evidence',
  {
    id: uuid().primaryKey().defaultRandom(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputesTable.id, { onDelete: 'cascade' }),
    submittedByUserId: uuid('submitted_by_user_id').references(() => usersTable.id, {
      onDelete: 'set null',
    }),
    matchSideId: uuid('match_side_id')
      .notNull()
      .references(() => matchSidesTable.id, { onDelete: 'cascade' }),
    evidenceUrl: text('evidence_url').notNull(),
    description: text('description'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('dispute_evidence_dispute_side_idx').on(table.disputeId, table.matchSideId)],
);

export const rankingsTable = pgTable(
  'rankings',
  {
    id: uuid().primaryKey().defaultRandom(),
    ladderId: uuid('ladder_id')
      .notNull()
      .references(() => laddersTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => usersTable.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id').references(() => teamsTable.id, { onDelete: 'cascade' }),
    elo: integer('elo').notNull().default(1000),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    lastMatchAt: timestamp('last_match_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      'rankings_user_team_xor_check',
      sql`(${table.userId} IS NULL) <> (${table.teamId} IS NULL)`,
    ),
    uniqueIndex('rankings_ladder_user_unique')
      .on(table.ladderId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex('rankings_ladder_team_unique')
      .on(table.ladderId, table.teamId)
      .where(sql`${table.teamId} IS NOT NULL`),
    index('rankings_ladder_elo_idx').on(table.ladderId, table.elo.desc()),
  ],
);

// ⚠️ `export` obligatoire (piège #8) : un enum non exporté n'est pas vu par drizzle-kit
// → migration cassée. 13 valeurs : les 8 déclencheurs de B9, +2 social (#53), +3 équipe (B11).
export const notificationTypeEnum = pgEnum('notification_type', [
  'match_accepted',
  'result_submitted',
  'result_confirmed',
  'dispute_opened',
  'dispute_resolved',
  'dispute_auto_cancelled',
  'match_ghost_cancelled',
  'dispute_needs_admin',
  // Social : rend le module « notification system » complet (le sujet demande des
  // notifs pour TOUTES les actions, pas seulement le cœur match/dispute).
  'friend_request_received',
  'friend_request_accepted',
  // Équipe (B11) — `teams.ts` était le seul fichier métier à ne jamais notifier.
  // ⚠️ Pas de `team_created` : personne d'autre que le créateur n'est concerné, et la
  // règle B9 est « jamais l'acteur ». Pas de notif d'édition non plus (trop cosmétique).
  // ⚠️ `team_member_added` est MORT depuis B-INV (l'ajout forcé n'existe plus, on invite) :
  // plus personne ne l'émet. La valeur RESTE dans l'enum — retirer une valeur d'enum
  // Postgres est pénible, et des notifications historiques y font encore référence.
  'team_member_added',
  'team_member_removed',
  'team_disbanded',
  // Invitations (B-INV) : le capitaine sollicite, le joueur répond. On notifie le camp
  // concerné, jamais l'acteur → l'invité pour `received`, le capitaine pour les 2 réponses.
  // Pas de notif à l'annulation par le capitaine (il est l'acteur) ni à l'annulation
  // automatique d'une invitation concurrente (décision produit de la carte).
  'team_invitation_received',
  'team_invitation_accepted',
  'team_invitation_declined',
]);

export const notificationsTable = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    // Payload DISPLAY-SAFE uniquement (ids, pseudo, heure) — jamais d'email ni de hash.
    // jsonb et pas de FK vers matches/disputes : une notif est un fait passé, elle doit
    // survivre à la disparition de ce qu'elle raconte.
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }), // null = non lue
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Index composite : couvre la requête de la cloche (mes notifs, plus récentes d'abord)
    // ET les lookups par user_id seul (préfixe gauche) — un seul index suffit.
    index('notifications_user_created_at_idx').on(table.userId, table.createdAt.desc()),
  ],
);

export const gameMapsTable = pgTable(
  'game_maps',
  {
    id: uuid().primaryKey().defaultRandom(),
    gameId: text('game_id')
      .notNull()
      .references(() => gamesTable.id, { onDelete: 'cascade' }),
    name: varchar().notNull(),
  },
  (table) => [unique('game_maps_game_name_unique').on(table.gameId, table.name)],
);
