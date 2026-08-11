import { useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
// The row-age formatter this module used to own moved to `lib/rail-time.ts` when the notifications list became
// its second consumer; the day key AND the two `Intl` formatters come back from there so the
// two files cannot drift.
import { dayKey, formatClockTime, formatFullDate } from '@/lib/rail-time';

import type { components, paths } from '@/lib/api-types.gen';

/** One direct message, exactly as the server stores it. */
export type Message = components['schemas']['Message'];

/**
 * The person on the other side of a conversation. `FriendSummary` and not `FriendListItem`: a
 * conversation needs the account (id, pseudo, avatar), never the friendship row.
 */
export type ChatPartner = components['schemas']['FriendSummary'];

/**
 * One row of `GET /messages/conversations`: a friend, plus the last message exchanged with
 * them.
 */
export type Conversation = components['schemas']['ConversationSummary'];

type ConversationResponse =
  paths['/messages/{friendId}']['get']['responses'][200]['content']['application/json'];

/** Exported so the live listener can type the cache it rewrites with the very same shape. */
export type ConversationsResponse =
  paths['/messages/conversations']['get']['responses'][200]['content']['application/json'];

/** Mirror of the server rule (`content: z.string().min(1).max(1000)` in `routes/chat.ts`). */
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * Exported so the conversation list invalidates the very key this hook reads, instead of re-declaring the
 * literal in another module — the repo's rule since two spellings of one key stopped a cache
 * from refreshing (`MY_INVITATIONS_KEY` in `lib/teams.ts`).
 */
export function conversationKey(friendId: string) {
  return ['messages', friendId] as const;
}

/** The last 100 messages exchanged with one friend, oldest first. */
export function useConversation(friendId: string) {
  return useQuery({
    queryKey: conversationKey(friendId),
    queryFn: () => apiFetch<ConversationResponse>(`/messages/${encodeURIComponent(friendId)}`),
    /**
     * OFF, and MEASURED: with it on, coming back from a cut fired this GET TWICE — once for
     * TanStack's own online manager, once for the socket coming back up (`ChatConversation`).
     */
    refetchOnReconnect: false,
  });
}

/**
 * Key of the conversation LIST, exported for the same reason `conversationKey` is: the live
 * listener of `ConversationList` rewrites this cache directly, and two spellings of one key in
 * two modules is what stopped a cache from refreshing once already (`MY_INVITATIONS_KEY`).
 */
export const CONVERSATIONS_KEY = ['messages', 'conversations'] as const;

/** Every friend I have ever exchanged a message with, most recent conversation first. */
export function useConversations() {
  return useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: () => apiFetch<ConversationsResponse>('/messages/conversations'),
    // Same reasoning as `useConversation`: the socket is the reconnection signal, and it is
    // strictly wider than the browser's online manager.
    refetchOnReconnect: false,
  });
}

/**
 * Moves the conversation a message belongs to back to the top of the list, with that message as
 * its new preview.
 */
export function bumpConversation(
  conversations: Conversation[],
  message: Message,
  meId: string,
): Conversation[] | null {
  const otherId = message.senderId === meId ? message.receiverId : message.senderId;
  const index = conversations.findIndex((conversation) => conversation.friend.id === otherId);
  if (index === -1) return null;

  const existing = conversations[index];
  // Already first, and already showing this very message: return the SAME array so TanStack
  // keeps the reference and no row re-renders.
  if (index === 0 && existing.lastMessage.id === message.id) return conversations;

  return [
    { ...existing, lastMessage: message },
    ...conversations.slice(0, index),
    ...conversations.slice(index + 1),
  ];
}

/** Is this message part of the conversation between me and that friend? */
export function belongsToConversation(message: Message, meId: string, friendId: string) {
  return (
    (message.senderId === meId && message.receiverId === friendId) ||
    (message.senderId === friendId && message.receiverId === meId)
  );
}

/** History ∪ live events, deduplicated by `id` and ordered by `createdAt` then `id`. */
export function mergeMessages(...sources: Message[][]): Message[] {
  const byId = new Map<string, Message>();

  for (const source of sources) {
    for (const message of source) {
      byId.set(message.id, message);
    }
  }

  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

// ------------------------------------------------------------------ error copy

const NOT_FRIENDS_MESSAGE = 'You are not friends any more — this conversation is closed.';
/**
 * 404 covers TWO cases the server refuses to tell apart (an account that no longer exists, and
 * one that has blocked me), so the sentence must not name either: saying "they blocked you"
 * would leak exactly what the API is hiding.
 */
const CONVERSATION_GONE_MESSAGE = 'This conversation is not available any more.';

/** `GET /messages/{friendId}`. */
export function conversationErrorMessage(error: unknown) {
  // BEFORE `sharedApiErrorMessage`: on this route a 403 is not "you may not do this", it is the
  // precise "you two are not friends any more", and the generic sentence would hide it.
  if (error instanceof ApiError && error.status === 403) return NOT_FRIENDS_MESSAGE;
  if (error instanceof ApiError && error.status === 404) return CONVERSATION_GONE_MESSAGE;

  // 429 is the only shared case left that this route can produce.
  return sharedApiErrorMessage(error) ?? 'Could not load this conversation.';
}

/** `GET /messages/conversations`. */
export function conversationsErrorMessage(error: unknown) {
  return sharedApiErrorMessage(error) ?? 'Could not load your conversations.';
}

/** The three refusals the WebSocket can answer to a send (`routes/chat.ts`). */
export function sendErrorMessage(code: 'not_friends' | 'blocked' | 'invalid_message_format') {
  if (code === 'not_friends') return NOT_FRIENDS_MESSAGE;
  if (code === 'blocked') return 'Message not sent — you cannot message this player any more.';

  // Should be unreachable: the composer applies the very same 1–1000 rule before sending.
  // Mapped anyway, because "unreachable" is exactly what a stale tab disproves.
  return `Message not sent — it must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`;
}

// -------------------------------------------------------------------- formatting

/**
 * THE FORMATTERS THEMSELVES LIVE IN `rail-time.ts`, not here — the extraction is
 * finished.
 */

/** `14:32` — all a bubble shows. WHICH DAY it belongs to is carried by the day separators. */
export function formatMessageTime(isoDate: string) {
  return formatClockTime(new Date(isoDate));
}

/** Do these two messages belong to the same day? Decides where a separator is inserted. */
export function isSameDay(isoDateA: string, isoDateB: string) {
  return dayKey(new Date(isoDateA)) === dayKey(new Date(isoDateB));
}

/** `Today` / `Yesterday` / `28 Jul 2026` — the label of a day separator. */
export function formatMessageDayLabel(isoDate: string) {
  const date = new Date(isoDate);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) return 'Today';

  const yesterday = new Date(today);
  // `setDate` with 0 or -1 rolls back into the previous month (and year) on its own.
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';

  return formatFullDate(date);
}
