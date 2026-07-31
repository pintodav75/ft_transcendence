import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';

import { PresenceAvatar } from '@/components/social/PresenceAvatar';
import { FormMessage } from '@/components/ui/form-message';
import { InlineButton } from '@/components/ui/inline-button';
import { SectionTitle } from '@/components/ui/section-title';
import {
  CONVERSATIONS_KEY,
  bumpConversation,
  conversationsErrorMessage,
  useConversations,
} from '@/lib/messages';
import { presenceOf, presenceStatusOf } from '@/lib/presence';
import { formatRailTime } from '@/lib/rail-time';
import { realtimeClient } from '@/lib/realtime-client';
import { useAuthStore } from '@/stores/auth-store';
import { useRealtimeStore } from '@/stores/realtime-store';

import type { Ref } from 'react';
import type { Presence } from '@/lib/presence';
import type { ChatPartner, Conversation, ConversationsResponse } from '@/lib/messages';

type ConversationListProps = {
  /** Opens (or brings forward) that conversation. The panel owns "which ones are open". */
  onOpen: (partner: ChatPartner) => void;
  /**
   * Posts a sentence in the ONE live region of the rail, which `SocialPanel` owns and mounts.
   * This component declares no `role="status"` / `aria-live` of its own — see the comment in
   * `SocialPanel`, and the two review passes it already cost on [FS-1] and [FS-3].
   */
  announce: (text: string) => void;
  /** Landing point for the focus when the mobile conversation is closed and the list returns. */
  headingRef?: Ref<HTMLHeadingElement>;
};

/**
 * The list of my conversations: every friend I have exchanged at least one message with, most
 * recent first.
 *
 * 🚨 MOUNTED ONLY WHILE THE MESSAGES TAB IS ON SCREEN. The rail lives on every authenticated
 * page and its Messages panel is kept mounted even when hidden (that is what saves an open
 * conversation's draft), so this component — and the GET inside it — is what `ChatSlot` mounts
 * and unmounts with the tab's visibility. Same discipline as [FS-3]'s history.
 *
 * 🔑 TWO SOURCES, JOINED AT RENDER, exactly like the friends list: the rows come from
 * `GET /messages/conversations` (TanStack Query) and the connected dot comes from the realtime
 * store. A friend connecting reorders nothing and refetches nothing.
 *
 * ⚠️ NO UNREAD COUNT, deliberately: the server tracks no read receipts, so a badge here would
 * be a number nobody computed. It would also be wrong the moment a window is already open.
 */
export function ConversationList({ onOpen, announce, headingRef }: ConversationListProps) {
  const queryClient = useQueryClient();
  const meId = useAuthStore((state) => state.user?.id);
  const onlineFriendIds = useRealtimeStore((state) => state.onlineFriendIds);
  const hasPresenceSnapshot = useRealtimeStore((state) => state.hasPresenceSnapshot);
  const connectionState = useRealtimeStore((state) => state.connectionState);
  const { data, isPending, isError, error, refetch } = useConversations();

  /**
   * 🚨 THE LIST REORDERS ITSELF, IT DOES NOT REFETCH. Every message — received, or acknowledged
   * after I sent one — moves its conversation back to the top with the new text as preview. A
   * refetch per message would be one HTTP round trip per keystroke-worth of chat, and would
   * still show the old order until it landed.
   *
   * This rewrites the QUERY CACHE rather than holding a second ordered list beside it: there is
   * one source of truth for the order, and coming back to the tab (which refetches) cannot then
   * disagree with what was on screen.
   *
   * The one case it cannot handle is a FIRST message with a friend who has no row yet: the
   * event carries ids, never the avatar and display name a row needs. That one refetches.
   */
  useEffect(() => {
    if (!meId) return;

    return realtimeClient.subscribe((event) => {
      if (event.type !== 'message' && event.type !== 'message_sent') return;

      const current = queryClient.getQueryData<ConversationsResponse>(CONVERSATIONS_KEY);
      // Nothing cached yet means the first fetch is still in flight; it will land already
      // ordered by the server, which is the same answer this would have computed.
      if (!current) return;

      const next = bumpConversation(current.conversations, event.message, meId);

      if (next === null) {
        // `void`: an unhandled rejection would be a console error, and a failed refetch is
        // already reflected by the query's own error state.
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
        return;
      }

      // Same reference = already at the top with that very message (a duplicate frame, a
      // refetch landing just after the live event). Writing it back would re-render every row.
      if (next === current.conversations) return;

      queryClient.setQueryData<ConversationsResponse>(CONVERSATIONS_KEY, { conversations: next });
    });
  }, [meId, queryClient]);

  /**
   * 🚨 THE TRANSPORT REPLAYS NOTHING — the same rule `ChatConversation` lives by. Whatever
   * arrived while the socket was down never reaches the listener above, so the order on screen
   * would stay frozen at the moment of the cut for as long as this tab is left open. A
   * reconnection therefore RE-ASKS the server rather than waiting for events that will never
   * come. (`useConversations` keeps `refetchOnReconnect` off precisely so this is the only
   * signal, instead of two requests for one event.)
   */
  const wasDisconnectedRef = useRef(false);
  useEffect(() => {
    if (connectionState === 'reconnecting' || connectionState === 'closed') {
      wasDisconnectedRef.current = true;
      return;
    }

    if (connectionState === 'open' && wasDisconnectedRef.current) {
      wasDisconnectedRef.current = false;
      // `void`: an unhandled rejection in an effect is a console error, and a failed refetch is
      // already reflected by the query's own error state.
      void refetch();
    }
  }, [connectionState, refetch]);

  const errorMessage = conversationsErrorMessage(error);

  /**
   * The refusal is DISPLAYED by `FormMessage` with no live role of its own (one region per
   * rail, and it is the panel's), so it is spoken from here — same idiom as `ChatConversation`.
   */
  useEffect(() => {
    if (!isError) return;

    announce(errorMessage);
  }, [announce, errorMessage, isError]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Names the tab ON SCREEN — the tab strip above is icon-only — and doubles as the focus
          landing point when the mobile conversation is closed (see `ChatSlot`). Rendered
          outside the content below so it survives every state, including the empty one. */}
      <SectionTitle headingRef={headingRef}>Messages</SectionTitle>

      <ConversationListContent
        conversations={data?.conversations ?? []}
        meId={meId}
        isPending={isPending}
        isError={isError}
        errorMessage={errorMessage}
        onRetry={() => {
          void refetch();
        }}
        presenceStatus={presenceStatusOf(hasPresenceSnapshot, connectionState)}
        onlineFriendIds={onlineFriendIds}
        onOpen={onOpen}
      />
    </div>
  );
}

type ConversationListContentProps = {
  conversations: Conversation[];
  meId?: string;
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  presenceStatus: ReturnType<typeof presenceStatusOf>;
  onlineFriendIds: string[];
  onOpen: (partner: ChatPartner) => void;
};

/**
 * Loading / error / empty / loaded, extracted so the four states are visible side by side
 * instead of buried in early returns that would also take the heading above with them.
 */
function ConversationListContent({
  conversations,
  meId,
  isPending,
  isError,
  errorMessage,
  onRetry,
  presenceStatus,
  onlineFriendIds,
  onOpen,
}: ConversationListContentProps) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {/* Three boxes the height of a real row, so the panel does not jump when the data
            lands. `aria-hidden`: the sentence below is what a screen reader needs. */}
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            aria-hidden="true"
            className="h-13 animate-pulse rounded-control bg-surface-card"
          />
        ))}
        <p className="text-xs text-text-muted">Loading your conversations…</p>
      </div>
    );
  }

  // 🚨 WHAT THERE IS TO READ COMES FIRST. TanStack keeps `data` when a REFETCH fails, so
  // `isError` goes true on a list that is perfectly usable; wiping it for a background failure
  // would be worse than the failure. Same order of tests as `ConversationLog`.
  if (conversations.length === 0) {
    if (isError) {
      return (
        <div className="flex flex-col items-start gap-2">
          {/* `role="presentation"`: one live region per rail, and it is `SocialPanel`'s. The
              red tone stays, the speaking is done by the effect above. */}
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
        <p className="text-sm text-text-secondary">No conversations yet.</p>
        {/* A friend I have never written to has no row here — that is the server's rule, not
            an omission — so the way to start one is worth naming. */}
        <p className="text-xs text-text-muted">
          Open the “Friends” tab and use the message button on a friend to start chatting.
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

      {/* `role="list"` is explicit: Tailwind's preflight drops the marker and Safari then drops
          the list semantics with it. */}
      <ul role="list" aria-label="Conversations" className="flex flex-col gap-0.5">
        {conversations.map((conversation) => (
          <ConversationRow
            // The FRIEND's id, not the last message's: the row is the conversation, and keying
            // it on the message would rebuild the whole row on every new message.
            key={conversation.friend.id}
            conversation={conversation}
            meId={meId}
            presence={presenceOf(conversation.friend.id, onlineFriendIds, presenceStatus)}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  );
}

type ConversationRowProps = {
  conversation: Conversation;
  meId?: string;
  presence: Presence;
  onOpen: (partner: ChatPartner) => void;
};

/**
 * One conversation.
 *
 * 🔑 THE WHOLE ROW IS ONE BUTTON, and that is why the pseudo is NOT a link here. The repo's
 * rule is "every pseudo leads to its player page, unless the line around it is already
 * clickable" — and this line has exactly one thing to do, which is to open the conversation.
 * Nesting a link inside it would be invalid HTML that browsers repair by splitting the DOM.
 * The profile is one click away in the conversation header, which already links it.
 */
function ConversationRow({ conversation, meId, presence, onOpen }: ConversationRowProps) {
  const { friend, lastMessage } = conversation;
  // `||` and not `??`: an account that had a display name and cleared it stores an EMPTY
  // STRING, which `??` would happily render as a blank line.
  const name = friend.displayName || friend.pseudo;
  const mine = lastMessage.senderId === meId;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(friend)}
        // `min-h-11`: 44 px is the smallest comfortable touch target, and this row IS the
        // control — under 1024 px it is what opens the conversation with a thumb.
        className="focus-ring flex min-h-11 w-full items-center gap-2.5 rounded-control border border-transparent px-1.5 py-1.5 text-left transition hover:border-border-subtle hover:bg-surface-card"
      >
        {/* The dot is purely visual (see `PresenceAvatar`), so presence is stated in text
            below — this list mixes online and offline friends, so unlike the friends tab
            there is no list name to carry it. */}
        <PresenceAvatar
          src={friend.avatarUrl}
          fallback={friend.pseudo.slice(0, 2).toUpperCase()}
          presence={presence}
          className="size-9"
        />

        {/* `min-w-0` on this column AND on the truncating children: without it a long pseudo
            refuses to shrink and pushes the timestamp out of the 312 px rail. */}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
              {/* Says what the button DOES; the visible text alone would read as a bare name. */}
              <span className="sr-only">Open the conversation with </span>
              {name}
              {presence !== 'unknown' && (
                <span className="sr-only">, {presence === 'online' ? 'online' : 'offline'}</span>
              )}
            </span>
            {/* Without these two words the button reads "…with Bob, online 14:32 You: ok" —
                a bare clock time dropped in the middle of a sentence, which says nothing
                about what it dates. `sr-only` is out of flow, so the row's layout is
                untouched. */}
            <span className="sr-only">, last message at </span>
            <time
              dateTime={lastMessage.createdAt}
              className="shrink-0 text-xs text-text-muted"
            >
              {formatRailTime(lastMessage.createdAt)}
            </time>
          </span>

          {/* Who spoke last is half of what a preview says — "ok" from them and "ok" from me
              call for opposite reactions. */}
          <span className="block truncate text-xs text-text-secondary">
            {mine && <span className="text-text-muted">You: </span>}
            {lastMessage.content}
          </span>
        </span>
      </button>
    </li>
  );
}
