import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { MessageCircle, RotateCw, ShieldBan, UserMinus } from 'lucide-react';

import { PresenceAvatar } from '@/components/social/PresenceAvatar';
import { ActionMenu } from '@/components/ui/action-menu';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormMessage } from '@/components/ui/form-message';
import { IconButton } from '@/components/ui/icon-button';
import { InlineButton } from '@/components/ui/inline-button';
import { SectionTitle } from '@/components/ui/section-title';
import { useBackFrom } from '@/lib/back-navigation';
import {
  blockUserErrorMessage,
  removeFriendErrorMessage,
  useBlockUser,
  useRemoveFriend,
} from '@/lib/friend-mutations';
import { sortedByPseudo, splitByPresence, useFriends } from '@/lib/friends';
import { presenceStatusOf } from '@/lib/presence';
import { useRealtimeStore } from '@/stores/realtime-store';

import type { Friend } from '@/lib/friends';
import type { Presence, PresenceStatus } from '@/lib/presence';

type FriendsSlotProps = {
  /**
   * Under 1024 px the social panel is a full-screen `aria-modal` overlay ([FS-0]). Opening a
   * player page from here without closing it would leave the visitor BEHIND that overlay, on
   * a page they cannot reach — so every navigating link calls this, exactly like the panel's
   * own "my profile" link already does. `undefined` on desktop, where the rail is permanent.
   */
  onNavigate?: () => void;
  /**
   * Posts a sentence in the ONE live region of the rail, which `SocialPanel` owns and mounts
   * (see the comment there). This slot deliberately has no `role="status"` of its own: the
   * rail is on screen on every authenticated page, so a region per slot would compete with
   * the page's own region and with the three slots still to come.
   */
  announce: (text: string) => void;
  /**
   * Opens the conversation with that friend ([FS-3]). The panel owns "which conversation is
   * open" — this slot only says WHO, because the Messages tab it switches to is a sibling
   * that this slot cannot reach.
   */
  onOpenConversation: (friend: Friend) => void;
};

/**
 * The "Friends" tab of the social rail: who my friends are, which of them are connected right
 * now, and the two relationship actions (remove, block).
 *
 * 🔑 TWO SOURCES, JOINED AT RENDER. The list itself is server data (TanStack Query, one HTTP
 * call) and presence is live client state (the realtime store fed by the single WebSocket of
 * [FS-0]). A friend connecting must NOT refetch the list — it only moves a row from one group
 * to the other, which is what `splitByPresence` does on the next render.
 */
export function FriendsSlot({ onNavigate, announce, onOpenConversation }: FriendsSlotProps) {
  const { data, isPending, isError, refetch } = useFriends();
  const onlineFriendIds = useRealtimeStore((state) => state.onlineFriendIds);
  const hasPresenceSnapshot = useRealtimeStore((state) => state.hasPresenceSnapshot);
  const connectionState = useRealtimeStore((state) => state.connectionState);

  const [friendToRemove, setFriendToRemove] = useState<Friend | null>(null);
  const [friendToBlock, setFriendToBlock] = useState<Friend | null>(null);
  const remove = useRemoveFriend();
  const block = useBlockUser();

  /**
   * Landing point for the focus when a confirmed action destroys the row — and with it the
   * "⋮" button that opened the dialog. Without it the browser has nothing to restore to and
   * drops focus on `<body>`, sending a keyboard user back to the top of the page.
   *
   * It is the SLOT's heading and not a group's, because a group can vanish too: removing the
   * only online friend takes the whole "Online" section with it.
   *
   * 🔑 AND THAT HEADING IS VISIBLE, which is the point. Parked on a `sr-only` title, focus
   * came back from the dialog onto a node nobody can see: a sighted keyboard user just
   * watched the focus ring VANISH with no idea where the next Tab would start. `SectionTitle`
   * is the repo's idiom for exactly this — a visible `<h2>`, `tabIndex={-1}` so it never
   * joins the tab order, and a `focus-ring` when script sends focus to it.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Read ONCE for the whole list rather than per row: it names the page the player profile
  // goes back to, and it is the same page for every row.
  const backFrom = useBackFrom();

  const friends = data?.friends ?? [];

  /**
   * 🚨 FOCUS IS PARKED ON THE HEADING **BEFORE** THE DIALOG OPENS, and this is not
   * belt-and-braces — without it the confirmation loses focus for good.
   *
   * `ConfirmDialog` remembers `document.activeElement` at `showModal()` time and, on close,
   * only falls back to `returnFocusRef` when that element is GONE from the DOM. Here the
   * element that was clicked is a menu item that the very same render unmounts, so by the
   * time the effect runs the active element is already `<body>` — which is connected, always.
   * The fallback would therefore never fire and the platform would "restore" focus to
   * `<body>`, dropping a keyboard user at the top of the page.
   *
   * Parking focus on the slot's own heading first makes the opener a node that survives
   * everything, so the platform restores it by itself — on cancel as well as on success.
   */
  function askToRemove(friend: Friend) {
    headingRef.current?.focus();
    // Both mutations are shared by every row, so a failure left over from another row would
    // otherwise print its message inside this brand-new dialog.
    remove.reset();
    setFriendToBlock(null);
    setFriendToRemove(friend);
  }

  function askToBlock(friend: Friend) {
    headingRef.current?.focus();
    block.reset();
    setFriendToRemove(null);
    setFriendToBlock(friend);
  }

  function confirmRemove() {
    const friend = friendToRemove;
    if (!friend) return;

    // 🚨 `friendshipId`, NOT `friend.id`: the relation, not the person. Both are strings, so
    // the mix-up compiles perfectly and answers 404 forever.
    remove.mutate(friend.friendshipId, {
      onSuccess: () => {
        setFriendToRemove(null);
        announce(`@${friend.pseudo} was removed from your friends.`);
      },
    });
  }

  function confirmBlock() {
    const friend = friendToBlock;
    if (!friend) return;

    // Here it IS the person's id — blocking is about the account, not about the relation.
    block.mutate(friend.id, {
      onSuccess: () => {
        setFriendToBlock(null);
        announce(`@${friend.pseudo} was blocked and removed from your friends.`);
      },
    });
  }

  const confirming = friendToRemove !== null || friendToBlock !== null;

  return (
    <div
      className="flex flex-col gap-3 p-3"
      onKeyDown={(event) => {
        /**
         * 🚨 WHILE A CONFIRMATION IS OPEN, KEYS STOP HERE. Under 1024 px this panel is a
         * hand-rolled `aria-modal` overlay whose Escape *and* Tab handlers live on
         * `document` (`MobileHeader`) — and its "a child dialog is open" guard looks for a
         * `[role="dialog"]` ATTRIBUTE, which a native `<dialog>` does not carry. Left alone:
         * Escape would close the confirmation AND the whole panel, and the overlay's own tab
         * trap would fight the one the browser already gives a modal `<dialog>`, stranding
         * focus on its last button.
         *
         * Nothing else in the slot can receive a key while the modal is up (the rest of the
         * document is inert), so stopping here costs nothing and cannot mask a shortcut.
         */
        if (confirming) event.stopPropagation();
      }}
    >
      {/* Names the tab ON SCREEN — the tab strip above is icon-only, so without this line
          nothing written says which tab is open — and doubles as the focus landing point
          when a confirmed action destroys the row that had focus (see `headingRef`). It is
          rendered outside `FriendsContent` so it survives every state, including the empty
          one an action can switch to. */}
      <SectionTitle headingRef={headingRef}>Friends</SectionTitle>

      <FriendsContent
        friends={friends}
        isPending={isPending}
        isError={isError}
        onRetry={() => {
          // `void`: a refetch failure is already reflected by `isError`, and an unhandled
          // rejection in a click handler is a console error — a project-rejection criterion.
          void refetch();
        }}
        presenceStatus={presenceStatusOf(hasPresenceSnapshot, connectionState)}
        onlineFriendIds={onlineFriendIds}
        backFrom={backFrom}
        onNavigate={onNavigate}
        onMessage={onOpenConversation}
        onRemove={askToRemove}
        onBlock={askToBlock}
      />

      <ConfirmDialog
        open={friendToRemove !== null}
        title="Remove this friend?"
        description={
          <>
            <strong className="text-text-primary">@{friendToRemove?.pseudo}</strong> will be
            removed from your friends list. They are not told about it, and either of you can
            send a new friend request later.
          </>
        }
        confirmLabel="Remove friend"
        pending={remove.isPending}
        error={remove.isError ? removeFriendErrorMessage(remove.error) : null}
        onConfirm={confirmRemove}
        onCancel={() => {
          remove.reset();
          setFriendToRemove(null);
        }}
        returnFocusRef={headingRef}
      />

      {/* A second instance rather than one dialog with swapped copy: same pattern as the team
          page, and it keeps each dialog's text tied to the state that opens it. */}
      <ConfirmDialog
        open={friendToBlock !== null}
        title="Block this player?"
        description={
          <>
            <strong className="text-text-primary">@{friendToBlock?.pseudo}</strong> will no
            longer be able to message you or send you a friend request, and blocking also ends
            your friendship.
          </>
        }
        confirmLabel="Block player"
        pending={block.isPending}
        error={block.isError ? blockUserErrorMessage(block.error) : null}
        onConfirm={confirmBlock}
        onCancel={() => {
          block.reset();
          setFriendToBlock(null);
        }}
        returnFocusRef={headingRef}
      />
    </div>
  );
}

type FriendsContentProps = {
  friends: Friend[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  presenceStatus: PresenceStatus;
  onlineFriendIds: string[];
  backFrom: ReturnType<typeof useBackFrom>;
  onNavigate?: () => void;
  onMessage: (friend: Friend) => void;
  onRemove: (friend: Friend) => void;
  onBlock: (friend: Friend) => void;
};

/**
 * Loading / error / empty / loaded, extracted so the four states are visible side by side
 * instead of buried in early returns that would also take the live region above with them.
 */
function FriendsContent({
  friends,
  isPending,
  isError,
  onRetry,
  presenceStatus,
  onlineFriendIds,
  backFrom,
  onNavigate,
  onMessage,
  onRemove,
  onBlock,
}: FriendsContentProps) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {/* Three boxes the height of a real row, so the panel does not jump when the data
            lands. `aria-hidden`: the sentence below is what a screen reader needs, not this. */}
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            aria-hidden="true"
            className="h-13 animate-pulse rounded-control bg-surface-card"
          />
        ))}
        <p className="text-xs text-text-muted">Loading your friends…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <FormMessage className="text-sm">Could not load your friends.</FormMessage>
        <InlineButton onClick={onRetry}>
          <RotateCw aria-hidden="true" className="size-3" />
          Try again
        </InlineButton>
      </div>
    );
  }

  if (friends.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-text-secondary">No friends yet.</p>
        <p className="text-xs text-text-muted">
          Use the “Add friend” tab to find players and send them a request.
        </p>
      </div>
    );
  }

  const rowProps = { backFrom, onNavigate, onMessage, onRemove, onBlock };

  /**
   * ⚠️ NO SNAPSHOT = NO SPLIT. The store drops `hasPresenceSnapshot` while the socket
   * reconnects, and the ids it still holds are the ones from BEFORE the drop. Sorting them
   * into "Online" and "Offline" would state, in the app's own voice, something the server has
   * not confirmed — and the honest half of that lie (everyone offline) is the one users would
   * act on. So the list stays whole, unordered by presence.
   *
   * What CHANGES between the two cases is only what we say about it: a first connection is
   * still in progress (nothing to report), a lost one is a real limitation of the screen.
   */
  if (presenceStatus !== 'ready') {
    return (
      <div className="flex flex-col gap-2">
        {presenceStatus === 'waiting' ? (
          // Deliberately NOT a Callout: this is the normal first second of the page, not a
          // warning to frame in a box. Same muted one-liner as the loading state above, so
          // the two reads as one continuous "still coming" rather than as an incident.
          <p className="text-xs text-text-muted">Checking who is online…</p>
        ) : (
          // True for both cases that get here — a connection that dropped and is retrying,
          // and one that was refused and will not come back. "Reconnecting…" would be a guess
          // on the second. No `role`: this is a state of the screen, not the result of an
          // action, and the rail already owns exactly one live region (`SocialPanel`).
          <Callout tone="muted" className="px-3 py-2 text-xs">
            Who is online is not available right now.
          </Callout>
        )}
        <FriendList
          friends={sortedByPseudo(friends)}
          label="Friends"
          presence="unknown"
          {...rowProps}
        />
      </div>
    );
  }

  const { online, offline } = splitByPresence(friends, onlineFriendIds);

  return (
    <div className="flex flex-col gap-4">
      {/* The online group is rendered EVEN WHEN EMPTY: "who can I play with right now" is the
          question this tab is opened for, and an absent section answers it only by implication. */}
      <FriendGroup
        title={`Online — ${online.length}`}
        listLabel="Friends online"
        friends={online}
        presence="online"
        emptyText="Nobody is online right now."
        {...rowProps}
      />
      {/* The offline group, on the other hand, disappears when it is empty: everyone is
          already listed above, so an empty "Offline" line would be pure noise. */}
      <FriendGroup
        title={`Offline — ${offline.length}`}
        listLabel="Friends offline"
        friends={offline}
        presence="offline"
        {...rowProps}
      />
    </div>
  );
}

type FriendGroupProps = {
  title: string;
  listLabel: string;
  friends: Friend[];
  presence: Presence;
  /** When set, an empty group still renders its heading plus this sentence. */
  emptyText?: string;
  backFrom: ReturnType<typeof useBackFrom>;
  onNavigate?: () => void;
  onMessage: (friend: Friend) => void;
  onRemove: (friend: Friend) => void;
  onBlock: (friend: Friend) => void;
};

function FriendGroup({ title, listLabel, friends, emptyText, ...rest }: FriendGroupProps) {
  if (friends.length === 0 && !emptyText) return null;

  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>{title}</SectionTitle>
      {friends.length === 0 ? (
        <p className="text-xs text-text-muted">{emptyText}</p>
      ) : (
        <FriendList friends={friends} label={listLabel} {...rest} />
      )}
    </div>
  );
}

type FriendListProps = {
  friends: Friend[];
  /** Names the list so a screen reader hears WHICH one it entered — there are two. */
  label: string;
  presence: Presence;
  backFrom: ReturnType<typeof useBackFrom>;
  onNavigate?: () => void;
  onMessage: (friend: Friend) => void;
  onRemove: (friend: Friend) => void;
  onBlock: (friend: Friend) => void;
};

function FriendList({ friends, label, presence, ...rest }: FriendListProps) {
  return (
    // `role="list"` is explicit: Tailwind's preflight drops the marker and Safari then drops
    // the list semantics with it.
    <ul role="list" aria-label={label} className="flex flex-col gap-0.5">
      {friends.map((friend) => (
        <FriendRow key={friend.friendshipId} friend={friend} presence={presence} {...rest} />
      ))}
    </ul>
  );
}

type FriendRowProps = {
  friend: Friend;
  presence: Presence;
  backFrom: ReturnType<typeof useBackFrom>;
  onNavigate?: () => void;
  onMessage: (friend: Friend) => void;
  onRemove: (friend: Friend) => void;
  onBlock: (friend: Friend) => void;
};

/**
 * One friend: a link to their profile, plus the actions menu.
 *
 * 🔑 THE ROW IS NOT ENTIRELY CLICKABLE, and that is the whole reason the pseudo is a link.
 * The repo's rule is "every pseudo leads to its player page, unless the line around it is
 * already a link" — nesting an interactive element inside an `<a>` is invalid HTML that
 * browsers repair by silently splitting the DOM. So the link and the "⋮" button are SIBLINGS
 * inside the `<li>` (the idiom `RosterChips` settled on), `focus-within` lights the whole row
 * when either one takes keyboard focus, and the menu is never swallowed by the link.
 */
function FriendRow({
  friend,
  presence,
  backFrom,
  onNavigate,
  onMessage,
  onRemove,
  onBlock,
}: FriendRowProps) {
  // `||` and not `??`: the API types `displayName` as nullable, but an account that has one
  // and clears it stores an EMPTY STRING, which `??` would happily render as a blank line.
  // Same guard as the panel header, and it keeps this in step with the `&&` test below.
  const name = friend.displayName || friend.pseudo;

  return (
    <li className="flex items-center gap-1 rounded-control border border-transparent px-1.5 py-1 transition focus-within:border-border-subtle hover:border-border-subtle hover:bg-surface-card">
      <Link
        to="/players/$pseudo"
        params={{ pseudo: friend.pseudo }}
        // Names what the player page goes back to (the page the rail is sitting on).
        state={backFrom}
        onClick={onNavigate}
        className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-control py-1"
      >
        {/* The dot is purely visual, and only drawn when presence is actually KNOWN: the list
            this row belongs to is already named "Friends online" / "Friends offline", so a
            screen reader is told once, on entering the list, instead of on every single row. */}
        <PresenceAvatar
          src={friend.avatarUrl}
          fallback={friend.pseudo.slice(0, 2).toUpperCase()}
          presence={presence}
          className="size-9"
        />

        {/* `min-w-0` on BOTH this column and the link above it: without either one, a long
            pseudo refuses to shrink and pushes the "⋮" button out of the 312 px rail — or,
            in a flex row, collapses the name to 0 px. `truncate` only works below it. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text-primary">{name}</span>
          {/* The pseudo is shown under the display name only when they differ — repeating
              "Bob / @bob" on every row costs a line and says nothing. */}
          {friend.displayName && friend.displayName !== friend.pseudo && (
            <span className="block truncate text-xs text-text-muted">@{friend.pseudo}</span>
          )}
        </span>
      </Link>

      {/* Chatting is what this rail is FOR, so it gets its own control instead of hiding one
          click deep in the "⋮" menu. Named after the row for the same reason the menu is: a
          column of identical "Send a message" buttons says nothing about which one is which. */}
      <IconButton
        size="sm"
        aria-label={`Send a message to @${friend.pseudo}`}
        onClick={() => onMessage(friend)}
      >
        <MessageCircle className="size-4" aria-hidden="true" />
      </IconButton>

      <ActionMenu
        // Named after the row: eight buttons called "Actions" are indistinguishable to
        // anyone browsing by controls.
        label={`Actions for @${friend.pseudo}`}
        items={[
          {
            id: 'remove',
            label: 'Remove friend',
            tone: 'danger',
            icon: <UserMinus className="size-4 shrink-0" aria-hidden="true" />,
            onSelect: () => onRemove(friend),
          },
          {
            id: 'block',
            label: 'Block player',
            tone: 'danger',
            icon: <ShieldBan className="size-4 shrink-0" aria-hidden="true" />,
            onSelect: () => onBlock(friend),
          },
        ]}
      />
    </li>
  );
}
