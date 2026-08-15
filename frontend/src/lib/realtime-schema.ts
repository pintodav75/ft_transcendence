import { z } from 'zod'

// Frontend mirror of `backend/src/utils/notification-schemas.ts` and the event payloads emitted
// by `backend/src/routes/chat.ts`.
const uuidSchema = z.uuid()
const dateTimeSchema = z.iso.datetime()

const chatMessageSchema = z.strictObject({
  id: uuidSchema,
  senderId: uuidSchema,
  receiverId: uuidSchema,
  content: z.string(),
  createdAt: dateTimeSchema,
})

const notificationBaseShape = {
  id: uuidSchema,
  readAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
}

/**
 * The 17 notification types the client KNOWS, each with the exact payload
 * `backend/src/utils/notification-schemas.ts` writes — that file is the source of truth and
 * this is its mirror.
 */
const knownNotificationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('match_accepted'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
      scheduledAt: dateTimeSchema,
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('result_submitted'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('result_confirmed'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
      winnerSideId: uuidSchema,
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('dispute_opened'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
      disputeId: uuidSchema,
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('dispute_resolved'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
      disputeId: uuidSchema,
      resolution: z.enum(['side_0_wins', 'side_1_wins', 'cancelled']),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('dispute_auto_cancelled'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
      disputeId: uuidSchema,
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('match_ghost_cancelled'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('dispute_needs_admin'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
      disputeId: uuidSchema,
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('friend_request_received'),
    data: z.strictObject({
      friendshipId: uuidSchema,
      fromUserId: uuidSchema,
      fromPseudo: z.string(),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('friend_request_accepted'),
    data: z.strictObject({
      friendshipId: uuidSchema,
      byUserId: uuidSchema,
      byPseudo: z.string(),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('team_member_added'),
    data: z.strictObject({
      teamId: uuidSchema,
      teamName: z.string(),
      ladderId: uuidSchema,
      byUserId: uuidSchema,
      byPseudo: z.string(),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('team_member_removed'),
    data: z.strictObject({
      teamId: uuidSchema,
      teamName: z.string(),
      ladderId: uuidSchema,
      byUserId: uuidSchema,
      byPseudo: z.string(),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('team_disbanded'),
    data: z.strictObject({
      teamId: uuidSchema,
      teamName: z.string(),
      ladderId: uuidSchema,
      byUserId: uuidSchema,
      byPseudo: z.string(),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('team_invitation_received'),
    data: z.strictObject({
      invitationId: uuidSchema,
      teamId: uuidSchema,
      teamName: z.string(),
      ladderId: uuidSchema,
      byUserId: uuidSchema,
      byPseudo: z.string(),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('team_invitation_accepted'),
    data: z.strictObject({
      invitationId: uuidSchema,
      teamId: uuidSchema,
      teamName: z.string(),
      ladderId: uuidSchema,
      byUserId: uuidSchema,
      byPseudo: z.string(),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('team_invitation_declined'),
    data: z.strictObject({
      invitationId: uuidSchema,
      teamId: uuidSchema,
      teamName: z.string(),
      ladderId: uuidSchema,
      byUserId: uuidSchema,
      byPseudo: z.string(),
    }),
  }),
  z.strictObject({
    ...notificationBaseShape,
    type: z.literal('match_cancelled_member_left'),
    data: z.strictObject({
      matchId: uuidSchema,
      ladderId: uuidSchema,
      // NULLABLE here and only here — the column is, and the server prefers saying "no time" to
      // inventing one (see the payload's docblock on the backend side).
      scheduledAt: dateTimeSchema.nullable(),
      teamId: uuidSchema,
      teamName: z.string(),
      // NOT `byUserId`: `by*` names the ACTOR everywhere else, and on a kick the actor is the
      // captain while the player who broke the line-up is the one being removed.
      playerId: uuidSchema,
      playerPseudo: z.string(),
    }),
  }),
])

/**
 * THE SAFETY NET FOR A TYPE THIS CLIENT HAS NEVER HEARD OF — and for a known type whose payload
 * has drifted.
 */
const unsupportedNotificationSchema = z
  .object({
    ...notificationBaseShape,
    type: z.string(),
  })
  .transform(({ id, readAt, createdAt }) => ({
    id,
    readAt,
    createdAt,
    type: 'unsupported' as const,
  }))

/**
 * ONE schema for BOTH transports — the `notification` frame of the WebSocket and the rows of
 * `GET /notifications` carry the very same five fields, so a single definition is what keeps a
 * live notification and its refetched twin rendering identically.
 */
export const notificationSchema = z.union([knownNotificationSchema, unsupportedNotificationSchema])

export const realtimeServerEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('initial_presence'),
    onlineFriendIds: z.array(uuidSchema),
  }),
  z.strictObject({
    type: z.literal('presence'),
    userId: uuidSchema,
    online: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('message'),
    message: chatMessageSchema,
  }),
  z.strictObject({
    type: z.literal('message_sent'),
    message: chatMessageSchema,
  }),
  z.strictObject({
    type: z.literal('notification'),
    notification: notificationSchema,
  }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum(['not_friends', 'blocked', 'invalid_message_format']),
  }),
])

export type RealtimeServerEvent = z.infer<typeof realtimeServerEventSchema>
/** ONE notification, whichever door it came through. */
export type AppNotification = z.infer<typeof notificationSchema>
export type ChatMessage = z.infer<typeof chatMessageSchema>

export function parseRealtimeServerEvent(rawEvent: string): RealtimeServerEvent {
  return realtimeServerEventSchema.parse(JSON.parse(rawEvent))
}
