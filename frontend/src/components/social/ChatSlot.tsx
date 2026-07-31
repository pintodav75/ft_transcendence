import { useEffect, useRef } from 'react';

import { ChatConversation } from '@/components/social/ChatConversation';
import { ConversationList } from '@/components/social/ConversationList';

import type { SetStateAction } from 'react';
import type { ChatPartner } from '@/lib/messages';

type ChatSlotProps = {
  /**
   * The conversation to show INSIDE the panel, or `null` to show the list.
   *
   * 🚨 ALWAYS `null` ON DESKTOP: there the conversations live in floating windows
   * (`ChatWindowStack`), and this tab only ever shows the list. It is only under 1024 px —
   * where a floating window would fight the panel's hand-rolled modal — that a conversation
   * takes over the panel.
   */
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
 * The "Messages" tab of the social rail: the list of my conversations, and — under 1024 px
 * only — the open conversation itself.
 *
 * 🚨 THE LIST IS MOUNTED ONLY WHILE THE TAB IS VISIBLE, and that is not a detail. This slot is
 * kept mounted behind the other tabs (that is what saves an open conversation's realtime buffer
 * and its send in flight — the draft itself is the panel's, so that it also survives the
 * remounts a resize forces), and the rail itself is mounted on every authenticated page — so a
 * list rendered unconditionally would fire `GET /messages/conversations` on every screen of the
 * app. Same discipline as [FS-3]'s history, mounted only once a partner has actually been chosen.
 *
 * The inline conversation, on the other hand, IS kept mounted while hidden: that is exactly
 * what it is here for.
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
   * drops it on `<body>` — a keyboard user is sent back to the top of the page. The heading of
   * the list is the landing point: it is visible (a focus ring on a `sr-only` node is a ring
   * that vanishes), it NAMES where the focus landed, and the list it names is exactly what
   * replaces the conversation.
   *
   * `hadPartnerRef` is what makes this fire on a REAL close and nowhere else: it only reacts to
   * a partner going away, so a tab switch — which leaves this slot mounted and simply hides it
   * — steals no focus. On desktop `partner` is always `null`, so it never fires at all.
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
      // live buffer. Re-opening the SAME friend keeps the very same instance, so a conversation
      // is never duplicated. The DRAFT is not part of that slate any more: it belongs to the
      // panel, one per partner, so it follows the partner rather than the mount.
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
