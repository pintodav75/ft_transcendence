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

import type { FormEvent, Ref, SetStateAction, UIEvent } from 'react';
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
  /** Posts a sentence in the ONE live region of the rail, which `SocialPanel` owns and mounts. */
  announce: (text: string) => void;
  /**
   * Under 1024 px the social panel is a full-screen `aria-modal` overlay, so the link
   * to the partner's profile must close it — otherwise the visitor lands behind the overlay.
   */
  onNavigate?: () => void;
  /** Handle on the composer, so the panel can focus it when the conversation is (re)opened. */
  inputRef?: Ref<HTMLInputElement>;
  /** THE DRAFT IS NOT HELD HERE, and that is deliberate. */
  draft: string;
  /** Writes this conversation's draft in the panel. */
  onDraftChange: (partnerId: string, value: SetStateAction<string>) => void;
  /** Tells the panel whether a send of ours is waiting for the server. */
  onSendInFlightChange?: (partnerId: string, inFlight: boolean) => void;
  /** `false` while the rail is showing another tab. */
  isVisible?: boolean;
  /** Called at unmount if a send is still waiting for its acknowledgement. */
  onSendAbandoned?: () => void;
};

/** ONE direct-message conversation: header, log, composer. */
export function ChatConversation({
  partner,
  onClose,
  announce,
  onNavigate,
  inputRef,
  draft,
  onDraftChange,
  isVisible = true,
  onSendAbandoned,
  onSendInFlightChange,
}: ChatConversationProps) {
  const meId = useAuthStore((state) => state.user?.id);
  const connectionState = useRealtimeStore((state) => state.connectionState);
  const onlineFriendIds = useRealtimeStore((state) => state.onlineFriendIds);
  const hasPresenceSnapshot = useRealtimeStore((state) => state.hasPresenceSnapshot);
  const { data, isPending, isError, error, refetch } = useConversation(partner.id);

  /** Everything the socket delivered for THIS conversation while the component was mounted. */
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  /**
   * HOW A SEND IS TIED TO ITS ACKNOWLEDGEMENT — the server offers no correlation id, so this is
   * a decision, and here it is in full.
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
   * Local face of the panel's draft store — same signature as a `useState` setter, so every
   * call site below reads exactly as it did when the state lived here.
   */
  const setDraft = useCallback(
    (value: SetStateAction<string>) => onDraftChange(partner.id, value),
    [onDraftChange, partner.id],
  );

  /** A CONVERSATION BEHIND ANOTHER TAB SAYS NOTHING. */
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
       * AN ACKNOWLEDGEMENT CAN ARRIVE AFTER THE 10 s NET — a backend that restarts mid-send is
       * enough.
       */
      if (lostSendRef.current !== acknowledgedContent) return;

      lostSendRef.current = null;
      setSendError(null);
      setDraft((current) => (current === acknowledgedContent ? '' : current));
    },
    [clearSendTimer, setDraft],
  );

  /** The send did not make it. */
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
    [clearSendTimer, setDraft],
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
          // racing a refetch).
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
  // warning, and the console has to stay empty).
  useEffect(() => clearSendTimer, [clearSendTimer]);

  /** CLOSED WITH A SEND STILL IN FLIGHT. */
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

  /** AND WHILE WE ARE STILL HERE, THE REFUSAL IS OURS. */
  useEffect(() => {
    if (!onSendInFlightChange) return;

    onSendInFlightChange(partner.id, isSending);

    return () => onSendInFlightChange(partner.id, false);
  }, [isSending, onSendInFlightChange, partner.id]);

  const messages = mergeMessages(data?.messages ?? [], liveMessages);
  const lastMessageId = messages.at(-1)?.id;
  const loadErrorMessage = conversationErrorMessage(error);

  /**
   * The two refusals of this screen are DISPLAYED by `FormMessage`, which carries no live role
   * inside the rail (one region for the whole panel, and `SocialPanel` owns it — a region
   * mounted together with its text is not reliably read anyway).
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
    // `isVisible` IS A REAL DEPENDENCY: a hidden tab has no layout, so `scrollHeight` is 0
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

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-text-primary">
              {partnerName}
            </span>
            <span className="block truncate text-xs text-text-secondary">

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

      {isError && messages.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle bg-surface-card-strong/60 px-3 py-2">
          <FormMessage role="presentation">{loadErrorMessage}</FormMessage>
          <InlineButton onClick={retryLoad}>
            <RotateCw aria-hidden="true" className="size-3" />
            Try again
          </InlineButton>
        </div>
      )}

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
          // owns exactly one live region.
          <p id={offlineNoticeId} className="text-xs text-text-secondary">
            You are offline — messages cannot be sent right now.
          </p>
        )}

        {isSending && <p className="text-xs text-text-secondary">Sending…</p>}

        {sendError && (
          // `role="presentation"`: `FormMessage` defaults to `role="alert"`, and the rail
          // declares ONE live region, which `SocialPanel` mounts empty and keeps mounted.
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
            // The refusal is heard ONCE as it lands; `aria-invalid` + this link are what make
            // it findable again on the next visit to the field, which is when it is acted on.
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

  /** Where the day changes, a separator is inserted. */
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
    // the list semantics with it.
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

                <span className="sr-only">{mine ? 'You:' : `${partnerName}:`}</span>

                <p className="whitespace-pre-wrap wrap-break-word text-sm">{message.content}</p>
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
