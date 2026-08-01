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
  /**
   * Posts a sentence in the ONE live region of the rail, which `SocialPanel` owns and mounts.
   * This slot deliberately declares no `role="status"` / `aria-live` of its own — see the
   * comment there, and the three review passes it already cost on [FS-1], [FS-3] and [FS-4].
   */
  announce: (text: string) => void;
  /**
   * Closes the social overlay before a link navigates. Under 1024 px the panel is a full-screen
   * `aria-modal` overlay, and navigating without closing it leaves the visitor BEHIND it, on a
   * page they cannot reach. `undefined` on desktop, where the rail is permanent.
   */
  onNavigate?: () => void;
};

/**
 * The "Add friend" tab of the social rail: find a player, send them a request, and answer the
 * requests and blocks already on my account.
 *
 * 🚨 MOUNTED ONLY WHILE ITS TAB IS ON SCREEN (`SocialPanel` renders it behind
 * `activeTab === 'addFriend'`), and the four requests it fires depend on that. The rail lives on
 * every authenticated page, so a slot mounted unconditionally would ask the server for my
 * requests, my blocks and my friends on every single screen of the app. Same discipline as
 * [FS-2], [FS-3] and [FS-4].
 *
 * 🔑 IT NEVER FIRES A CALL IT KNOWS WILL BE REFUSED. `POST /friends` answers 400 for "already
 * friends", "already requested" and "yourself" — three cases this screen can see coming, and
 * each one would print a red line in a console the subject requires to be empty. So the friends
 * list and my sent requests are read here as well, and a click on somebody already in one of
 * them explains itself without touching the network. The refusals are still MAPPED (see
 * `friend-mutations.ts`), for the stale tab that disproves "unreachable".
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
   * ⚠️ NOT DISPLAYED HERE — read purely to know who is already a friend, so a search hit that is
   * one is answered on the spot instead of by a 400. It costs nothing when the Friends tab has
   * been opened first (same cache key), and one request otherwise.
   */
  const friends = useFriends();

  const send = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const reject = useRejectFriendRequest();
  const cancel = useCancelFriendRequest();
  const unblock = useUnblockUser();

  /** The answer to the last click on a search hit — sent, auto-accepted, or refused. */
  const [notice, setNotice] = useState<Notice | null>(null);
  /**
   * People I have just sent a request to, this session.
   *
   * 🚨 THE CACHE IS NOT FAST ENOUGH ON ITS OWN. `useSendFriendRequest` invalidates the sent list,
   * but the refetch is a round trip: between the success and its landing, the very same hit is
   * still on screen and a second click would fire a second `POST /friends` — answered 400
   * "already requested", i.e. a red line in the console. This closes that window.
   */
  const [justRequestedIds, setJustRequestedIds] = useState<string[]>([]);
  /**
   * People I became friends with in this session WITHOUT accepting anything — the auto-accept
   * that answers a request they had already sent me (see `SendRequestOutcome`).
   *
   * 🚨 A SEPARATE LIST FROM THE ONE ABOVE, and that is the whole point: the two outcomes of one
   * click need two different sentences. Recording an auto-accept as a "request sent" told the
   * user "you already sent them a friend request" about two people who had just become friends.
   * It still has to block the second click — a second `POST /friends` is answered 400 "already
   * friends", i.e. the red console line this screen exists to avoid — hence a list rather than
   * nothing at all, until the friends list refetch lands.
   */
  const [justFriendedIds, setJustFriendedIds] = useState<string[]>([]);

  /**
   * Landing points for the focus when a confirmed action destroys the row that carried it.
   * Without them the platform drops focus on `<body>` and a keyboard user restarts at the top of
   * the page. A section heading is the right target: it survives its list emptying, and it NAMES
   * where the focus landed. Same idiom — and the same visible `SectionTitle` — as [FS-1].
   */
  const receivedHeadingRef = useRef<HTMLHeadingElement>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  const blocksHeadingRef = useRef<HTMLHeadingElement>(null);

  /**
   * 🚨 WITHOUT THIS, THE THREE LISTS NEVER MOVE WHILE THE TAB IS OPEN — and the worst of it is
   * not a stale row, it is a DESTRUCTIVE button. `DELETE /friends/{id}` is the same route for
   * "cancel my request" and for "unfriend", and the server decides which from the row's CURRENT
   * status: so if the person I am waiting on accepts while I am looking at the list, my "Cancel"
   * button silently becomes "destroy the friendship we just made" — and they are not notified.
   *
   * The same silence covered two more: a request that arrives live is announced by the bell
   * while the tab right under it still says "no pending requests", and a friendship created by
   * the OTHER side (the third door into one, which `refreshPresence` cannot see) never shows up.
   *
   * One subscription, two invalidations, all three closed. The rest of the rail already works
   * this way — `ConversationList` and the bell both listen on the same socket.
   *
   * ⚠️ NO OPTIMISTIC EDIT OF THE CACHE HERE, unlike the conversation list: the notification
   * carries the friendship id and a pseudo, never the avatar and display name a row needs. The
   * refetch is the only thing that can produce a correct row, and these lists are short.
   *
   * ⚠️ AND NO PRESENCE RESYNCHRONISATION either, deliberately: it closes and reopens the very
   * socket that just delivered this event, on somebody ELSE's action, for a dot. A friend made
   * this way is therefore shown offline in the Friends tab until the next reconnection — the
   * known limit of the debt written up in `refreshPresence` (`lib/friend-mutations.ts`).
   */
  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if (event.type !== 'notification') return;

        const { type } = event.notification;
        if (type !== 'friend_request_received' && type !== 'friend_request_accepted') return;

        // `void`: an unhandled rejection is a console error, and a refetch that fails is already
        // reflected by each list's own error state.
        // `FRIEND_REQUESTS_KEY` is the PREFIX of both directions — one call covers received and
        // sent, which is what a live acceptance moves at once.
        void queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY });
        void queryClient.invalidateQueries({ queryKey: FRIENDS_KEY });
      }),
    [queryClient],
  );

  const receivedRequests = received.data?.requests ?? [];
  const sentRequests = sent.data?.requests ?? [];
  const blockedPlayers = blocks.data?.blocks ?? [];

  const friendIds = useMemo(
    () =>
      new Set([
        ...justFriendedIds,
        ...(friends.data?.friends ?? []).map((friend) => friend.id),
      ]),
    [friends.data, justFriendedIds],
  );
  /**
   * Everyone who already has a request from me — server-side, or since the last refetch.
   *
   * ⚠️ It depends on `sent.data`, NOT on the `sentRequests` fallback above: `?? []` builds a
   * fresh array on every render, so depending on it would recompute this set on every render
   * and defeat the memo entirely (eslint's `exhaustive-deps` says exactly this).
   */
  const alreadyRequestedIds = useMemo(() => {
    const ids = new Set(justRequestedIds);
    for (const request of sent.data?.requests ?? []) {
      const person = counterpartOf(request);
      if (person) ids.add(person.id);
    }
    return ids;
  }, [justRequestedIds, sent.data]);

  /**
   * The FIRST list failure, spoken once. The three `FormMessage`s below carry
   * `role="presentation"` — one live region per rail, and it is `SocialPanel`'s — so somebody
   * who cannot see them would otherwise never learn a list is missing. One effect rather than
   * three: three simultaneous failures are one incident (the API is down), not three.
   */
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

  /**
   * A search hit was clicked. `SearchBar` is restricted to `type: 'user'`, so a team can never
   * reach this — the narrowing is there because the payload is a discriminated union and reading
   * `pseudo` off a team result would not compile.
   *
   * 🔑 THE THREE GUARDS BELOW ARE THE POINT OF THIS SCREEN, not a nicety: each one replaces a
   * guaranteed 4xx with a sentence. See the class comment.
   */
  function handleSelect(result: SearchResult) {
    if (result.type !== 'user') return;

    const { id, pseudo } = result;

    /**
     * 🚨 `/search` CAN RETURN ME — DO NOT DELETE THIS GUARD. `routes/search.ts` filters on the
     * typed text and on blocks, and on NOTHING else: it never excludes the caller. Typing my own
     * pseudo therefore lists my own account, and this is the NORMAL path to that click, not a
     * belt for a stale tab. Without it, the click fires a `POST /friends` the server answers 400
     * ("can't friend yourself") — a red line in a console the subject requires to be empty.
     */
    if (id === meId) {
      report('You cannot send yourself a friend request.');
      return;
    }

    /**
     * 🚨 A GUARD THAT COULD NOT READ ITS LIST IS NOT A GUARD. The two sets below are empty both
     * when there is genuinely nothing in them and when the request that fills them FAILED — and
     * in the second case every check silently passes, so clicking somebody I am already friends
     * with fires exactly the 400 this screen exists to prevent. "I do not know" is answered
     * here, by a sentence, rather than by the server.
     *
     * The two lists are re-asked on the way out so the next click can work: the sent list also
     * shows its own "Try again" further down, the friends list is not displayed here at all.
     */
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
         * 🚨 WHICH LIST THE ID GOES IN DEPENDS ON WHAT THE SERVER ACTUALLY DID. Filing an
         * auto-accept under "requests I sent" made the next click answer "you already sent them
         * a friend request" about somebody who had just become a friend — a false sentence, over
         * a request that never existed. Both lists still block that second click; they simply
         * say the truth about it. Each is emptied by its own list refetch landing.
         */
        if (outcome === 'auto-accepted') setJustFriendedIds((current) => [...current, id]);
        else setJustRequestedIds((current) => [...current, id]);
        /**
         * 🚨 THE TWO OUTCOMES OF ONE CLICK. If @pseudo had already sent me a request, the server
         * accepted it there and then (200 + `accepted`) instead of creating a new one — so the
         * friendship EXISTS, nobody has anything left to accept, and saying "request sent" would
         * send the user waiting for an answer that is never coming. The second half of the
         * sentence is what explains why they did not have to wait.
         */
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
        // Dropped from the local guard as well, otherwise searching for the same person again
        // would answer "you already sent them a request" about a request that no longer exists.
        setJustRequestedIds((current) => current.filter((id) => id !== counterpartOf(request)?.id));
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
        {/* Names the tab ON SCREEN — the tab strip above is icon-only, so without this line
            nothing written says which tab is open. */}
        <SectionTitle>Add friend</SectionTitle>
        <p className="text-xs text-text-muted">
          Search a player by pseudo, then pick them to send a friend request.
        </p>

        {/* 🔑 THE SEARCH IS `SearchBar`, NOT A SECOND ONE. It already carries everything this
            field must not get wrong: the 300 ms debounce (one request per pause, never per
            keystroke), the 2-character floor that keeps a half-typed pseudo from asking the
            server for a 400, the abort of a superseded request, and the out-of-order guard.
            `type="user"` also means blocked accounts — in BOTH directions — never appear, which
            is what keeps "this player is not available" from ever revealing a block.

            ⚠️ `disabled` covers three things, all of them "we do not know enough to click yet":
            a send already in flight, and the two lists the guards in `handleSelect` read. */}
        <SearchBar
          type="user"
          limit={SEARCH_RESULT_LIMIT}
          panel="inline"
          placeholder="Search a player by pseudo…"
          label="Search a player to add as a friend"
          disabled={send.isPending || friends.isPending || sent.isPending}
          onSelect={handleSelect}
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
            // 🚨 NO LINK TO THE PROFILE HERE. `GET /users/{pseudo}` answers 404 for an account I
            // have blocked, so the link would open a page that cannot load and write a red line
            // in the console on the way — which is a project-rejection criterion, not a detail.
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
  /**
   * The `children` are `<li>`s, so their number has to be told rather than counted. It also
   * feeds the heading — "Requests received — 2" — the same way [FS-1] titles its groups.
   */
  itemCount: number;
  children: ReactNode;
};

/**
 * One of the three lists, with its four states — loading, error, empty, loaded — side by side
 * instead of buried in early returns that would also take the heading with them.
 *
 * It stays LOCAL to this file on purpose. The same four states are drawn by [FS-1], [FS-2] and
 * [FS-4], but each with its own skeleton height, its own way of speaking and its own header
 * action; hoisting a shared component would mean reopening three merged tickets to make them
 * agree. What this ticket needed three times, it factors three times over — here.
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
      {/* Rendered OUTSIDE the content below so it survives every state, including the empty one
          an action can switch to — and so it stays a valid focus landing point throughout. */}
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
        {/* Two boxes the height of a real row, so the panel does not jump when the data lands.
            Two and not three: there are three of these lists stacked in one 312 px column.
            `aria-hidden`: the sentence below is what a screen reader needs, not these. */}
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

  // 🚨 WHAT THERE IS TO READ COMES FIRST. TanStack keeps `data` when a REFETCH fails, so
  // `isError` goes true on a list that is perfectly usable; wiping it for a background failure
  // would be worse than the failure itself. Same order of tests as [FS-2] and [FS-4].
  if (itemCount === 0) {
    if (isError) {
      return (
        <div className="flex flex-col items-start gap-2">
          {/* `role="presentation"`: one live region per rail, and it is `SocialPanel`'s. The red
              tone stays; the speaking is done by the slot's own effect. */}
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

      {/* `role="list"` is explicit: Tailwind's preflight drops the marker and Safari then drops
          the list semantics with it. */}
      <ul role="list" aria-label={listLabel} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}
