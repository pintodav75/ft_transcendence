import { pgTable, varchar, uuid, timestamp, text, unique, boolean } from 'drizzle-orm/pg-core';

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
