import { useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';

import type { components, paths } from '@/lib/api-types.gen';

/**
 * One direct message, exactly as the server stores it.
 *
 * 🔑 IT COMES FROM THE CODEGEN, and the five fields are REQUIRED there (`openapi.yaml`,
 * `required: [id, senderId, receiverId, content, createdAt]`). That is what makes `id` usable
 * as the deduplication key below without testing it first — and dedup by `id` is the feature,
 * not an optimisation: the same message reaches this screen through two independent paths.
 *
 * ⚠️ `createdAt` is an ISO **string**, never a `Date` (invariant #8).
 */
export type Message = components['schemas']['Message'];

/**
 * The person on the other side of a conversation. `FriendSummary` and not `FriendListItem`:
 * a conversation needs the account (id, pseudo, avatar), never the friendship row. The
 * friends list hands over a `FriendListItem`, which is a superset, so it fits as is — and
 * [FS-4] will be able to open the same component from `GET /messages/conversations`, whose
 * payload carries exactly this shape.
 */
export type ChatPartner = components['schemas']['FriendSummary'];

type ConversationResponse =
  paths['/messages/{friendId}']['get']['responses'][200]['content']['application/json'];

/** Mirror of the server rule (`content: z.string().min(1).max(1000)` in `routes/chat.ts`). */
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * Exported so [FS-4] invalidates the very key this hook reads, instead of re-declaring the
 * literal in another module — the repo's rule since two spellings of one key stopped a cache
 * from refreshing (`MY_INVITATIONS_KEY` in `lib/teams.ts`).
 *
 * Keyed BY FRIEND: two conversations are two caches, so switching partner never shows the
 * previous history for a heartbeat.
 */
export function conversationKey(friendId: string) {
  return ['messages', friendId] as const;
}

/**
 * The last 100 messages exchanged with one friend, oldest first.
 *
 * 🚨 ONLY CALL IT WITH A CONVERSATION ACTUALLY OPEN. The social rail is mounted on every
 * authenticated page, so a hook called "just in case" would fire an HTTP request on every
 * screen of the app. The component that owns it (`ChatConversation`) is mounted only once a
 * partner has been chosen, which is the whole guard — there is deliberately no `enabled`
 * flag to get wrong.
 *
 * ⚠️ NO `staleTime`. Refetching on mount is not a nicety here: the realtime transport REPLAYS
 * NOTHING, so anything received while no conversation was open with that friend (it was closed,
 * another partner was showing, the socket had dropped) exists only on the server.
 */
export function useConversation(friendId: string) {
  return useQuery({
    queryKey: conversationKey(friendId),
    queryFn: () => apiFetch<ConversationResponse>(`/messages/${encodeURIComponent(friendId)}`),
    /**
     * ⚠️ OFF, and MEASURED: with it on, coming back from a cut fired this GET TWICE — once for
     * TanStack's own online manager, once for the socket coming back up (`ChatConversation`).
     *
     * The socket is the better of the two signals, and it is strictly wider: it also catches
     * the cases the browser calls "online" — a backend restart, a proxy dropping the upgrade —
     * where the online manager sees nothing at all. Keeping both meant two identical requests
     * for one event.
     */
    refetchOnReconnect: false,
  });
}

/**
 * Is this message part of the conversation between me and that friend? Guards the realtime
 * listener: the socket carries EVERY event of the session — the other conversations, presence,
 * notifications — and a chat window that appends whatever goes past would show a stranger's
 * message in the wrong thread.
 */
export function belongsToConversation(message: Message, meId: string, friendId: string) {
  return (
    (message.senderId === meId && message.receiverId === friendId) ||
    (message.senderId === friendId && message.receiverId === meId)
  );
}

/**
 * History ∪ live events, deduplicated by `id` and ordered by `createdAt` then `id`.
 *
 * 🚨 THE TWO SOURCES OVERLAP BY DESIGN, so this is the feature and not a safety net. A message
 * arrives through the WebSocket, is appended to the live buffer, and is ALSO returned by the
 * next `GET /messages/{friendId}` (a reconnection refetch, a remount when the tab is switched).
 * Without the dedup it would simply be shown twice.
 *
 * 🔑 THE SECOND SORT CRITERION IS NOT COSMETIC. Two messages can share a `createdAt` to the
 * millisecond — two people answering at once is a NORMAL chat event — and `ORDER BY created_at`
 * alone leaves their order to the database. `backend/src/routes/messages.ts` breaks the tie on
 * `id`, so this does too: the same conversation must not read in one order from the history and
 * in another after a live message.
 *
 * Uuids compare identically as text here and as `uuid` in Postgres (canonical lowercase hex,
 * hyphens at fixed positions), so the two tie-breaks really are the same one.
 */
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
 * 404 covers TWO cases the server refuses to tell apart (an account that no longer exists,
 * and one that has blocked me), so the sentence must not name either: saying "they blocked
 * you" would leak exactly what the API is hiding.
 */
const CONVERSATION_GONE_MESSAGE = 'This conversation is not available any more.';

/** `GET /messages/{friendId}`. */
export function conversationErrorMessage(error: unknown) {
  // BEFORE `sharedApiErrorMessage`: on this route a 403 is not "you may not do this", it is
  // the precise "you two are not friends any more", and the generic sentence would hide it.
  if (error instanceof ApiError && error.status === 403) return NOT_FRIENDS_MESSAGE;
  if (error instanceof ApiError && error.status === 404) return CONVERSATION_GONE_MESSAGE;

  // 429 is the only shared case left that this route can produce.
  return sharedApiErrorMessage(error) ?? 'Could not load this conversation.';
}

/**
 * The three refusals the WebSocket can answer to a send (`routes/chat.ts`). They arrive as a
 * bare `code`, with no echo of what was refused — the caller is the one that knows which draft
 * was in flight.
 */
export function sendErrorMessage(code: 'not_friends' | 'blocked' | 'invalid_message_format') {
  if (code === 'not_friends') return NOT_FRIENDS_MESSAGE;
  if (code === 'blocked') return 'Message not sent — you cannot message this player any more.';

  // Should be unreachable: the composer applies the very same 1–1000 rule before sending.
  // Mapped anyway, because "unreachable" is exactly what a stale tab disproves.
  return `Message not sent — it must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`;
}

// -------------------------------------------------------------------- formatting

/**
 * `en-GB` is pinned, like every other formatter of the repo: a 24-hour clock, and the same
 * string on every machine (a host locale would make the console audit compare against a
 * moving target).
 */
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** `14:32` — all a bubble shows. WHICH DAY it belongs to is carried by the day separators. */
export function formatMessageTime(isoDate: string) {
  return clockFormat.format(new Date(isoDate));
}

/** Local calendar day, so "same day" means what the reader's clock says, not what UTC says. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Do these two messages belong to the same day? Decides where a separator is inserted. */
export function isSameDay(isoDateA: string, isoDateB: string) {
  return dayKey(new Date(isoDateA)) === dayKey(new Date(isoDateB));
}

/**
 * `Today` / `Yesterday` / `28 Jul 2026` — the label of a day separator.
 *
 * 🔑 The two named days are not decoration: in a 100-message conversation, the only question a
 * reader actually asks is "was this today?". A date read as `28 Jul` forces them to work it out.
 *
 * ⚠️ Computed at render, so a tab left open across midnight keeps saying "Today" until the next
 * render. Not worth a timer: any message, any refetch, any keystroke in the composer fixes it.
 */
export function formatMessageDayLabel(isoDate: string) {
  const date = new Date(isoDate);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) return 'Today';

  const yesterday = new Date(today);
  // `setDate` with 0 or -1 rolls back into the previous month (and year) on its own.
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';

  return dayFormat.format(date);
}
