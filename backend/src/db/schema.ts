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

export const matchesTable = pgTable(
  'matches',
  {
    id: uuid().primaryKey().defaultRandom(),
    ladderId: uuid('ladder_id')
      .notNull()
      .references(() => laddersTable.id, { onDelete: 'restrict' }),
    status: matchStatusEnum('status').notNull().default('pending'),
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
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'restrict' }),
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
