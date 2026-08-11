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

// Write side of the bell.

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
 * cannot be derived from the pages currently loaded.
 */
function decrementBadge(queryClient: QueryClient, by: number) {
  queryClient.setQueryData<number>(NOTIFICATIONS_UNREAD_KEY, (current) =>
    typeof current === 'number' ? Math.max(0, current - by) : current,
  );
}

/**
 * The row the user acted on is not in the database, so what is on screen is stale: refetch on
 * top of showing the message.
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

/** `wasUnread` IS NOT DERIVABLE FROM THE CACHE, so the caller states it. */
export type MarkReadVariables = { id: string; wasUnread: boolean };

/** Marks ONE notification read. */
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

/** Marks everything read in one call. */
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
      // …and then the truth. Only the BADGE is invalidated: the list has just been rewritten in
      // place above, and refetching its pages here would undo that work for nothing.
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_KEY });
    },
  });
}
