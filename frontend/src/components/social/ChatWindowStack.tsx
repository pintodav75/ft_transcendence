import { useEffect, useRef } from 'react';

import { ChatConversation } from '@/components/social/ChatConversation';

import type { SetStateAction } from 'react';
import type { ChatPartner } from '@/lib/messages';

export type ChatFocusRequest = {
  /** Which conversation should take the focus. */
  id: string;
  /** Bumped on every request, so asking twice for the same window fires twice. */
  seq: number;
};

type ChatWindowStackProps = {
  /** Oldest first — the order they are laid out in, left to right. */
  conversations: ChatPartner[];
  onClose: (partnerId: string) => void;
  announce: (text: string) => void;
  focusRequest: ChatFocusRequest | null;
  /**
   * One draft per partner, held by the panel: a window that drops out of the strip when the
   * viewport narrows is really unmounted, so its draft has to live somewhere that does not.
   */
  drafts: Record<string, string>;
  onDraftChange: (partnerId: string, value: SetStateAction<string>) => void;
  onSendAbandoned?: () => void;
  onSendInFlightChange?: (partnerId: string, inFlight: boolean) => void;
};

/** The floating conversation windows, DESKTOP ONLY. */
export function ChatWindowStack({
  conversations,
  onClose,
  announce,
  focusRequest,
  drafts,
  onDraftChange,
  onSendAbandoned,
  onSendInFlightChange,
}: ChatWindowStackProps) {
  if (conversations.length === 0) return null;

  return (
    // `pointer-events-none` on the strip, restored on each window: the 12 px gaps between
    // windows would otherwise be dead zones swallowing clicks meant for the page underneath.
    <div className="pointer-events-none fixed bottom-4 right-[calc(var(--spacing-social-rail)+var(--spacing)*7)] z-40 flex items-end gap-3">
      {conversations.map((partner) => (
        <ChatWindow
          key={partner.id}
          partner={partner}
          onClose={() => onClose(partner.id)}
          announce={announce}
          // 0 = "not you": every window is rendered with a token, and only the one being asked
          // for sees it change.
          focusToken={focusRequest?.id === partner.id ? focusRequest.seq : 0}
          draft={drafts[partner.id] ?? ''}
          onDraftChange={onDraftChange}
          onSendAbandoned={onSendAbandoned}
          onSendInFlightChange={onSendInFlightChange}
        />
      ))}
    </div>
  );
}

type ChatWindowProps = {
  partner: ChatPartner;
  onClose: () => void;
  announce: (text: string) => void;
  focusToken: number;
  draft: string;
  onDraftChange: (partnerId: string, value: SetStateAction<string>) => void;
  onSendAbandoned?: () => void;
  onSendInFlightChange?: (partnerId: string, inFlight: boolean) => void;
};

/** The chrome of ONE floating window. */
function ChatWindow({
  partner,
  onClose,
  announce,
  focusToken,
  draft,
  onDraftChange,
  onSendAbandoned,
  onSendInFlightChange,
}: ChatWindowProps) {
  const composerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusToken === 0) return;

    composerRef.current?.focus();
  }, [focusToken]);

  return (
    // A NAMED region, because there can be three of them and a screen reader browsing landmarks
    // otherwise finds three identical anonymous boxes.
    <section
      aria-label={`Chat with ${partner.displayName || partner.pseudo}`}
      className="pointer-events-auto flex h-85 max-h-[calc(100dvh-6rem)] w-67 flex-col overflow-hidden rounded-card border border-border-strong bg-surface-card shadow-card"
    >
      <ChatConversation
        partner={partner}
        onClose={onClose}
        announce={announce}
        inputRef={composerRef}
        draft={draft}
        onDraftChange={onDraftChange}
        onSendAbandoned={onSendAbandoned}
        onSendInFlightChange={onSendInFlightChange}
      />
    </section>
  );
}
