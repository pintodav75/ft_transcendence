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
   * Missing key = nothing typed yet.
   */
  drafts: Record<string, string>;
  onDraftChange: (partnerId: string, value: SetStateAction<string>) => void;
  onSendAbandoned?: () => void;
  onSendInFlightChange?: (partnerId: string, inFlight: boolean) => void;
};

/**
 * The floating conversation windows, DESKTOP ONLY.
 *
 * 🚨 IT IS `SocialPanel` THAT DECIDES WHETHER THIS IS RENDERED AT ALL, from a real
 * `matchMedia` read — not a CSS `hidden lg:flex`. Under 1024 px the social panel is a
 * hand-rolled `aria-modal` overlay whose Escape and Tab handlers sit on `document` and whose
 * "a child dialog is open" guard looks for a `[role="dialog"]` ATTRIBUTE. Stacking a floating
 * window over it would replay that trap, so the mobile layout keeps the conversation inside
 * the panel instead. A CSS gate would leave the windows MOUNTED-BUT-INVISIBLE on a phone,
 * which is the one failure mode worse than the bug it guards against.
 *
 * 🔑 GEOMETRY FROM THE MOCKUP (`vsmode-home-demo.html`, `#chatwrap` / `.chat`): 268 × 340 px
 * windows, 12 px apart, anchored past the social rail so they sit BESIDE it and never under it.
 * That offset is NOT a copied number: it is the rail's own width token plus the 16 px page
 * padding of `AuthenticatedLayout` and the same 12 px gutter (`var(--spacing) * 7` = 1.75 rem),
 * so widening the rail moves the windows with it instead of sliding them underneath. Only
 * `right`/`bottom` are anchored, so the strip grows LEFTWARDS and the newest window is the one
 * nearest the rail, where the click that opened it just happened. Colours, radius and shadow
 * are ours, never the mockup's literals.
 *
 * 🚨 THEY CANNOT LEAVE THE SCREEN, and that is arithmetic rather than a clamp: the panel caps
 * how many are shown at once by viewport width (1 / 2 / 3), and even the tightest of the three
 * breakpoints leaves 112 px between the leftmost window and the left rail. The three cases are
 * worked out one by one above `FLOATING_QUERY` in `SocialPanel`.
 */
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
    // `z-40` is below the mobile overlay (`z-50`) it can never coexist with, and above
    // everything a page draws.
    // The `right` offset is DERIVED, never retyped: `--spacing-social-rail` is the very token
    // `SocialRail` sizes itself with, and the 7 units are the page padding (4) plus the gutter
    // (3). Change the rail's width and the windows follow it instead of sliding underneath.
    <div className="pointer-events-none fixed bottom-4 right-[calc(var(--spacing-social-rail)+var(--spacing)*7)] z-40 flex items-end gap-3">
      {conversations.map((partner) => (
        <ChatWindow
          key={partner.id}
          partner={partner}
          onClose={() => onClose(partner.id)}
          announce={announce}
          // 0 = "not you": every window is rendered with a token, and only the one being
          // asked for sees it change. Keying focus on the array itself would move the caret
          // into a window every time another one is opened or closed.
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

/**
 * The chrome of ONE floating window. `ChatConversation` is dropped in untouched: it is
 * self-contained and `h-full` precisely so it can be mounted here ([FS-3] wrote it that way).
 */
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
    // A NAMED region, because there can be three of them and a screen reader browsing
    // landmarks otherwise finds three identical anonymous boxes. `<section aria-label>` and
    // not `role="dialog"`: nothing here is modal, and claiming a dialog would promise a focus
    // trap and an Escape key that these windows deliberately do not have — the page behind
    // them stays fully usable, which is the whole point of a floating window.
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
