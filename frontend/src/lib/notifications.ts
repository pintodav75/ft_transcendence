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
/** HOW THE BELL GETS ITS COUNT WITHOUT LOADING THE LIST — and why it is `1` and not `0`. */
const UNREAD_PROBE_SIZE = 1;
/** How long the badge's number is trusted without asking again. */
const UNREAD_STALE_TIME = 30_000;

/**
 * Prefix of BOTH caches below, so "everything about notifications is stale" is one call. Never
 * passed to a hook: it is a namespace, not a key.
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
    /** EVERY ROW GOES THROUGH ZOD, and that is not belt-and-braces here. */
    notifications: raw.notifications.flatMap((row) => {
      const parsed = notificationSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
    unreadCount: raw.unreadCount,
    nextCursor: raw.nextCursor,
  };
}

/** My notifications, newest first, one page at a time. */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: NOTIFICATIONS_LIST_KEY,
    queryFn: ({ pageParam }) => fetchNotificationsPage(pageParam, PAGE_SIZE),
    initialPageParam: null as string | null,
    // `null` ends the pagination — the server sends it when there is provably nothing left (it
    // reads `limit + 1` rows to tell "no more" from "exactly one page left").
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // "A 4xx is a verdict, not a hiccup" — the shared rule of `lib/ladders.ts`, used by every
    // read of the repo.
    retry: retryServerErrorsOnly,
    // Same reasoning as the conversation list: the socket is the reconnection signal and it is strictly wider
    // than the browser's online manager. Keeping both meant two requests for one event.
    refetchOnReconnect: false,
  });
}

export function notificationsErrorMessage(error: unknown) {
  // 429 is the only shared failure this read-only route can produce.
  return sharedApiErrorMessage(error) ?? 'Could not load your notifications.';
}

// ------------------------------------------------------------------ pure list rules

/**
 * Sources ∪ sources, deduplicated by `id`, newest first — the server's own order (`ORDER BY
 * created_at DESC, id DESC`), applied to a list it did not build alone.
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

/** Marks ONE notification read in a list, without touching the others. */
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

/** Live arrivals, held BESIDE the query cache instead of written into it. */
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

  // A count nobody has yet is not "zero unread", but zero is what a badge must show while it is
  // unknown: the alternative is a badge that appears, disappears and reappears on load.
  return data ?? 0;
}

/** THE IDS ALREADY COUNTED, and why a `+ 1` alone is not enough. */
const countedNotificationIds = new Set<string>();
const COUNTED_IDS_LIMIT = 500;

function countOnce(id: string) {
  if (countedNotificationIds.has(id)) return false;
  if (countedNotificationIds.size >= COUNTED_IDS_LIMIT) countedNotificationIds.clear();

  countedNotificationIds.add(id);
  return true;
}

/**
 * The number on the bell, and what keeps it true.
 *
 * re-fetched: on mount, on tab refocus past UNREAD_STALE_TIME (repairs a badge a second tab
 * made drift), when the bell panel mounts its own reader past that window, and on every
 * reconnection (the transport replays nothing).
 * between those it moves without a request: a live `notification` frame increments, marking
 * read decrements (notification-mutations.ts).
 * the two must not cancel each other out — see the in-flight guard below.
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
         * A COUNT ALREADY IN FLIGHT WOULD SWALLOW THAT `+ 1` FOR GOOD, and this is the one
         * repair for it.
         */
        if (queryClient.isFetching({ queryKey: NOTIFICATIONS_UNREAD_KEY }) > 0) {
          // `void`: the promise never rejects (TanStack swallows it) and the query owns its own
          // error state — an unhandled rejection would be a console error.
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
    void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  }, [connectionState, queryClient]);

  return unreadCount;
}
