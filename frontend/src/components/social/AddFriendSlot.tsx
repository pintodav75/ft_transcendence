import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, RotateCw, X } from 'lucide-react';

import { PersonRow } from '@/components/social/PersonRow';
import { SearchBar } from '@/components/search/SearchBar';
import { Callout } from '@/components/ui/callout';
import { FormMessage } from '@/components/ui/form-message';
import { IconButton } from '@/components/ui/icon-button';
import { InlineButton } from '@/components/ui/inline-button';
import { SectionTitle } from '@/components/ui/section-title';
import { useBackFrom } from '@/lib/back-navigation';
import { blocksErrorMessage, useBlocks } from '@/lib/blocks';
import {
  acceptFriendRequestErrorMessage,
  cancelFriendRequestErrorMessage,
  rejectFriendRequestErrorMessage,
  sendFriendRequestErrorMessage,
  unblockUserErrorMessage,
  useAcceptFriendRequest,
  useCancelFriendRequest,
  useRejectFriendRequest,
  useSendFriendRequest,
  useUnblockUser,
} from '@/lib/friend-mutations';
import {
  FRIEND_REQUESTS_KEY,
  counterpartOf,
  friendRequestsErrorMessage,
  useFriendRequests,
} from '@/lib/friend-requests';
import { FRIENDS_KEY, useFriends } from '@/lib/friends';
import { realtimeClient } from '@/lib/realtime-client';
import { useAuthStore } from '@/stores/auth-store';

import type { ReactNode, Ref } from 'react';
import type { SearchResult } from '@/components/search/SearchBar';
import type { BlockEntry } from '@/lib/blocks';
import type { FriendRequest } from '@/lib/friend-requests';

/** How many search hits the 312 px rail shows before the three lists below are pushed away. */
const SEARCH_RESULT_LIMIT = 5;

type NoticeTone = 'success' | 'muted' | 'danger';
type Notice = { tone: NoticeTone; text: string };

type AddFriendSlotProps = {
  /** Posts a sentence in the ONE live region of the rail, which `SocialPanel` owns and mounts. */
  announce: (text: string) => void;
  /** Closes the social overlay before a link navigates. */
  onNavigate?: () => void;
};

/**
 * The "Add friend" tab of the social rail: find a player, send them a request, and answer the
 * requests and blocks already on my account.
 */
export function AddFriendSlot({ announce, onNavigate }: AddFriendSlotProps) {
  const meId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  // Read ONCE for the whole slot rather than per row: it names the page the player profile goes
  // back to, and it is the same page for every row of every list here.
  const backFrom = useBackFrom();

  const received = useFriendRequests('received');
  const sent = useFriendRequests('sent');
  const blocks = useBlocks();
  /**
   * NOT DISPLAYED HERE — read purely to know who is already a friend, so a search hit that is
   * one is answered on the spot instead of by a 400.
   */
  const friends = useFriends();

  const send = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const reject = useRejectFriendRequest();
  const cancel = useCancelFriendRequest();
  const unblock = useUnblockUser();

  /** The answer to the last click on a search hit — sent, auto-accepted, or refused. */
  const [notice, setNotice] = useState<Notice | null>(null);

  /** Landing points for the focus when a confirmed action destroys the row that carried it. */
  const receivedHeadingRef = useRef<HTMLHeadingElement>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  const blocksHeadingRef = useRef<HTMLHeadingElement>(null);

  /**
   * WITHOUT THIS, THE THREE LISTS NEVER MOVE WHILE THE TAB IS OPEN — and the worst of it is not
   * a stale row, it is a DESTRUCTIVE button.
   */
  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if (event.type !== 'notification') return;

        const { type } = event.notification;
        if (type !== 'friend_request_received' && type !== 'friend_request_accepted') return;

        // `void`: an unhandled rejection is a console error, and a refetch that fails is
        // already reflected by each list's own error state.
        void queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY });
        void queryClient.invalidateQueries({ queryKey: FRIENDS_KEY });
      }),
    [queryClient],
  );

  const receivedRequests = received.data?.requests ?? [];
  const sentRequests = sent.data?.requests ?? [];
  const blockedPlayers = blocks.data?.blocks ?? [];

  const friendIds = useMemo(
    () => new Set((friends.data?.friends ?? []).map((friend) => friend.id)),
    [friends.data],
  );
  /** Everyone who already has a request from me — server-side, or since the last refetch. */
  const alreadyRequestedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const request of sent.data?.requests ?? []) {
      const person = counterpartOf(request);
      if (person) ids.add(person.id);
    }
    return ids;
  }, [sent.data]);

  /** The FIRST list failure, spoken once. */
  const loadError = received.isError
    ? friendRequestsErrorMessage(received.error, 'received')
    : sent.isError
      ? friendRequestsErrorMessage(sent.error, 'sent')
      : blocks.isError
        ? blocksErrorMessage(blocks.error)
        : null;

  useEffect(() => {
    if (!loadError) return;

    announce(loadError);
  }, [announce, loadError]);

  /** Says it on screen AND out loud — the two paths a sentence has to reach every user. */
  function report(text: string, tone: NoticeTone = 'muted') {
    setNotice({ tone, text });
    announce(text);
  }

  /** A search hit was clicked. */
  function handleSelect(result: SearchResult) {
    if (result.type !== 'user') return;

    const { id, pseudo } = result;

    /**
     * `/search` CAN RETURN ME — DO NOT DELETE THIS GUARD. `routes/search.ts` filters on the
     * typed text and on blocks, and on NOTHING else: it never excludes the caller.
     */
    if (id === meId) {
      report('You cannot send yourself a friend request.');
      return;
    }

    /** A GUARD THAT COULD NOT READ ITS LIST IS NOT A GUARD. */
    if (friends.isError || sent.isError) {
      void friends.refetch();
      void sent.refetch();
      report(
        `Could not check whether you already know @${pseudo}, so nothing was sent. Reloading your lists — pick them again in a moment.`,
        'danger',
      );
      return;
    }

    if (friendIds.has(id)) {
      report(`You are already friends with @${pseudo}.`);
      return;
    }
    if (alreadyRequestedIds.has(id)) {
      report(`You already sent @${pseudo} a friend request.`);
      return;
    }

    send.mutate(id, {
      onSuccess: (outcome) => {
        /**
         * The mutation does not become successful until it has refreshed the authoritative
         * sent/friends list, and `SearchBar` stays disabled while that happens.
         */
        /** THE TWO OUTCOMES OF ONE CLICK. */
        report(
          outcome === 'auto-accepted'
            ? `You and @${pseudo} are now friends — they had already sent you a request.`
            : `Friend request sent to @${pseudo}.`,
          'success',
        );
      },
      onError: (error) => report(sendFriendRequestErrorMessage(error, pseudo), 'danger'),
    });
  }

  function renderSearchAction(result: SearchResult) {
    if (result.type !== 'user') return null;

    const isSelf = result.id === meId;
    const isFriend = friendIds.has(result.id);
    const isRequested = alreadyRequestedIds.has(result.id);
    const busy = send.isPending || friends.isPending || sent.isPending;

    const visibleLabel = isSelf ? 'You' : isFriend ? 'Friends' : isRequested ? 'Sent' : 'Add';
    const accessibleLabel = isSelf
      ? `You cannot add @${result.pseudo}`
      : isFriend
        ? `@${result.pseudo} is already your friend`
        : isRequested
          ? `Friend request to @${result.pseudo} is pending`
          : `Add @${result.pseudo}`;

    return (
      <InlineButton
        disabled={busy || isSelf || isFriend || isRequested}
        onClick={() => handleSelect(result)}
        aria-label={accessibleLabel}
      >
        {visibleLabel}
      </InlineButton>
    );
  }

  function renderSearchResult(result: SearchResult) {
    if (result.type !== 'user') return null;

    return (
      <PersonRow
        person={result}
        backFrom={backFrom}
        onNavigate={onNavigate}
        actions={renderSearchAction(result)}
      />
    );
  }

  function handleAccept(request: FriendRequest, pseudo: string) {
    accept.mutate(request.id, {
      onSuccess: () => {
        receivedHeadingRef.current?.focus();
        report(`You and @${pseudo} are now friends.`, 'success');
      },
      onError: (error) => report(acceptFriendRequestErrorMessage(error), 'danger'),
    });
  }

  function handleReject(request: FriendRequest, pseudo: string) {
    reject.mutate(request.id, {
      onSuccess: () => {
        receivedHeadingRef.current?.focus();
        report(`Friend request from @${pseudo} declined.`);
      },
      onError: (error) => report(rejectFriendRequestErrorMessage(error), 'danger'),
    });
  }

  function handleCancel(request: FriendRequest, pseudo: string) {
    cancel.mutate(request.id, {
      onSuccess: () => {
        sentHeadingRef.current?.focus();
        report(`Friend request to @${pseudo} cancelled.`);
      },
      onError: (error) => report(cancelFriendRequestErrorMessage(error), 'danger'),
    });
  }

  function handleUnblock(blocked: BlockEntry) {
    unblock.mutate(blocked.id, {
      onSuccess: () => {
        blocksHeadingRef.current?.focus();
        report(`@${blocked.pseudo} was unblocked.`);
      },
      onError: (error) => report(unblockUserErrorMessage(error), 'danger'),
    });
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-2">

        <SectionTitle>Add friend</SectionTitle>
        <p className="text-xs text-text-muted">
          Search a player by pseudo. Open their profile or use Add to send a friend request.
        </p>

        <SearchBar
          type="user"
          limit={SEARCH_RESULT_LIMIT}
          panel="inline"
          placeholder="Search a player by pseudo…"
          label="Search a player to add as a friend"
          announce={announce}
          renderResult={renderSearchResult}
        />

        {notice &&
          (notice.tone === 'danger' ? (
            // `role="presentation"`: one live region per rail, and it is `SocialPanel`'s. The
            // red tone stays; the speaking was done by `report`.
            <FormMessage role="presentation" className="text-sm">
              {notice.text}
            </FormMessage>
          ) : (
            <Callout tone={notice.tone} className="px-3 py-2 text-xs">
              {notice.text}
            </Callout>
          ))}
      </div>

      <ListSection
        title="Requests received"
        headingRef={receivedHeadingRef}
        listLabel="Friend requests received"
        isPending={received.isPending}
        isError={received.isError}
        errorMessage={friendRequestsErrorMessage(received.error, 'received')}
        onRetry={() => {
          // `void`: the query's own error state already reflects a refetch that failed, and an
          // unhandled rejection in a click handler is a console error — a rejection criterion.
          void received.refetch();
        }}
        loadingText="Loading the requests you received…"
        emptyText="No pending requests."
        itemCount={receivedRequests.length}
      >
        {receivedRequests.map((request) => {
          const person = counterpartOf(request);
          // `direction=received` always fills `from`; a row without it is a contract the front
          // cannot repair, and skipping one line beats crashing the whole rail.
          if (!person) return null;

          const busy = accept.isPending || reject.isPending;

          return (
            <PersonRow
              key={request.id}
              person={person}
              backFrom={backFrom}
              onNavigate={onNavigate}
              actions={
                <>
                  <IconButton
                    size="sm"
                    // Named after the ROW: five buttons called "Accept" are indistinguishable
                    // to anyone browsing by controls or driving by voice.
                    aria-label={`Accept the friend request from @${person.pseudo}`}
                    disabled={busy}
                    onClick={() => handleAccept(request, person.pseudo)}
                  >
                    <Check className="size-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    aria-label={`Decline the friend request from @${person.pseudo}`}
                    disabled={busy}
                    onClick={() => handleReject(request, person.pseudo)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </IconButton>
                </>
              }
            />
          );
        })}
      </ListSection>

      <ListSection
        title="Requests sent"
        headingRef={sentHeadingRef}
        listLabel="Friend requests sent"
        isPending={sent.isPending}
        isError={sent.isError}
        errorMessage={friendRequestsErrorMessage(sent.error, 'sent')}
        onRetry={() => {
          void sent.refetch();
        }}
        loadingText="Loading the requests you sent…"
        emptyText="You have no request waiting for an answer."
        itemCount={sentRequests.length}
      >
        {sentRequests.map((request) => {
          const person = counterpartOf(request);
          if (!person) return null;

          return (
            <PersonRow
              key={request.id}
              person={person}
              backFrom={backFrom}
              onNavigate={onNavigate}
              actions={
                <InlineButton
                  disabled={cancel.isPending}
                  onClick={() => handleCancel(request, person.pseudo)}
                  // Withdrawing a request destroys nothing and the other side is never told, so
                  // it stays `neutral` — the same call `RosterChips` made on invitations.
                  aria-label={`Cancel the friend request to @${person.pseudo}`}
                >
                  Cancel
                </InlineButton>
              }
            />
          );
        })}
      </ListSection>

      <ListSection
        title="Blocked players"
        headingRef={blocksHeadingRef}
        listLabel="Blocked players"
        isPending={blocks.isPending}
        isError={blocks.isError}
        errorMessage={blocksErrorMessage(blocks.error)}
        onRetry={() => {
          void blocks.refetch();
        }}
        loadingText="Loading your blocked players…"
        emptyText="You have not blocked anyone."
        itemCount={blockedPlayers.length}
      >
        {blockedPlayers.map((blocked) => (
          <PersonRow
            key={blocked.id}
            person={blocked}
            // NO LINK TO THE PROFILE HERE.
            linkToProfile={false}
            actions={
              <InlineButton
                disabled={unblock.isPending}
                onClick={() => handleUnblock(blocked)}
                aria-label={`Unblock @${blocked.pseudo}`}
              >
                Unblock
              </InlineButton>
            }
          />
        ))}
      </ListSection>
    </div>
  );
}

type ListSectionProps = {
  title: string;
  headingRef: Ref<HTMLHeadingElement>;
  /** Names the `<ul>` so a screen reader hears WHICH list it entered — this slot has three. */
  listLabel: string;
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  loadingText: string;
  emptyText: string;
  /** The `children` are `<li>`s, so their number has to be told rather than counted. */
  itemCount: number;
  children: ReactNode;
};

/**
 * One of the three lists, with its four states — loading, error, empty, loaded — side by side
 * instead of buried in early returns that would also take the heading with them.
 */
function ListSection({
  title,
  headingRef,
  listLabel,
  isPending,
  isError,
  errorMessage,
  onRetry,
  loadingText,
  emptyText,
  itemCount,
  children,
}: ListSectionProps) {
  return (
    <div className="flex flex-col gap-2">

      <SectionTitle headingRef={headingRef}>
        {itemCount > 0 ? `${title} — ${itemCount}` : title}
      </SectionTitle>

      <ListSectionContent
        isPending={isPending}
        isError={isError}
        errorMessage={errorMessage}
        onRetry={onRetry}
        loadingText={loadingText}
        emptyText={emptyText}
        itemCount={itemCount}
        listLabel={listLabel}
      >
        {children}
      </ListSectionContent>
    </div>
  );
}

function ListSectionContent({
  isPending,
  isError,
  errorMessage,
  onRetry,
  loadingText,
  emptyText,
  itemCount,
  listLabel,
  children,
}: Omit<ListSectionProps, 'title' | 'headingRef'>) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">

        {[0, 1].map((row) => (
          <div
            key={row}
            aria-hidden="true"
            className="h-13 animate-pulse rounded-control bg-surface-card"
          />
        ))}
        <p className="text-xs text-text-muted">{loadingText}</p>
      </div>
    );
  }

  // WHAT THERE IS TO READ COMES FIRST.
  if (itemCount === 0) {
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

    return <p className="text-xs text-text-muted">{emptyText}</p>;
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

      <ul role="list" aria-label={listLabel} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}
