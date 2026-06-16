import {
  pgTable,
  varchar,
  uuid,
  timestamp,
  text,
  unique,
  boolean,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const friendshipStatusEnum = pgEnum('friendship_status', ['pending', 'accepted']);

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
