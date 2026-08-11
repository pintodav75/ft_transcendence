/**
 * One entry of a match history, as a table row — the layout used from `sm` up. `MatchCard`
 * renders the same entry below `sm`; what they share lives in `match-entry.tsx`.
 */

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

export function MatchRow<M extends MatchHistoryMatch>({
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
    <tr
      className={cn(
        'border-t border-border-subtle',
        disputed && 'bg-arena-red/5',
        canOpenSheet && 'cursor-pointer hover:bg-surface-card',
      )}
      onClick={onEntryClick}
    >
      <td
        className={cn(
          'border-l-2 px-3 py-3 font-mono text-xs whitespace-nowrap text-text-secondary',
          accentClass,
          muted,
        )}
      >
        {/* The DATE carries the link — it is the keyboard and screen-reader access to the sheet. */}
        <MatchDateLink match={match} opponentName={opponentName} canOpenSheet={canOpenSheet} />
      </td>

      {showLadder && (
        // Two lines rather than one: the ladder's own name ("Counter-Strike 2 5v5") repeats the
        // format, and laying the game over it keeps the column narrow enough that the Status
        // column stays in view at the table's minimum width.
        <td className={cn('px-3 py-3 whitespace-nowrap', muted)}>

          <span className="block text-xs font-semibold text-text-primary">
            {ladder?.game ?? EM_DASH}
          </span>
          <span className="block text-xs text-text-secondary">{ladder?.format ?? EM_DASH}</span>
        </td>
      )}

      <td className={cn('px-3 py-3 font-bold', muted)}>
        <MatchOpponentLink opponent={opponent} />
      </td>

      {showLineup && (
        <td className={cn('px-3 py-3 font-mono text-xs text-text-muted', muted)}>

          <span className="block max-w-24 truncate" title={lineup}>
            {lineup ?? EM_DASH}
          </span>
        </td>
      )}

      <td className="px-3 py-3 font-mono font-bold tabular-nums whitespace-nowrap">
        {formatScore(match.score)}
      </td>

      <td
        className={cn(
          'px-3 py-3 text-right font-mono font-bold tabular-nums',
          eloDeltaClass(match.eloDelta),
        )}
      >
        {formatEloDelta(match.eloDelta)}
      </td>

      <td className="px-3 py-3 text-right whitespace-nowrap">
        <MatchStatusPill match={match} />
      </td>

      {showActions && (
        // Last column, no visible header (the button names itself). `w-px` makes the column
        // collapse to its content so it never steals width from Opponent.
        <td className="w-px px-3 py-3 text-right whitespace-nowrap">
          <CancelSlotButton match={match} onCancelSlot={onCancelSlot} />
        </td>
      )}
    </tr>
  );
}
