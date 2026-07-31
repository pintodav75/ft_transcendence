import { useEffect, useRef } from 'react';

import { ChatConversation } from '@/components/social/ChatConversation';
import { SectionTitle } from '@/components/ui/section-title';

import type { Ref } from 'react';
import type { ChatPartner } from '@/lib/messages';

type ChatSlotProps = {
  /** The one open conversation, or `null`. Owned by `SocialPanel` so it survives a tab switch. */
  partner: ChatPartner | null;
  onClose: () => void;
  announce: (text: string) => void;
  onNavigate?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  /** `false` while the rail shows another tab — this slot stays mounted behind it. */
  isVisible?: boolean;
  onSendAbandoned?: () => void;
};

/**
 * The "Messages" tab of the social rail.
 *
 * 🚨 ONE CONVERSATION AT A TIME, on purpose: [FS-4] owns the conversation LIST and the several
 * windows. Until then this tab is either empty or showing the conversation opened from the
 * friends list, which is also why nothing here fires a request while `partner` is `null` — the
 * rail is mounted on every authenticated page, so "just in case" would mean "on every screen".
 */
export function ChatSlot({
  partner,
  onClose,
  announce,
  onNavigate,
  inputRef,
  isVisible = true,
  onSendAbandoned,
}: ChatSlotProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hadPartnerRef = useRef(false);

  /**
   * Closing the conversation destroys the button that had focus, and the platform then drops
   * it on `<body>` — a keyboard user is sent back to the top of the page. The heading of the
   * empty state is the landing point: it is visible (a focus ring on a `sr-only` node is a
   * ring that vanishes), it NAMES where the focus landed, and it only exists once the
   * conversation is gone, which is exactly when it is needed.
   *
   * `hadPartnerRef` is what makes this fire on a REAL close and nowhere else: it only reacts
   * to a partner going away, so a tab switch — which now leaves this slot mounted and simply
   * hides it — steals no focus.
   */
  useEffect(() => {
    if (hadPartnerRef.current && !partner) {
      headingRef.current?.focus();
    }

    hadPartnerRef.current = partner !== null;
  }, [partner]);

  if (!partner) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {/* Names the tab ON SCREEN — the tab strip above is icon-only. */}
        <SectionTitle headingRef={headingRef}>Messages</SectionTitle>
        <p className="text-sm text-text-secondary">No conversation open.</p>
        <p className="text-xs text-text-secondary">
          Open the “Friends” tab and use the message button on a friend to start chatting.
        </p>
      </div>
    );
  }

  return (
    // `key`: switching partner must start from a clean slate — a new history, an empty live
    // buffer, no draft left over from the previous conversation. Re-opening the SAME friend
    // keeps the very same instance, so a conversation is never duplicated.
    <ChatConversation
      key={partner.id}
      partner={partner}
      onClose={onClose}
      announce={announce}
      onNavigate={onNavigate}
      inputRef={inputRef}
      isVisible={isVisible}
      onSendAbandoned={onSendAbandoned}
    />
  );
}
