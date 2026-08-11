import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, RotateCw } from 'lucide-react';

import { FormMessage } from '@/components/ui/form-message';
import { IconButton } from '@/components/ui/icon-button';
import { InlineButton } from '@/components/ui/inline-button';
import { SectionTitle } from '@/components/ui/section-title';
import { describeNotification, notificationLinkLabel } from '@/lib/notification-copy';
import {
  markAllNotificationsRead,
  markNotificationRead,
  mergeNotifications,
  notificationsErrorMessage,
  useLiveNotifications,
  useNotifications,
  useUnreadNotificationCount,
} from '@/lib/notifications';
import {
  markAllNotificationsReadErrorMessage,
  markNotificationReadErrorMessage,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@/lib/notification-mutations';
import { formatRailTime } from '@/lib/rail-time';
import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';
import type { AppNotification } from '@/lib/notifications';
import type { NotificationLink } from '@/lib/notification-copy';

type NotificationsSlotProps = {
  /** Posts a sentence in the ONE live region of the rail, which `SocialPanel` owns and mounts. */
  announce: (text: string) => void;
  /**
   * Closes the bell's panel — and, under 1024 px, the social overlay around it — before a link
   * navigates.
   */
  onNavigate: () => void;
};

/** The content of the bell's panel: my notifications, newest first, with the two read actions. */
export function NotificationsSlot({ announce, onNavigate }: NotificationsSlotProps) {
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotifications();
  const { live, setLive } = useLiveNotifications();
  const unreadCount = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  /**
   * Landing point for the focus when an action destroys the control that had it: marking a row
   * read removes its button, marking everything read removes the header's own.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);

  /**
   * LIVE FIRST, SERVER PAGES AFTER: the last source wins on a conflict (`mergeNotifications`),
   * and the server's copy is the one that knows whether the row was read from another tab.
   */
  const notifications = mergeNotifications(live, ...(data?.pages ?? []).map((page) => page.notifications));
  const errorMessage = notificationsErrorMessage(error);

  /**
   * The refusal is DISPLAYED by `FormMessage` with no live role of its own (one region per
   * rail, and it is the panel's), so it is spoken from here — same idiom as the other rail lists.
   */
  useEffect(() => {
    if (!isError) return;

    announce(errorMessage);
  }, [announce, errorMessage, isError]);

  /** Applies a read to the LIVE buffer too: a just-arrived row is not in any page yet. */
  function rememberRead(id: string) {
    setLive((current) => markNotificationRead(current, id, new Date().toISOString()));
  }

  function handleMarkRead(notification: AppNotification) {
    markRead.mutate(
      { id: notification.id, wasUnread: notification.readAt === null },
      {
        onSuccess: () => {
          rememberRead(notification.id);
          headingRef.current?.focus();
          announce('Notification marked as read.');
        },
        onError: (mutationError) => announce(markNotificationReadErrorMessage(mutationError)),
      },
    );
  }

  /** Opening a notification reads it — that is what opening something means. */
  function handleOpen(notification: AppNotification) {
    if (notification.readAt === null) {
      markRead.mutate(
        { id: notification.id, wasUnread: true },
        { onSuccess: () => rememberRead(notification.id) },
      );
    }

    onNavigate();
  }

  function handleMarkAll() {
    markAll.mutate(undefined, {
      onSuccess: ({ updated }) => {
        setLive((current) => markAllNotificationsRead(current, new Date().toISOString()));
        headingRef.current?.focus();
        announce(
          updated === 0
            ? 'Nothing to mark — you had no unread notifications.'
            : `${updated} notification${updated > 1 ? 's' : ''} marked as read.`,
        );
      },
      onError: (mutationError) => announce(markAllNotificationsReadErrorMessage(mutationError)),
    });
  }

  return (
    // `max-h-96` + its own scroller: the popover this sits in has no height of its own, so
    // twenty rows would otherwise run off the bottom of the screen with no way to reach them.
    <div className="flex max-h-96 flex-col gap-3 overflow-y-auto p-3">

      <SectionTitle
        headingRef={headingRef}
        action={
          unreadCount > 0 ? (
            // Three words, not four: the heading, the hairline and this button share 264 px of
            // usable width inside the popover, and this is the part that cannot truncate.
            <InlineButton
              onClick={handleMarkAll}
              disabled={markAll.isPending}
              className="whitespace-nowrap"
            >
              {markAll.isPending ? 'Marking…' : 'Mark all read'}
            </InlineButton>
          ) : undefined
        }
      >
        Notifications
      </SectionTitle>

      {markRead.isError && (
        // `role="presentation"`: one live region per rail, and it is `SocialPanel`'s. The red
        // tone stays, the speaking was done by the mutation's own callback.
        <FormMessage role="presentation">{markNotificationReadErrorMessage(markRead.error)}</FormMessage>
      )}
      {markAll.isError && (
        <FormMessage role="presentation">{markAllNotificationsReadErrorMessage(markAll.error)}</FormMessage>
      )}

      <NotificationsContent
        notifications={notifications}
        isPending={isPending}
        isError={isError}
        errorMessage={errorMessage}
        onRetry={() => {
          void refetch();
        }}
        onOpen={handleOpen}
        onMarkRead={handleMarkRead}
        // Which ROW is being marked, so only its own button is disabled — one mutation hook
        // serves every row, so `isPending` alone would freeze all of them at once.
        markingReadId={markRead.isPending ? (markRead.variables?.id ?? null) : null}
      />

      {hasNextPage && (
        <InlineButton
          onClick={() => {
            // `void`: an unhandled rejection would be a console error, and the query's own
            // error state already reflects a page that failed to load.
            void fetchNextPage();
          }}
          disabled={isFetchingNextPage}
          className="self-start"
        >
          {isFetchingNextPage ? 'Loading…' : 'Show older'}
        </InlineButton>
      )}
    </div>
  );
}

type NotificationsContentProps = {
  notifications: AppNotification[];
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  onOpen: (notification: AppNotification) => void;
  onMarkRead: (notification: AppNotification) => void;
  markingReadId: string | null;
};

/**
 * Loading / error / empty / loaded, extracted so the four states are visible side by side
 * instead of buried in early returns that would also take the heading above with them.
 */
function NotificationsContent({
  notifications,
  isPending,
  isError,
  errorMessage,
  onRetry,
  onOpen,
  onMarkRead,
  markingReadId,
}: NotificationsContentProps) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">

        {[0, 1, 2].map((row) => (
          <div key={row} aria-hidden="true" className="h-12 animate-pulse rounded-control bg-surface-card" />
        ))}
        <p className="text-xs text-text-muted">Loading your notifications…</p>
      </div>
    );
  }

  // WHAT THERE IS TO READ COMES FIRST.
  if (notifications.length === 0) {
    if (isError) {
      return (
        <div className="flex flex-col items-start gap-2">
          <FormMessage role="presentation" className="text-sm">
            {errorMessage}
          </FormMessage>
          <InlineButton onClick={onRetry}>
            <RotateCw aria-hidden="true" className="size-3" />
            Try again
          </InlineButton>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-text-secondary">No notifications yet.</p>
        <p className="text-xs text-text-muted">
          Match invites, results, disputes and team news land here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {isError && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <FormMessage role="presentation">{errorMessage}</FormMessage>
          <InlineButton onClick={onRetry}>
            <RotateCw aria-hidden="true" className="size-3" />
            Try again
          </InlineButton>
        </div>
      )}

      <ul role="list" aria-label="Notifications" className="flex flex-col gap-0.5">
        {notifications.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            onOpen={onOpen}
            onMarkRead={onMarkRead}
            isMarkingRead={markingReadId === notification.id}
          />
        ))}
      </ul>
    </div>
  );
}

type NotificationRowProps = {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  onMarkRead: (notification: AppNotification) => void;
  isMarkingRead: boolean;
};

/**
 * One notification: a sentence, a date, and — when it is safe — a way to the screen it talks
 * about (see `describeNotification` for the four destinations that qualify and the two that do
 * not).
 */
function NotificationRow({ notification, onOpen, onMarkRead, isMarkingRead }: NotificationRowProps) {
  const { text, link } = describeNotification(notification);
  const unread = notification.readAt === null;

  const body = (
    <>
      {/* Said in words, because the dot is decorative and colour alone is not information. */}
      {unread && <span className="sr-only">Unread. </span>}
      {text}

      <span className="sr-only"> Received </span>
      <time dateTime={notification.createdAt} className="ml-1 whitespace-nowrap text-xs text-text-muted">
        {formatRailTime(notification.createdAt)}
      </time>
    </>
  );

  return (
    <li
      className={cn(
        'flex items-start gap-1.5 rounded-control px-1.5 py-1.5',
        unread && 'bg-surface-card-strong/60',
      )}
    >

      <span aria-hidden="true" className="mt-2 flex size-1.5 shrink-0">
        {unread && <span className="size-1.5 rounded-full bg-arena-blue" />}
      </span>

      {link ? (
        <NotificationLinkBody link={link} onClick={() => onOpen(notification)} unread={unread}>
          {body}
        </NotificationLinkBody>
      ) : (
        // `wrap-break-word`: a team name is user-provided text and can be one long unbroken word —
        // in a 288 px popover that is the difference between wrapping and overflowing.
        <p className={cn('min-w-0 flex-1 wrap-break-word text-sm', unread ? 'text-text-primary' : 'text-text-secondary')}>
          {body}
        </p>
      )}

      {unread && (
        <IconButton
          size="sm"
          onClick={() => onMarkRead(notification)}
          disabled={isMarkingRead}
          // Names the ROW, not the icon: with five rows on screen, "Mark as read" alone tells
          // neither a screen reader nor voice control WHICH one is about to be marked.
          aria-label={`Mark as read: ${text}`}
        >
          <Check className="size-4" aria-hidden="true" />
        </IconButton>
      )}
    </li>
  );
}

type NotificationLinkBodyProps = {
  link: NotificationLink;
  onClick: () => void;
  unread: boolean;
  children: ReactNode;
};

/** The sentence, as a link to the screen it is about. */
function NotificationLinkBody({ link, onClick, unread, children }: NotificationLinkBodyProps) {
  const className = cn(
    'focus-ring min-w-0 flex-1 wrap-break-word rounded-control text-sm transition hover:text-text-primary hover:underline',
    unread ? 'text-text-primary' : 'text-text-secondary',
  );
  // Spoken after the sentence, so the destination is announced without being read twice.
  const destination = <span className="sr-only"> {notificationLinkLabel(link)}</span>;

  if (link.kind === 'match') {
    return (
      <Link to="/matches/$matchId" params={{ matchId: link.matchId }} onClick={onClick} className={className}>
        {children}
        {destination}
      </Link>
    );
  }

  if (link.kind === 'dispute') {
    return (
      <Link to="/disputes/$disputeId" params={{ disputeId: link.disputeId }} onClick={onClick} className={className}>
        {children}
        {destination}
      </Link>
    );
  }

  if (link.kind === 'ladder') {
    return (
      <Link to="/ladders/$ladderId" params={{ ladderId: link.ladderId }} onClick={onClick} className={className}>
        {children}
        {destination}
      </Link>
    );
  }

  return (
    <Link to="/teams" onClick={onClick} className={className}>
      {children}
      {destination}
    </Link>
  );
}
