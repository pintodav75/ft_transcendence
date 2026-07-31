import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import {
  NOTIFICATIONS_KEY,
  NOTIFICATIONS_LIST_KEY,
  NOTIFICATIONS_UNREAD_KEY,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/notifications';

import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { paths } from '@/lib/api-types.gen';
import type { NotificationsPage } from '@/lib/notifications';

// Write side of the bell. Its read side (`lib/notifications.ts`) stays separate for the reason
// `friend-mutations.ts` states: queries and mutations have opposite lifecycles, and mixing
// them makes it impossible to see at a glance what invalidates what.

type MarkReadResponse =
  paths['/notifications/{id}/read']['patch']['responses'][200]['content']['application/json'];
type MarkAllReadResponse =
  paths['/notifications/read-all']['patch']['responses'][200]['content']['application/json'];

/** The cached list is an infinite query, so every page has to be walked. */
type CachedNotifications = InfiniteData<NotificationsPage, string | null>;

/**
 * Rewrites every page of the cached list with `update`, and returns the SAME object when no
 * page changed — TanStack would otherwise re-render the whole panel for a no-op.
 */
function updateCachedList(
  queryClient: QueryClient,
  update: (notifications: NotificationsPage['notifications']) => NotificationsPage['notifications'],
) {
  queryClient.setQueryData<CachedNotifications>(NOTIFICATIONS_LIST_KEY, (current) => {
    if (!current) return current;

    let changed = false;
    const pages = current.pages.map((page) => {
      const notifications = update(page.notifications);
      if (notifications === page.notifications) return page;

      changed = true;
      return { ...page, notifications };
    });

    return changed ? { ...current, pages } : current;
  });
}

/**
 * The badge is a plain number in its own cache: it counts ALL my unread notifications, so it
 * cannot be derived from the pages currently loaded. `Math.max(0, …)` because two clicks on
 * the same row (the second landing while the first is still in flight) must not push it
 * negative — the server is idempotent there, and so is this.
 */
function decrementBadge(queryClient: QueryClient, by: number) {
  queryClient.setQueryData<number>(NOTIFICATIONS_UNREAD_KEY, (current) =>
    typeof current === 'number' ? Math.max(0, current - by) : current,
  );
}

/**
 * The row the user acted on is not in the database, so what is on screen is stale: refetch on
 * top of showing the message. Same rule as `friend-mutations.ts` — an error printed over a
 * row that should not be there is half a fix.
 */
function isStaleRowError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

/** `PATCH /notifications/{id}/read`. */
export function markNotificationReadErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && error.status === 404) {
    return 'This notification is no longer available.';
  }

  return 'Could not mark this notification as read.';
}

/** `PATCH /notifications/read-all`. */
export function markAllNotificationsReadErrorMessage(error: unknown) {
  return sharedApiErrorMessage(error) ?? 'Could not mark your notifications as read.';
}

/**
 * 🚨 `wasUnread` IS NOT DERIVABLE FROM THE CACHE, so the caller states it.
 *
 * The row acted on may not be in the cached pages at all — a live arrival the server has not
 * returned yet lives in the panel's own buffer (`useLiveNotifications`). Deducing "it was
 * unread" from "a cached page changed" would therefore leave the badge one too high for
 * exactly the notifications that just arrived, which are the ones a user acts on first.
 */
export type MarkReadVariables = { id: string; wasUnread: boolean };

/**
 * Marks ONE notification read.
 *
 * 🔑 THE CACHE IS REWRITTEN, NOT INVALIDATED, and the difference is visible: invalidating
 * would refetch every loaded page just to flip one boolean, and the row would stay bold until
 * the answer came back. The list is ordered by date, so nothing moves — the only thing that
 * changes is this row's `readAt` and the badge.
 *
 * ⚠️ NOT OPTIMISTIC. The write is applied once the server has agreed, so there is no state to
 * roll back if it refuses; the round trip is one hop to the same origin, and the button is
 * disabled meanwhile (see `NotificationsSlot`).
 *
 * `apiFetch` sends no body and therefore no `content-type` on this PATCH (`prepareBody` in
 * `lib/api.ts`), which is what keeps Fastify from answering 400 `FST_ERR_CTP_EMPTY_JSON_BODY`.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: MarkReadVariables) =>
      apiFetch<MarkReadResponse>(`/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
      }),
    onSuccess: (_response, { id, wasUnread }) => {
      updateCachedList(queryClient, (notifications) =>
        markNotificationRead(notifications, id, new Date().toISOString()),
      );

      if (wasUnread) decrementBadge(queryClient, 1);
    },
    onError: (error) =>
      isStaleRowError(error)
        ? queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
        : undefined,
  });
}

/**
 * Marks everything read in one call.
 *
 * 🚨 ZERO IS AN ASSUMPTION, NOT A FACT, and the server gets to correct it. The call reads every
 * row that was unread WHEN IT RAN; a notification pushed during the round trip is genuinely
 * unread after it, so forcing the badge to zero and stopping there hid it for good — the badge
 * said 0, "Mark all read" disappeared with it, and the row still came back bold on the next
 * fetch. Worse, its id was already in `countedNotificationIds`, so no later frame could add it
 * back either. The zero stays, because it is right in every ordinary case and it is instant;
 * the refetch behind it is what makes the wrong case temporary instead of permanent.
 */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<MarkAllReadResponse>('/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => {
      const readAt = new Date().toISOString();

      updateCachedList(queryClient, (notifications) =>
        markAllNotificationsRead(notifications, readAt),
      );
      // Not `current - updated`: the server has just read EVERY unread row of mine, including
      // the ones no page here has ever loaded — so zero, and not one subtraction that a live
      // arrival could throw off.
      queryClient.setQueryData<number>(NOTIFICATIONS_UNREAD_KEY, 0);
      // …and then the truth. Only the BADGE is invalidated: the list has just been rewritten
      // in place above, and refetching its pages here would undo that work for nothing.
      // `void`: TanStack swallows the rejection, the query owns its own error state.
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_KEY });
    },
  });
}
