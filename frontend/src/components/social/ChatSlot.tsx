import { useEffect, useRef } from 'react';

import { ChatConversation } from '@/components/social/ChatConversation';
import { ConversationList } from '@/components/social/ConversationList';

import type { SetStateAction } from 'react';
import type { ChatPartner } from '@/lib/messages';

type ChatSlotProps = {
  /** The conversation to show INSIDE the panel, or `null` to show the list. */
  partner: ChatPartner | null;
  /** Opens (or brings forward) a conversation picked from the list. */
  onOpen: (partner: ChatPartner) => void;
  onClose: () => void;
  announce: (text: string) => void;
  onNavigate?: () => void;
  /** `false` while the rail shows another tab — this slot stays mounted behind it. */
  isVisible?: boolean;
  /** Bumped when the composer of the inline conversation should take the focus. */
  focusToken?: number;
  /** The panel's draft for `partner` — it is held there so it survives this slot's remounts. */
  draft: string;
  onDraftChange: (partnerId: string, value: SetStateAction<string>) => void;
  onSendAbandoned?: () => void;
  onSendInFlightChange?: (partnerId: string, inFlight: boolean) => void;
};

/**
 * The "Messages" tab of the social rail: the list of my conversations, and — under 1024 px only
 * — the open conversation itself.
 */
export function ChatSlot({
  partner,
  onOpen,
  onClose,
  announce,
  onNavigate,
  isVisible = true,
  focusToken = 0,
  draft,
  onDraftChange,
  onSendAbandoned,
  onSendInFlightChange,
}: ChatSlotProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const hadPartnerRef = useRef(false);

  /**
   * Closing the inline conversation destroys the button that had focus, and the platform then
   * drops it on `<body>` — a keyboard user is sent back to the top of the page.
   */
  useEffect(() => {
    if (hadPartnerRef.current && !partner) {
      headingRef.current?.focus();
    }

    hadPartnerRef.current = partner !== null;
  }, [partner]);

  // Same contract as a floating window: the composer takes the focus when the conversation is
  // explicitly opened, and only then.
  useEffect(() => {
    if (focusToken === 0) return;

    composerRef.current?.focus();
  }, [focusToken]);

  if (partner) {
    return (
      // `key`: switching partner must start from a clean slate — a new history and an empty
      // live buffer.
      <ChatConversation
        key={partner.id}
        partner={partner}
        onClose={onClose}
        announce={announce}
        onNavigate={onNavigate}
        inputRef={composerRef}
        draft={draft}
        onDraftChange={onDraftChange}
        isVisible={isVisible}
        onSendAbandoned={onSendAbandoned}
        onSendInFlightChange={onSendInFlightChange}
      />
    );
  }

  if (!isVisible) return null;

  return <ConversationList onOpen={onOpen} announce={announce} headingRef={headingRef} />;
}
