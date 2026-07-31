import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { realtimeClient } from '@/lib/realtime-client';
import { notificationSchema } from '@/lib/realtime-schema';
import { useRealtimeStore } from '@/stores/realtime-store';

import type { paths } from '@/lib/api-types.gen';
import type { AppNotification } from '@/lib/realtime-schema';

export type { AppNotification };

type NotificationsResponse =
  paths['/notifications']['get']['responses'][200]['content']['application/json'];

/** One page of `GET /notifications`, with its rows narrowed to shapes the UI can render. */
export type NotificationsPage = {
  notifications: AppNotification[];
  unreadCount: number;
  nextCursor: string | null;
};

/** The server's own default, and what a rail-width popover can show without becoming a page. */
const PAGE_SIZE = 20;
/**
 * 🔑 HOW THE BELL GETS ITS COUNT WITHOUT LOADING THE LIST — and why it is `1` and not `0`.
 *
 * There is no `/notifications/count` route, and `unreadCount` is returned by the LIST route
 * only. But it counts ALL my unread notifications, not the page, so the cheapest honest badge
 * is the smallest page the API accepts: `limit` is validated `min(1)`, so one row it is. The
 * row itself is thrown away — this query answers a number.
 *
 * That single request is the ONLY thing the rail asks for on every authenticated page. The
 * list itself is fetched when, and only when, the bell's panel is opened (`NotificationsSlot`
 * is not rendered before that), exactly like [FS-3]'s history and [FS-4]'s conversation list.
 */
const UNREAD_PROBE_SIZE = 1;
/**
 * How long the badge's number is trusted without asking again.
 *
 * 🔑 IT IS NOT A PERFORMANCE TWEAK, it closes a race. With the client default of 0, OPENING THE
 * BELL fires a second count request (`NotificationsSlot` mounts a second reader of this key on a
 * cache that is stale by definition), in parallel with the list's own — and a notification that
 * arrives in that window is applied to the badge and then wiped by an answer that predates it.
 * `useNotificationBell` repairs that case when it happens; this stops it from happening at all
 * for the most ordinary door into it.
 *
 * Half a minute, not more: the refetch on tab focus is what repairs a badge that two tabs have
 * made drift, and a stale time longer than a glance away would blunt it.
 */
const UNREAD_STALE_TIME = 30_000;

/**
 * Prefix of BOTH caches below, so "everything about notifications is stale" is one call.
 * Never passed to a hook: it is a namespace, not a key.
 */
export const NOTIFICATIONS_KEY = ['notifications'] as const;
/** The paginated list, read by `NotificationsSlot` only while the bell's panel is open. */
export const NOTIFICATIONS_LIST_KEY = ['notifications', 'list'] as const;
/** The bell's badge — a plain number, kept exact by the sync in `useNotificationBell`. */
export const NOTIFICATIONS_UNREAD_KEY = ['notifications', 'unread'] as const;

async function fetchNotificationsPage(
  cursor: string | null,
  limit: number,
): Promise<NotificationsPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);

  const raw = await apiFetch<NotificationsResponse>(`/notifications?${query.toString()}`);

  return {
    /**
     * 🚨 EVERY ROW GOES THROUGH ZOD, and that is not belt-and-braces here.
     *
     * The OpenAPI schema types `data` as an opaque object (`Record<string, never>` once
     * generated), because the payload's shape depends on `type` — so the codegen can say
     * WHICH types exist but nothing about what each one carries. `notificationSchema` is the
     * mirror of `backend/src/utils/notification-schemas.ts`, which IS that missing half, and
     * parsing here is what turns a `data` nobody can read into a discriminated union the
     * renderer can switch on. No `as` anywhere: a cast would only silence the disagreement.
     *
     * A row that matches neither a known type NOR the generic net (a missing `id`, an
     * unparsable date — a broken row, not an unknown one) is DROPPED rather than rendered
     * empty. It cannot be marked read or opened, so there is nothing to show for it.
     */
    notifications: raw.notifications.flatMap((row) => {
      const parsed = notificationSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
    unreadCount: raw.unreadCount,
    nextCursor: raw.nextCursor,
  };
}

/**
 * My notifications, newest first, one page at a time.
 *
 * 🚨 ONLY CALL IT FROM A COMPONENT MOUNTED WITH THE BELL'S PANEL OPEN. The social rail lives
 * on every authenticated page; a hook called "just in case" would fetch this list on every
 * screen of the app. `SocialPanel` renders `NotificationsSlot` only while the panel is open,
 * which is the whole guard — there is deliberately no `enabled` flag to get wrong.
 *
 * ⚠️ NO `staleTime`. Refetching when the panel is reopened is not a nicety: the transport
 * REPLAYS NOTHING, so anything that arrived while the panel was closed (or while the socket
 * was down) exists only on the server.
 *
 * ⚠️ `unreadCount` comes back with every page and is deliberately IGNORED here: the badge has
 * its own cache, which mark-as-read updates in place — reading a number frozen at the time of
 * the last fetch would make the badge disagree with the list under it.
 */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: NOTIFICATIONS_LIST_KEY,
    queryFn: ({ pageParam }) => fetchNotificationsPage(pageParam, PAGE_SIZE),
    initialPageParam: null as string | null,
    // `null` ends the pagination — the server sends it when there is provably nothing left
    // (it reads `limit + 1` rows to tell "no more" from "exactly one page left").
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // "A 4xx is a verdict, not a hiccup" — the shared rule of `lib/ladders.ts`, used by every
    // read of the repo. It matters more here than anywhere: this route is mounted on every
    // authenticated page and shares the global quota, so a 429 is a realistic answer, and the
    // TanStack default would print four red lines in the console for one refusal.
    retry: retryServerErrorsOnly,
    // Same reasoning as [FS-4]: the socket is the reconnection signal and it is strictly
    // wider than the browser's online manager. Keeping both meant two requests for one event.
    refetchOnReconnect: false,
  });
}

export function notificationsErrorMessage(error: unknown) {
  // 429 is the only shared failure this read-only route can produce.
  return sharedApiErrorMessage(error) ?? 'Could not load your notifications.';
}

// ------------------------------------------------------------------ pure list rules

/**
 * Sources ∪ sources, deduplicated by `id`, newest first — the server's own order
 * (`ORDER BY created_at DESC, id DESC`), applied to a list it did not build alone.
 *
 * 🚨 THE SOURCES OVERLAP BY DESIGN, exactly like [FS-3]'s message log: a notification arrives
 * through the WebSocket AND comes back in the next `GET /notifications`. Without the dedup it
 * would simply be listed twice.
 *
 * 🔑 LAST SOURCE WINS on a conflict, so callers pass live arrivals FIRST and server pages
 * after: a notification that was read from another tab must come back read, not unread.
 *
 * The tie-break on `id` is not cosmetic: a fan-out inserts several rows at the SAME
 * `created_at`, and the backend breaks that tie on `id` — so this does too, or the same list
 * would read in one order from the server and in another after a live event.
 */
export function mergeNotifications(...sources: AppNotification[][]): AppNotification[] {
  const byId = new Map<string, AppNotification>();

  for (const source of sources) {
    for (const notification of source) {
      byId.set(notification.id, notification);
    }
  }

  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

/**
 * Marks ONE notification read in a list, without touching the others.
 *
 * Returns the SAME array when nothing changes (unknown id, already read) so React re-renders
 * no row for a mutation that was a no-op — the server treats a second read as idempotent too.
 */
export function markNotificationRead(
  notifications: AppNotification[],
  id: string,
  readAt: string,
): AppNotification[] {
  let changed = false;
  const next = notifications.map((notification) => {
    if (notification.id !== id || notification.readAt !== null) return notification;

    changed = true;
    return { ...notification, readAt };
  });

  return changed ? next : notifications;
}

/** Marks every unread notification of a list read. Same "no change, same array" rule. */
export function markAllNotificationsRead(
  notifications: AppNotification[],
  readAt: string,
): AppNotification[] {
  let changed = false;
  const next = notifications.map((notification) => {
    if (notification.readAt !== null) return notification;

    changed = true;
    return { ...notification, readAt };
  });

  return changed ? next : notifications;
}

// ------------------------------------------------------------------ live plumbing

/**
 * Live arrivals, held BESIDE the query cache instead of written into it.
 *
 * 🚨 WRITING THEM INTO THE CACHE WOULD LOSE THEM. A fetch that is already in flight replaces
 * the cache when it lands, so a notification that arrives during the panel's own opening
 * request — the most likely moment of all — would be wiped by a response that predates it.
 * Kept here and merged at render (`mergeNotifications`), it cannot be overwritten by anything;
 * and once the server does return it, the dedup makes the two into one.
 *
 * The buffer is emptied by the panel closing (this hook unmounts with `NotificationsSlot`),
 * which is safe: the reopening refetches, and the server has everything.
 *
 * ⚠️ The read state of a buffered row still has to be maintained — that is what `setLive` is
 * for; see `markNotificationRead` / `markAllNotificationsRead` at the call site.
 */
export function useLiveNotifications() {
  const [live, setLive] = useState<AppNotification[]>([]);

  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if (event.type !== 'notification') return;

        // Merged rather than unshifted: a duplicate frame, or one that landed just after the
        // page containing it, must not produce a second row.
        setLive((current) => mergeNotifications(current, [event.notification]));
      }),
    [],
  );

  return { live, setLive };
}

/**
 * How many unread notifications I have IN TOTAL — the badge's number, and the only thing the
 * rail asks the server for before the bell is opened.
 *
 * 🔑 SAFE TO CALL FROM SEVERAL PLACES. It is one query key, so two readers (the bell and the
 * panel's "Mark all as read") share one cache entry and one request. The live/reconnect sync
 * deliberately lives NEXT DOOR in `useNotificationBell`, which must be mounted exactly ONCE:
 * two copies of that subscription would count every incoming notification twice.
 */
export function useUnreadNotificationCount() {
  const { data } = useQuery({
    queryKey: NOTIFICATIONS_UNREAD_KEY,
    queryFn: async () => (await fetchNotificationsPage(null, UNREAD_PROBE_SIZE)).unreadCount,
    // Same verdict rule as the list above, and the same reason: one refusal, one red line.
    retry: retryServerErrorsOnly,
    staleTime: UNREAD_STALE_TIME,
    refetchOnReconnect: false,
  });

  // A count nobody has yet is not "zero unread", but zero is what a badge must show while it
  // is unknown: the alternative is a badge that appears, disappears and reappears on load.
  return data ?? 0;
}

/**
 * 🚨 THE IDS ALREADY COUNTED, and why a `+ 1` alone is not enough.
 *
 * `AuthenticatedLayout` mounts the social panel TWICE — the permanent rail (`hidden lg:block`,
 * so still mounted at any width) and the overlay of `MobileHeader`. Under 1024 px, with the
 * overlay open, both are alive at once, so `useNotificationBell` runs twice and one incoming
 * notification would bump the badge by two. The same guard also absorbs a duplicated frame.
 *
 * Module scope, because the two hooks that must agree are two different React trees. Cleared
 * wholesale past a size no session reaches, so a tab left open for a week cannot grow it
 * without bound — the ids are uuids, so re-counting one after a clear is not a real risk.
 */
const countedNotificationIds = new Set<string>();
const COUNTED_IDS_LIMIT = 500;

function countOnce(id: string) {
  if (countedNotificationIds.has(id)) return false;
  if (countedNotificationIds.size >= COUNTED_IDS_LIMIT) countedNotificationIds.clear();

  countedNotificationIds.add(id);
  return true;
}

/**
 * The number on the bell, and everything that keeps it true.
 *
 * 🔑 THE SERVER IS ASKED SEVERAL TIMES PER SESSION, and that is the point — this comment used
 * to claim "one request per session", which was simply false. The count is re-fetched:
 *  - on mount;
 *  - when the browser TAB IS FOCUSED AGAIN and the number is older than `UNREAD_STALE_TIME`,
 *    which is what repairs a badge that a second tab (or a frame dropped mid-flight) has made
 *    drift — nothing else in this file can notice that;
 *  - when the bell's panel mounts its own reader past that same freshness window;
 *  - on every RECONNECTION, because the transport replays nothing and whatever arrived while
 *    the socket was down was never counted here.
 *
 * Between those, the number moves WITHOUT a request:
 *  - a live `notification` frame increments it — exactly like [FS-4]'s list reorders itself
 *    instead of asking again;
 *  - marking read decrements it (see `notification-mutations.ts`).
 *
 * 🚨 THE TWO MUST NOT CANCEL EACH OTHER OUT — see the in-flight guard below.
 */
export function useNotificationBell() {
  const queryClient = useQueryClient();
  const connectionState = useRealtimeStore((state) => state.connectionState);
  const unreadCount = useUnreadNotificationCount();

  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if (event.type !== 'notification') return;
        // Two mounted panels hear the same frame — see `countedNotificationIds`.
        if (!countOnce(event.notification.id)) return;

        queryClient.setQueryData<number>(NOTIFICATIONS_UNREAD_KEY, (current) =>
          // `undefined` = the first request has not landed yet, so there is no number to add
          // to. The refetch below is what gives this notification its `+ 1`.
          typeof current === 'number' ? current + 1 : current,
        );

        /**
         * 🚨 A COUNT ALREADY IN FLIGHT WOULD SWALLOW THAT `+ 1` FOR GOOD, and this is the one
         * repair for it.
         *
         * A request that left BEFORE this frame may have been answered before the row existed:
         * when it lands it overwrites the badge with a number that is one too low — and since
         * the id is now in `countedNotificationIds`, no later frame will ever add it back. The
         * badge stays wrong until the next refetch, which is the bug this ticket was sent back
         * for. The list is protected from the very same race by its off-cache buffer
         * (`useLiveNotifications`); the badge, being a single number, cannot merge anything.
         *
         * So the in-flight answer is ABANDONED and asked again: `refetchQueries` defaults to
         * `cancelRefetch: true`, and a request that starts now is answered after the row was
         * committed (the frame is pushed after the commit), so its number includes it. The
         * server, not this counter, has the last word.
         *
         * ⚠️ Only while something IS in flight. Refetching on every frame would undo the whole
         * point of counting live — one request per incoming notification, on every page.
         */
        if (queryClient.isFetching({ queryKey: NOTIFICATIONS_UNREAD_KEY }) > 0) {
          // `void`: the promise never rejects (TanStack swallows it) and the query owns its
          // own error state — an unhandled rejection would be a console error.
          void queryClient.refetchQueries({ queryKey: NOTIFICATIONS_UNREAD_KEY });
        }
      }),
    [queryClient],
  );

  const wasDisconnectedRef = useRef(false);
  useEffect(() => {
    if (connectionState === 'reconnecting' || connectionState === 'closed') {
      wasDisconnectedRef.current = true;
      return;
    }

    if (connectionState !== 'open' || !wasDisconnectedRef.current) return;

    wasDisconnectedRef.current = false;
    // The whole namespace: the badge is stale, and so is the list if the panel is open.
    // `void`: an unhandled rejection is a console error, and each query already owns its
    // own error state.
    void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  }, [connectionState, queryClient]);

  return unreadCount;
}
