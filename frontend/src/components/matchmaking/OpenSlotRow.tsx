/**
 * One open slot: game, format, ladder, kick-off — and either a way in or the reason there is
 * none.
 */

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
  refusal: SlotRefusal | null;
  action: ReactNode;
  children?: ReactNode;
};

export function OpenSlotRow({ slot, refusal, action, children }: OpenSlotRowProps) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-control border border-border-subtle bg-surface-card p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
        <span aria-hidden="true" className="shrink-0">
          <GameIcon gameId={slot.gameId} name={slot.gameName} className="size-10 rounded-control" />
        </span>

        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-bold text-text-primary">{slot.ladderName}</p>
          <p className="truncate text-xs label-caps text-text-muted">{slot.gameName}</p>
        </div>

        <Pill tone="muted">{slot.format}</Pill>

        <p className="font-mono text-sm tabular-nums text-text-secondary">
          <span className="sr-only">Kick-off </span>
          {formatMatchDate(slot.scheduledAt, 'long')}
        </p>

        {action ? <div className="ml-auto">{action}</div> : null}
      </div>

      {refusal ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
          <span>{refusal.text}</span>
          {refusal.action?.kind === 'create-team' && (
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
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
};

/**
 * The one button of an acceptable row. Its aria-label carries the ladder and the kick-off:
 * fifty buttons all called "Accept" say nothing about which one you are on.
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
      aria-controls={expanded ? controls : undefined}
      aria-label={`Accept the slot on ${slot.ladderName} at ${formatMatchDate(slot.scheduledAt, 'long')}`}
      onClick={onClick}
    >
      <Swords aria-hidden="true" className="mr-2 size-4" />
      Accept
    </Button>
  );
}
