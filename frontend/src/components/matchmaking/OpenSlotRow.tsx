import { Link } from '@tanstack/react-router';
import { Swords } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { GameIcon } from '@/components/games/GameIcon';
import { Pill } from '@/components/ui/pill';
import { buttonClasses } from '@/components/ui/button-variants';
import { formatMatchDate } from '@/lib/match-detail';

import type { ReactNode, Ref } from 'react';
import type { OpenSlot, SlotRefusal } from '@/lib/matchmaking';

type OpenSlotRowProps = {
  slot: OpenSlot;
  /**
   * Why the API would refuse me this slot, already phrased — `null` when `canAccept` is true.
   * The row never re-decides it: the server is the only authority on that question.
   */
  refusal: SlotRefusal | null;
  /**
   * The action, when there is one. Three shapes, all decided by the caller:
   * a button (I can take it), a disabled one (my teams are still loading), or nothing at all.
   */
  action: ReactNode;
  /** The line-up panel of a 2v2+ acceptance, rendered INSIDE the row it belongs to. */
  children?: ReactNode;
};

/**
 * One open slot: game, format, ladder, kick-off — and either a way in or the reason there is
 * none.
 *
 * 🚨 THERE IS NO OPPONENT ON THIS ROW, AND THERE IS NONE IN THE PAYLOAD EITHER. Slot anonymity
 * is a product decision (B5b): the creating team and the maps are deliberately withheld, so a
 * slot is accepted WITHOUT knowing who opened it. That is what stops opponent-shopping and
 * protects the Elo. Nothing here may ever grow a name, an avatar or a rating.
 *
 * 🔑 A REFUSED SLOT IS STILL SHOWN, WITHOUT A BUTTON. Hiding it would answer "what can I
 * play?" and lose "why can I not play?" — and offering a button the API would refuse writes a
 * red line in the Chrome console, which is a project-rejection criterion.
 */
export function OpenSlotRow({ slot, refusal, action, children }: OpenSlotRowProps) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-control border border-border-subtle bg-surface-card p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
        {/* Hidden from assistive tech: `GameAsset` always gives its image (or its fallback)
            an accessible name, and the game is already spelled out in text right beside it —
            a screen reader would otherwise announce it twice per row, fifty rows deep. */}
        <span aria-hidden="true" className="shrink-0">
          <GameIcon
            gameId={slot.gameId}
            name={slot.gameName}
            className="size-10 rounded-control"
          />
        </span>

        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-bold text-text-primary">{slot.ladderName}</p>
          <p className="truncate text-xs label-caps text-text-muted">{slot.gameName}</p>
        </div>

        <Pill tone="muted">{slot.format}</Pill>

        <p className="font-mono text-sm tabular-nums text-text-secondary">
          {/* The column has no header — this list is not a table — so each row carries its
              own unit, exactly as the podium rows do for Elo. */}
          <span className="sr-only">Kick-off </span>
          {formatMatchDate(slot.scheduledAt, 'long')}
        </p>

        {action ? <div className="ml-auto">{action}</div> : null}
      </div>

      {refusal ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
          <span>{refusal.text}</span>
          {refusal.action?.kind === 'create-team' && (
            // The creation form arrives with this ladder already picked ([F-GAMES]) — the
            // point of a remedy link is that it lands ON the fix, not near it.
            <Link
              to="/teams"
              search={{ create: refusal.action.ladderId }}
              className={buttonClasses('ghost')}
            >
              {refusal.action.label}
            </Link>
          )}
          {refusal.action?.kind === 'open-team' && (
            <Link
              to="/teams/$teamId"
              params={{ teamId: refusal.action.teamId }}
              className={buttonClasses('ghost')}
            >
              {refusal.action.label}
            </Link>
          )}
        </p>
      ) : null}

      {children}
    </li>
  );
}

type AcceptButtonProps = {
  slot: OpenSlot;
  /** Disabled while the data the acceptance needs (my roster) is still on its way. */
  disabled?: boolean;
  /** Only on a 2v2+ slot, whose button opens a line-up panel rather than acting at once. */
  expanded?: boolean;
  controls?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
};

/**
 * The one button of an acceptable row.
 *
 * Its `aria-label` starts with the visible word so voice control still works, and carries the
 * ladder and the kick-off: fifty buttons all called "Accept" tell a screen-reader user
 * nothing about which one he is on.
 */
export function AcceptSlotButton({
  slot,
  disabled = false,
  expanded,
  controls,
  buttonRef,
  onClick,
}: AcceptButtonProps) {
  return (
    <Button
      ref={buttonRef}
      disabled={disabled}
      aria-expanded={expanded}
      // Only while the panel exists: pointing at a missing id is invalid ARIA.
      aria-controls={expanded ? controls : undefined}
      aria-label={`Accept the slot on ${slot.ladderName} at ${formatMatchDate(slot.scheduledAt, 'long')}`}
      onClick={onClick}
    >
      <Swords aria-hidden="true" className="mr-2 size-4" />
      Accept
    </Button>
  );
}
