/*
 * One entry of a match history, as a card — the layout used below `sm`, where the table left
 * 426 px of itself outside the viewport and hid the opponent and the status behind a scroll.
 *
 * Mounted INSTEAD of `MatchRow`, never alongside it (a JS media query, not `sm:hidden`), so a
 * screen reader is never handed the whole history twice. What the two share: `match-entry.tsx`.
 */

import { Card } from '@/components/ui/card';
import {
  CancelSlotButton,
  MatchDateLink,
  MatchOpponentLink,
  useMatchEntry,
} from '@/components/matches/match-entry';
import { MatchStatusPill } from '@/components/matches/MatchStatusPill';
import { eloDeltaClass } from '@/components/matches/match-status';
import { formatEloDelta } from '@/lib/match-detail';
import { formatScore } from '@/lib/match-history';
import { EM_DASH, cn } from '@/lib/utils';

import type { MatchEntryProps, MatchHistoryMatch } from '@/components/matches/match-entry';

export function MatchCard<M extends MatchHistoryMatch>({
  match,
  opponent,
  lineup,
  showLineup,
  ladder,
  showLadder,
  showActions = false,
  onCancelSlot,
  canOpenSheet = false,
}: MatchEntryProps<M>) {
  const { accentClass, disputed, opponentName, muted, onEntryClick } = useMatchEntry({
    match,
    opponent,
    canOpenSheet,
  });

  return (
    <li>
      <Card
        onClick={onEntryClick}
        className={cn(
          'flex flex-col gap-3 border-l-2 p-3',
          accentClass,
          /** THE DISPUTE TINT IS AN OVERLAY, NOT A BACKGROUND, and that is not a detail. */
          disputed &&
            'relative isolate before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-card before:bg-arena-red/5',
          canOpenSheet && 'cursor-pointer hover:bg-surface-card',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className={cn('font-mono text-xs text-text-secondary', muted)}>
            <MatchDateLink match={match} opponentName={opponentName} canOpenSheet={canOpenSheet} />
          </span>
          <MatchStatusPill match={match} />
        </div>

        <p className={cn('text-base font-bold wrap-break-word', muted)}>
          <MatchOpponentLink opponent={opponent} />
        </p>

        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          {showLadder && (
            <div className="min-w-0">
              {/* NOT `text-text-muted`: 4.23:1 on a card, under AA — see `MatchRow`. */}
              <dt className="label-caps text-text-secondary">Ladder</dt>
              <dd className={cn('font-semibold wrap-break-word text-text-primary', muted)}>
                {ladder ? `${ladder.game} · ${ladder.format}` : EM_DASH}
              </dd>
            </div>
          )}

          {showLineup && (
            <div className="min-w-0">
              <dt className="label-caps text-text-secondary">Line-up</dt>
              <dd className={cn('font-mono wrap-break-word text-text-secondary', muted)}>
                {lineup ?? EM_DASH}
              </dd>
            </div>
          )}

          <div>
            <dt className="label-caps text-text-secondary">Score</dt>
            <dd className="font-mono font-bold tabular-nums">{formatScore(match.score)}</dd>
          </div>

          <div>
            <dt className="label-caps text-text-secondary">Elo</dt>
            <dd className={cn('font-mono font-bold tabular-nums', eloDeltaClass(match.eloDelta))}>
              {formatEloDelta(match.eloDelta)}
            </dd>
          </div>
        </dl>

        {showActions && (
          <div className="flex justify-end empty:hidden">
            <CancelSlotButton match={match} onCancelSlot={onCancelSlot} />
          </div>
        )}
      </Card>
    </li>
  );
}
