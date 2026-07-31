import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { RotateCw, SendHorizontal, X } from 'lucide-react';

import { PresenceAvatar } from '@/components/social/PresenceAvatar';
import { FormMessage } from '@/components/ui/form-message';
import { IconButton } from '@/components/ui/icon-button';
import { InlineButton } from '@/components/ui/inline-button';
import { Input } from '@/components/ui/input';
import { useBackFrom } from '@/lib/back-navigation';
import {
  MAX_MESSAGE_LENGTH,
  belongsToConversation,
  conversationErrorMessage,
  formatMessageDayLabel,
  formatMessageTime,
  isSameDay,
  mergeMessages,
  sendErrorMessage,
  useConversation,
} from '@/lib/messages';
import { presenceOf, presenceStatusOf } from '@/lib/presence';
import { realtimeClient } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useRealtimeStore } from '@/stores/realtime-store';

import type { FormEvent, Ref, UIEvent } from 'react';
import type { ChatPartner, Message } from '@/lib/messages';

/**
 * How long a send waits for its acknowledgement before it is declared lost.
 *
 * The server answers on the same socket in a couple of milliseconds, so this is not a
 * latency budget: it is the ONLY way out of a socket that died between `send()` and the
 * acknowledgement. Without it the composer would stay locked forever on a connection that
 * never says anything again.
 */
const SEND_TIMEOUT_MS = 10_000;

/** Enough of a message for a screen reader to know whether it is worth switching to. */
const SPOKEN_PREVIEW_LENGTH = 120;

/** Below this distance from the bottom, a new message scrolls the log; above it, it does not. */
const STICK_TO_BOTTOM_PX = 80;

type ChatConversationProps = {
  partner: ChatPartner;
  /** Closes the conversation. The owner (`SocialPanel`) is the one holding "which one is open". */
  onClose: () => void;
  /**
   * Posts a sentence in the ONE live region of the rail, which `SocialPanel` owns and mounts.
   * This component deliberately declares no `role="status"` / `role="log"` of its own: the rail
   * is on screen on every authenticated page, so a second region would compete with the one the
   * visited page already declares as "the only one of this screen".
   */
  announce: (text: string) => void;
  /**
   * Under 1024 px the social panel is a full-screen `aria-modal` overlay ([FS-0]), so the link
   * to the partner's profile must close it — otherwise the visitor lands behind the overlay.
   * `undefined` on desktop, where the rail is permanent.
   */
  onNavigate?: () => void;
  /** Handle on the composer, so the panel can focus it when the conversation is (re)opened. */
  inputRef?: Ref<HTMLInputElement>;
  /**
   * `false` while the rail is showing another tab. The conversation is KEPT MOUNTED behind it
   * (that is what saves the draft and the realtime buffer), so it has to know it is off screen:
   * it then announces nothing, and re-scrolls to the bottom when it comes back.
   */
  isVisible?: boolean;
  /**
   * Called at unmount if a send is still waiting for its acknowledgement. Whoever mounted this
   * component outlives it, so it can catch the refusal that will arrive seconds later.
   */
  onSendAbandoned?: () => void;
};

/**
 * ONE direct-message conversation: header, log, composer. Self-contained and height-fluid
 * (`h-full`), so [FS-4] can mount it in a floating window without touching a line of it.
 *
 * 🔑 TWO SOURCES, ONE LIST. The history comes from `GET /messages/{friendId}` (TanStack Query)
 * and everything that happens while the screen is open comes from the single WebSocket of
 * [FS-0]. They OVERLAP — the same message is in both after a refetch — so they are merged and
 * deduplicated by `id` at render (`mergeMessages`). Nothing is ever appended to the query cache.
 *
 * 🚨 THE TRANSPORT REPLAYS NOTHING. Whatever arrives while the socket is down is on the server
 * and nowhere else, so a reconnection REFETCHES rather than waiting for events that will never
 * come. Same reason the query has no `staleTime`: re-opening a conversation must re-ask the
 * server rather than trust a buffer that stopped being fed while it was closed.
 */
export function ChatConversation({
  partner,
  onClose,
  announce,
  onNavigate,
  inputRef,
  isVisible = true,
  onSendAbandoned,
}: ChatConversationProps) {
  const meId = useAuthStore((state) => state.user?.id);
  const connectionState = useRealtimeStore((state) => state.connectionState);
  const onlineFriendIds = useRealtimeStore((state) => state.onlineFriendIds);
  const hasPresenceSnapshot = useRealtimeStore((state) => state.hasPresenceSnapshot);
  const { data, isPending, isError, error, refetch } = useConversation(partner.id);

  /** Everything the socket delivered for THIS conversation while the component was mounted. */
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  /**
   * 🚨 HOW A SEND IS TIED TO ITS ACKNOWLEDGEMENT — the server offers no correlation id, so this
   * is a decision, and here it is in full.
   *
   * `message_sent` carries the message as stored, nothing else. So the composer allows exactly
   * ONE send in flight (which is also the "no double send" rule), remembers the content it just
   * sent, and treats the next `message_sent` carrying that same content as its acknowledgement.
   * Two identical drafts sent in a row cannot be confused: the second one cannot start before
   * the first is acknowledged.
   *
   * 🔑 AND THE ACKNOWLEDGEMENT IS NOT WHAT DISPLAYS THE MESSAGE. It only unlocks the composer.
   * The message itself is displayed by the ordinary live path, exactly like an incoming one, so
   * there is no optimistic bubble to reconcile — which is precisely the class of bug that shows
   * a message twice. The cost is the round trip before my own message appears; on the local
   * socket it is a few milliseconds.
   *
   * A ref and not state: this is read inside the socket listener, where a state value captured
   * at subscribe time would be stale.
   */
  const pendingSendRef = useRef<string | null>(null);
  /**
   * The content of the last send DECLARED LOST (the 10 s net expired, or the socket dropped).
   * Kept because "lost" can be wrong: see `resolvePendingSend`.
   */
  const lostSendRef = useRef<string | null>(null);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  /** False as soon as the reader has scrolled up: a new message must not yank them back down. */
  const stickToBottomRef = useRef(true);
  /** True once the socket has been seen down, so the reconnection knows it has to catch up. */
  const wasDisconnectedRef = useRef(false);
  const inputId = useId();
  const offlineNoticeId = useId();
  const sendErrorId = useId();
  const backFrom = useBackFrom();

  /**
   * 🚨 A CONVERSATION BEHIND ANOTHER TAB SAYS NOTHING. It stays mounted there, so it keeps
   * receiving messages on a screen nobody is looking at, and announcing them would read a
   * stranger's sentence out of a panel a screen reader user cannot navigate to. Nothing is
   * lost: everything announced here is also WRITTEN on screen, and is read on the way back.
   *
   * A ref (mirrored by an effect) and not the prop itself: the subscription below must not be
   * torn down and rebuilt every time the rail changes tab.
   */
  const isVisibleRef = useRef(isVisible);
  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  const announceIfVisible = useCallback(
    (text: string) => {
      if (isVisibleRef.current) announce(text);
    },
    [announce],
  );

  const clearSendTimer = useCallback(() => {
    if (sendTimerRef.current === null) return;

    clearTimeout(sendTimerRef.current);
    sendTimerRef.current = null;
  }, []);

  const resolvePendingSend = useCallback(
    (acknowledgedContent: string) => {
      if (pendingSendRef.current === acknowledgedContent) {
        pendingSendRef.current = null;
        clearSendTimer();
        setIsSending(false);
        return;
      }

      /**
       * 🚨 AN ACKNOWLEDGEMENT CAN ARRIVE AFTER THE 10 s NET — a backend that restarts mid-send
       * is enough. The bubble is then displayed by the ordinary live path anyway, so leaving
       * the refusal up would show a DELIVERED message under a red "not sent", with its text
       * back in the composer. The user re-sends, and creates a real duplicate in the database.
       *
       * So a send declared lost is un-declared here: the refusal goes, and the field is emptied
       * — but only if it still holds that very text, since the user may have typed since.
       */
      if (lostSendRef.current !== acknowledgedContent) return;

      lostSendRef.current = null;
      setSendError(null);
      setDraft((current) => (current === acknowledgedContent ? '' : current));
    },
    [clearSendTimer],
  );

  /**
   * The send did not make it. The draft goes BACK IN THE FIELD — but only if the field is
   * empty: the user may have started typing something else during the round trip, and
   * overwriting that would be worse than losing the refused text.
   */
  const failPendingSend = useCallback(
    (message: string) => {
      const refusedContent = pendingSendRef.current;
      if (refusedContent === null) return;

      pendingSendRef.current = null;
      lostSendRef.current = refusedContent;
      clearSendTimer();
      setIsSending(false);
      setSendError(message);
      setDraft((current) => (current.length === 0 ? refusedContent : current));
    },
    [clearSendTimer],
  );

  // ------------------------------------------------------------- live events
  useEffect(() => {
    if (!meId) return;

    return realtimeClient.subscribe((event) => {
      if (event.type === 'message' || event.type === 'message_sent') {
        const message = event.message;
        // The socket carries the WHOLE session (other conversations, presence, notifications).
        if (!belongsToConversation(message, meId, partner.id)) return;

        setLiveMessages((current) =>
          // Guard against the same event being handled twice (a duplicate frame, a remount
          // racing a refetch). `mergeMessages` would dedup it anyway; keeping the buffer clean
          // costs one lookup and keeps it readable in the devtools.
          current.some((known) => known.id === message.id) ? current : [...current, message],
        );

        if (event.type === 'message_sent') {
          resolvePendingSend(message.content);
          return;
        }

        // Only for what SOMEBODY ELSE sent: announcing my own message back to me would read
        // every sentence twice. The log itself is not a live region (see `announce` above).
        announceIfVisible(
          `New message from @${partner.pseudo}: ${
            message.content.length > SPOKEN_PREVIEW_LENGTH
              ? `${message.content.slice(0, SPOKEN_PREVIEW_LENGTH)}…`
              : message.content
          }`,
        );
        return;
      }

      // The three refusals of `routes/chat.ts`. They carry no echo of what was refused, so the
      // only send they can possibly be about is the one in flight.
      if (event.type === 'error') {
        failPendingSend(sendErrorMessage(event.code));
      }
    });
  }, [announceIfVisible, failPendingSend, meId, partner.id, partner.pseudo, resolvePendingSend]);

  // ------------------------------------------------- reconnection = re-ask the server
  useEffect(() => {
    if (connectionState === 'reconnecting' || connectionState === 'closed') {
      wasDisconnectedRef.current = true;
      // Nothing will ever acknowledge a send made over a socket that is gone. Saying so now is
      // more honest than letting the 10 s timeout expire in silence.
      failPendingSend('Message not sent — the connection dropped. Try again.');
      return;
    }

    if (connectionState === 'open' && wasDisconnectedRef.current) {
      wasDisconnectedRef.current = false;
      // `void`: an unhandled rejection in an effect is a console error, and a failed refetch is
      // already reflected by the query's own error state.
      void refetch();
    }
  }, [connectionState, failPendingSend, refetch]);

  // Unmount: a timer left running would call `setState` on a component that is gone (a React
  // warning, and the console has to stay empty). `clearSendTimer` IS the cleanup function here.
  useEffect(() => clearSendTimer, [clearSendTimer]);

  /**
   * 🚨 CLOSED WITH A SEND STILL IN FLIGHT. The server's refusal ("you are not friends any
   * more", "you are blocked") lands on the socket seconds later, with this component gone and
   * nobody listening: the text would vanish and nothing would ever say why. The panel outlives
   * the conversation, so the watch is handed over to it.
   *
   * The callback is read through a ref so this effect can have EMPTY deps: it must fire its
   * cleanup at unmount and at no other moment — a parent re-creating the prop would otherwise
   * make it report an abandoned send in the middle of a perfectly live conversation.
   */
  const sendAbandonedRef = useRef(onSendAbandoned);
  useEffect(() => {
    sendAbandonedRef.current = onSendAbandoned;
  });
  useEffect(
    () => () => {
      if (pendingSendRef.current !== null) sendAbandonedRef.current?.();
    },
    [],
  );

  const messages = mergeMessages(data?.messages ?? [], liveMessages);
  const lastMessageId = messages.at(-1)?.id;
  const loadErrorMessage = conversationErrorMessage(error);

  /**
   * The two refusals of this screen are DISPLAYED by `FormMessage`, which carries no live role
   * inside the rail (one region for the whole panel, and `SocialPanel` owns it — a region
   * mounted together with its text is not reliably read anyway). So they are spoken from here.
   */
  useEffect(() => {
    if (!isError) return;

    announceIfVisible(loadErrorMessage);
  }, [announceIfVisible, isError, loadErrorMessage]);

  useEffect(() => {
    if (sendError === null) return;

    announceIfVisible(sendError);
  }, [announceIfVisible, sendError]);

  // Keyed on the LAST id, not on the array: the array is rebuilt at every render, and an effect
  // that depends on it would scroll on every keystroke in the composer.
  useEffect(() => {
    const log = logRef.current;
    // ⚠️ `isVisible` IS A REAL DEPENDENCY: a hidden tab has no layout, so `scrollHeight` is 0
    // there and scrolling would park the log at the TOP for the moment it comes back.
    if (!log || !isVisible || !stickToBottomRef.current) return;

    // Moves the scroll, never the focus — the caret stays where the user is typing.
    log.scrollTop = log.scrollHeight;
  }, [isVisible, lastMessageId]);

  function handleLogScroll(event: UIEvent<HTMLDivElement>) {
    const log = event.currentTarget;
    stickToBottomRef.current =
      log.scrollHeight - log.scrollTop - log.clientHeight < STICK_TO_BOTTOM_PX;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Double-send guard. The button is disabled too, but Enter does not go through the button.
    if (isSending) return;

    const content = draft.trim();
    // An empty message is refused in silence: every chat does, and there is nothing to explain.
    if (content.length === 0) return;

    if (content.length > MAX_MESSAGE_LENGTH) {
      setSendError(`Message too long — ${MAX_MESSAGE_LENGTH} characters maximum.`);
      return;
    }

    setSendError(null);

    // `false` = the socket is not open. Checked through the client rather than through
    // `connectionState` because the store can be one tick behind the real socket.
    if (!realtimeClient.sendMessage(partner.id, content)) {
      setSendError('Message not sent — you are offline.');
      return;
    }

    pendingSendRef.current = content;
    // A previous loss stops being this composer's business: whatever happens now is about the
    // send that just started, and a late acknowledgement of the old one must not clear it.
    lostSendRef.current = null;
    setIsSending(true);
    // Cleared right away so the composer feels immediate; `failPendingSend` puts it back if the
    // send turns out to have failed.
    setDraft('');
    stickToBottomRef.current = true;
    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      failPendingSend('Message not sent — the server did not confirm it. Try again.');
    }, SEND_TIMEOUT_MS);
  }

  function retryLoad() {
    void refetch();
  }

  const presence = presenceOf(
    partner.id,
    onlineFriendIds,
    presenceStatusOf(hasPresenceSnapshot, connectionState),
  );
  const isOffline = connectionState !== 'open';
  // `||` and not `??`: an account that had a display name and cleared it stores an EMPTY
  // STRING, which `??` would happily render as a blank line.
  const partnerName = partner.displayName || partner.pseudo;
  const remainingCharacters = MAX_MESSAGE_LENGTH - draft.length;
  const describedBy = [isOffline ? offlineNoticeId : null, sendError ? sendErrorId : null]
    .filter((id) => id !== null)
    .join(' ');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        {/* The pseudo leads to the player page, like every other pseudo in the app. It is a
            SIBLING of the close button, never its parent: an interactive element inside an
            `<a>` is invalid HTML that browsers repair by splitting the DOM. */}
        <Link
          to="/players/$pseudo"
          params={{ pseudo: partner.pseudo }}
          state={backFrom}
          onClick={onNavigate}
          className="focus-ring -m-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-control p-1 transition hover:bg-surface-card-strong"
        >
          <PresenceAvatar
            src={partner.avatarUrl}
            fallback={partner.pseudo.slice(0, 2).toUpperCase()}
            presence={presence}
            className="size-11"
          />
          {/* `min-w-0` on the column AND on the link: without either, a long pseudo refuses to
              shrink and pushes the close button out of the 312 px rail. */}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-text-primary">
              {partnerName}
            </span>
            <span className="block truncate text-xs text-text-secondary">
              {/* `unknown` shows the pseudo rather than a guess: the store keeps the ids it
                  knew BEFORE the socket dropped, and "Offline" would be a statement the server
                  never made. */}
              {presence === 'online' ? 'Online' : presence === 'offline' ? 'Offline' : `@${partner.pseudo}`}
            </span>
          </span>
        </Link>

        <IconButton
          aria-label={`Close the conversation with @${partner.pseudo}`}
          onClick={onClose}
        >
          <X className="size-5" aria-hidden="true" />
        </IconButton>
      </div>

      {/**
       * 🚨 A FAILED REFETCH DOES NOT EMPTY THE SCREEN. TanStack Query KEEPS `data` when a
       * refetch fails, so `isError` goes true on a conversation that is perfectly readable —
       * and it goes true often, since coming back from a cut and returning to the tab both
       * refetch. Wiping forty bubbles (plus everything the socket delivered since) for a
       * background failure would destroy the only catch-up path this screen has.
       *
       * So: a discreet line above the log while there is something to read, and the full
       * error screen only when there is nothing at all (`ConversationLog`).
       */}
      {isError && messages.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle bg-surface-card-strong/60 px-3 py-2">
          <FormMessage role="presentation">{loadErrorMessage}</FormMessage>
          <InlineButton onClick={retryLoad}>
            <RotateCw aria-hidden="true" className="size-3" />
            Try again
          </InlineButton>
        </div>
      )}

      {/* Focusable and NAMED: reading the history is the whole point of this screen, and a
          scroll container with no focusable descendant is skipped by the Tab key — the keyboard
          could only ever see the few bubbles that happened to be visible. `role="group"` and
          NOT `role="log"`: `log` is an implicit live region, and the rail allows exactly one. */}
      <div
        ref={logRef}
        onScroll={handleLogScroll}
        tabIndex={0}
        role="group"
        aria-label={`Conversation with ${partnerName}`}
        className="focus-ring min-h-0 flex-1 overflow-y-auto p-3"
      >
        <ConversationLog
          messages={messages}
          meId={meId}
          partnerName={partnerName}
          isPending={isPending}
          isError={isError}
          errorMessage={loadErrorMessage}
          onRetry={retryLoad}
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 border-t border-border-subtle p-3"
      >
        {isOffline && (
          // No `role`: this is a STATE of the screen, not the result of an action, and the rail
          // owns exactly one live region. The field points at it with `aria-describedby`, so
          // the reason the send button is disabled is heard on arrival in the field.
          <p id={offlineNoticeId} className="text-xs text-text-secondary">
            You are offline — messages cannot be sent right now.
          </p>
        )}

        {/* The draft leaves the field the instant it is sent, so without this the round trip
            looks like a message that simply evaporated. No `role="status"`: announced through
            the rail's own region like everything else here. */}
        {isSending && <p className="text-xs text-text-secondary">Sending…</p>}

        {sendError && (
          // `role="presentation"`: `FormMessage` defaults to `role="alert"`, and the rail
          // declares ONE live region, which `SocialPanel` mounts empty and keeps mounted. The
          // red tone stays, the speaking is done by the effect above.
          <FormMessage id={sendErrorId} role="presentation">
            {sendError}
          </FormMessage>
        )}

        {remainingCharacters <= 100 && (
          <p className="text-xs text-text-secondary">{remainingCharacters} characters left</p>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            Message @{partner.pseudo}
          </label>
          <Input
            id={inputId}
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              // The previous refusal is about text that is no longer there.
              setSendError(null);
            }}
            // Mirror of the server's `.max(1000)`, enforced by the platform: the browser also
            // truncates a paste, so the guard in `handleSubmit` is a belt on top of it.
            maxLength={MAX_MESSAGE_LENGTH}
            autoComplete="off"
            placeholder="Send a message…"
            // The refusal is heard ONCE as it lands; `aria-invalid` + this link are what make it
            // findable again on the next visit to the field, which is when it is acted on.
            aria-invalid={sendError !== null}
            aria-describedby={describedBy === '' ? undefined : describedBy}
            className="h-11 min-w-0 flex-1"
          />
          <IconButton
            type="submit"
            aria-label="Send message"
            disabled={draft.trim().length === 0 || isSending || isOffline}
            // The second half is not a duplicate: `IconButton` turns its icon grey on hover,
            // which on the one accent-coloured control of the rail reads as "disabled".
            className="text-action-primary-card-foreground hover:text-action-primary-card-foreground"
          >
            <SendHorizontal className="size-5" aria-hidden="true" />
          </IconButton>
        </div>
      </form>
    </div>
  );
}

type ConversationLogProps = {
  messages: Message[];
  meId?: string;
  partnerName: string;
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
};

/**
 * Loading / error / empty / loaded, extracted so the four states are visible side by side
 * instead of buried in early returns inside the layout above.
 *
 * 🚨 THE ORDER OF THE TESTS IS THE FIX: what there is to READ comes first, and `isError` only
 * decides between the error screen and the empty state. See the banner in the parent.
 */
function ConversationLog({
  messages,
  meId,
  partnerName,
  isPending,
  isError,
  errorMessage,
  onRetry,
}: ConversationLogProps) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {/* Alternating sides at the height of a real bubble, so the log does not jump when the
            history lands. `aria-hidden`: the sentence below is what a screen reader needs. */}
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            aria-hidden="true"
            className={cn(
              'h-9 w-2/3 animate-pulse rounded-card bg-surface-card-strong',
              row % 2 === 1 && 'self-end',
            )}
          />
        ))}
        <p className="text-xs text-text-secondary">Loading the conversation…</p>
      </div>
    );
  }

  if (messages.length === 0) {
    if (isError) {
      return (
        <div className="flex flex-col items-start gap-2">
          {/* `role="presentation"`: one live region per rail, and it is the panel's. */}
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
      <p className="text-sm text-text-secondary">
        No messages yet — say hello to {partnerName}.
      </p>
    );
  }

  /**
   * Where the day changes, a separator is inserted. It replaces the `title` the bubbles used
   * to carry: a tooltip only opens under a mouse pointer, so on a touch screen and at the
   * keyboard the full date simply did not exist — and a hundred messages spread over a week
   * all read as bare clock times, with nothing telling yesterday from today.
   */
  const rows = messages.map((message, index) => {
    const previous = index === 0 ? undefined : messages[index - 1];

    return {
      message,
      dayLabel:
        previous && isSameDay(previous.createdAt, message.createdAt)
          ? null
          : formatMessageDayLabel(message.createdAt),
    };
  });

  return (
    // `role="list"` is explicit: Tailwind's preflight drops the marker and Safari then drops
    // the list semantics with it. The accessible NAME is on the scroll container above, which
    // is the element the keyboard actually lands on — repeating it here would read it twice.
    <ul role="list" className="flex flex-col gap-1.5">
      {rows.map(({ message, dayLabel }) => {
        const mine = message.senderId === meId;

        return (
          <Fragment key={message.id}>
            {dayLabel !== null && (
              <li className="my-1 flex justify-center">
                <span className="rounded-full bg-surface-card-strong px-2 py-0.5 text-xs text-text-secondary">
                  {dayLabel}
                </span>
              </li>
            )}
            <li className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-card px-3 py-1.5',
                  mine
                    ? 'bg-action-primary text-action-primary-foreground'
                    : 'border border-border-subtle bg-surface-card-strong text-text-primary',
                )}
              >
                {/* Who said it. Visually obvious (side + colour), invisible to a screen reader
                    without this line — and reading twenty messages with no attribution is
                    unusable. */}
                <span className="sr-only">{mine ? 'You:' : `${partnerName}:`}</span>
                {/* `break-words` is what keeps a 300-character unbroken string inside a 312 px
                    rail; `whitespace-pre-wrap` preserves the line breaks another client may
                    send. */}
                <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                <time
                  dateTime={message.createdAt}
                  className={cn(
                    'mt-0.5 block text-xs',
                    mine ? 'text-action-primary-foreground/75' : 'text-text-secondary',
                  )}
                >
                  {formatMessageTime(message.createdAt)}
                </time>
              </div>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
