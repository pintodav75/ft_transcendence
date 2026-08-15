import { useRef, useState } from 'react';
import { MessageCircle, RotateCw, ShieldBan, UserMinus } from 'lucide-react';

import { PersonRow } from '@/components/social/PersonRow';
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
  /** Under 1024 px the social panel is a full-screen `aria-modal` overlay. */
  onNavigate?: () => void;
  /**
   * Posts a sentence in the ONE live region of the rail, which `SocialPanel` owns and mounts
   * (see the comment there).
   */
  announce: (text: string) => void;
  /** Opens the conversation with that friend. */
  onOpenConversation: (friend: Friend) => void;
};

/**
 * The "Friends" tab of the social rail: who my friends are, which of them are connected right
 * now, and the two relationship actions (remove, block).
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
   * Landing point for the focus when a confirmed action destroys the row — and with it the "⋮"
   * button that opened the dialog.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Read ONCE for the whole list rather than per row: it names the page the player profile goes
  // back to, and it is the same page for every row.
  const backFrom = useBackFrom();

  const friends = data?.friends ?? [];

  /**
   * FOCUS IS PARKED ON THE HEADING **BEFORE** THE DIALOG OPENS, and this is not belt-and-braces
   * — without it the confirmation loses focus for good.
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

    // `friendshipId`, NOT `friend.id`: the relation, not the person. Both are strings, so the
    // mix-up compiles perfectly and answers 404 forever.
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
        /** WHILE A CONFIRMATION IS OPEN, KEYS STOP HERE. */
        if (confirming) event.stopPropagation();
      }}
    >

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
   * NO SNAPSHOT = NO SPLIT. The store drops `hasPresenceSnapshot` while the socket reconnects,
   * and the ids it still holds are the ones from BEFORE the drop.
   */
  if (presenceStatus !== 'ready') {
    return (
      <div className="flex flex-col gap-2">
        {presenceStatus === 'waiting' ? (
          // Deliberately NOT a Callout: this is the normal first second of the page, not a
          // warning to frame in a box.
          <p className="text-xs text-text-muted">Checking who is online…</p>
        ) : (
          // True for both cases that get here — a connection that dropped and is retrying, and
          // one that was refused and will not come back.
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

      <FriendGroup
        title={`Online — ${online.length}`}
        listLabel="Friends online"
        friends={online}
        presence="online"
        emptyText="Nobody is online right now."
        {...rowProps}
      />

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

/** One friend: a link to their profile, plus the two actions. */
function FriendRow({
  friend,
  presence,
  backFrom,
  onNavigate,
  onMessage,
  onRemove,
  onBlock,
}: FriendRowProps) {
  return (
    <PersonRow
      person={friend}
      presence={presence}
      backFrom={backFrom}
      onNavigate={onNavigate}
      actions={
        <>

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
        </>
      }
    />
  );
}
