import { z } from 'zod'

// Frontend mirror of `backend/src/utils/notification-schemas.ts` and the event payloads
// emitted by `backend/src/routes/chat.ts`. FS-2/FS-3 must update and exercise both sides
// together: strict parsing deliberately rejects drift instead of accepting partial data.
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

const realtimeNotificationSchema = z.discriminatedUnion('type', [
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
])

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
    notification: realtimeNotificationSchema,
  }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum(['not_friends', 'blocked', 'invalid_message_format']),
  }),
])

export type RealtimeServerEvent = z.infer<typeof realtimeServerEventSchema>
export type RealtimeNotification = z.infer<typeof realtimeNotificationSchema>
export type ChatMessage = z.infer<typeof chatMessageSchema>

export function parseRealtimeServerEvent(rawEvent: string): RealtimeServerEvent {
  return realtimeServerEventSchema.parse(JSON.parse(rawEvent))
}
