import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';

import { InlineButton } from '@/components/ui/inline-button';
import { MatchStatusPill } from '@/components/matches/MatchStatusPill';
import { matchAccentClass, matchStatusView } from '@/components/matches/match-status';
import { formatEloDelta, formatMatchDate } from '@/lib/match-detail';
import { formatLineup, formatScore, isCancellableSlot } from '@/lib/team-detail';
import { EM_DASH, cn } from '@/lib/utils';

import type { TeamMatch } from '@/lib/team-detail';

type MatchRowProps = {
  match: TeamMatch;
  /** The whole column is dropped when no match carries a line-up (visitor response). */
  showLineup: boolean;
  /**
   * Whether the table has an actions column at all. Decided ONCE by the table (so every
   * `<td>` count matches its `<th>` count), not row by row.
   */
  showActions?: boolean;
  /** Captain only. A row that is not an open slot renders an empty cell, never a button. */
  onCancelSlot?: (match: TeamMatch) => void;
  /**
   * FT-4A — may this row open its match sheet?
   *
   * Decided ONCE by the table, from the server's own `isMember`: a member reaches the sheet
   * of EVERY match of his team (a slot he opened, a match being played, a dispute he is part
   * of), a visitor only of a completed one — which is exactly the guard of
   * `GET /matches/{id}`. Offering the others to a visitor would guarantee a 403 and a red
   * line in the console.
   */
  canOpenSheet?: boolean;
};

export function MatchRow({
  match,
  showLineup,
  showActions = false,
  onCancelSlot,
  canOpenSheet = false,
}: MatchRowProps) {
  const { tone } = matchStatusView(match);
  // A finished match is the only one carrying a RESULT — that is what drives the row's
  // emphasis, and it is deliberately NOT the same question as "can it be opened".
  const hasResult = match.status === 'completed';
  const date = formatMatchDate(match.scheduledAt);
  const opponentName = match.opponent?.name;
  const disputed = match.disputeStatus === 'open' || match.status === 'disputed';
  const eloDelta = match.eloDelta;
  // A row without a result is toned down — but only its NEUTRAL cells. Dimming the whole
  // row also dimmed the status pill, and dropped the "Disputed" pill to 3.07:1 contrast:
  // the one row the design wants to shout became the least readable of the page.
  const muted = hasResult ? undefined : 'opacity-70';
  // A row with no opponent NAME has nothing to hang the link on, so the DATE cell carries it
  // instead — one link per row, never two competing targets.
  // ⚠️ A visitor CAN reach this branch, contrary to what this comment used to claim. The
  // backend hides matches with a single side from a visitor (`sides.length === 2`), not
  // matches without an opponent name — and `opponent` also comes back null when the other
  // team was dissolved after the match. A visitor therefore gets the date link on a finished
  // match whose opponent is gone. That is the RIGHT behaviour (a finished match's sheet is
  // readable by any account since B15), so nothing to fix here beyond the claim itself.
  const linkOnDate = canOpenSheet && !opponentName;

  return (
    <tr
      className={cn(
        'border-t border-border-subtle',
        disputed && 'bg-arena-red/5',
        canOpenSheet && 'hover:bg-surface-card',
      )}
    >
      <td
        className={cn(
          'border-l-2 px-3 py-3 font-mono text-xs whitespace-nowrap text-text-secondary',
          matchAccentClass(tone),
          muted,
        )}
      >
        {linkOnDate ? (
          <Link
            to="/matches/$matchId"
            params={{ matchId: match.id }}
            aria-label={`Match sheet of the slot of ${formatMatchDate(match.scheduledAt, 'long')}`}
            // `-my-1.5 py-1.5` lifts the hit area from 14 px to 26 px WITHOUT changing the row's
            // height: WCAG 2.5.8 wants 24 px, and this link is a standalone target, not a word
            // inside a sentence — the "Inline" exception does not cover it.
            className="focus-ring -my-1.5 inline-flex items-center py-1.5 underline-offset-4 hover:underline"
          >
            {date}
          </Link>
        ) : (
          date
        )}
      </td>

      <td className={cn('px-3 py-3 font-bold', muted)}>
        {opponentName ? (
          canOpenSheet ? (
            <Link
              to="/matches/$matchId"
              params={{ matchId: match.id }}
              aria-label={`Match sheet against ${opponentName}, ${date}`}
              className="focus-ring underline-offset-4 hover:underline"
            >
              {opponentName}
            </Link>
          ) : (
            opponentName
          )
        ) : (
          /* Kept to a dash: the "Open slot" pill on the same row already says nobody has
             accepted, and a sentence here wrapped the row over three lines. */
          <span className="font-normal text-text-muted">{EM_DASH}</span>
        )}
      </td>

      {showLineup && (
        <td className={cn('px-3 py-3 font-mono text-xs text-text-muted', muted)}>
          {/* Truncated on purpose: a long pseudo used to push the Status column out of
              the visible area, and the status is what the row is read for. */}
          <span
            className="block max-w-24 truncate"
            title={match.lineup ? formatLineup(match.lineup.self) : undefined}
          >
            {match.lineup ? formatLineup(match.lineup.self) : EM_DASH}
          </span>
        </td>
      )}

      <td className="px-3 py-3 font-mono font-bold tabular-nums whitespace-nowrap">
        {formatScore(match.score)}
      </td>

      <td
        className={cn(
          'px-3 py-3 text-right font-mono font-bold tabular-nums',
          eloDelta === null || eloDelta === 0
            ? 'text-text-muted'
            : eloDelta < 0
              ? 'text-arena-red'
              : 'text-success',
        )}
      >
        {formatEloDelta(eloDelta)}
      </td>

      <td className="px-3 py-3 text-right whitespace-nowrap">
        <MatchStatusPill match={match} />
      </td>

      {showActions && (
        // Last column, no visible header (the buttons name themselves). `w-px` makes the
        // column collapse to its content so it never steals width from Opponent.
        <td className="w-px px-3 py-3 text-right whitespace-nowrap">
          {/* An accepted match cannot be cancelled: offering the button would guarantee a
              409 and a red line in the console. */}
          {onCancelSlot && isCancellableSlot(match) ? (
            <InlineButton
              tone="danger"
              onClick={() => onCancelSlot(match)}
              aria-label={`Cancel the slot of ${formatMatchDate(match.scheduledAt, 'long')}`}
            >
              <X aria-hidden="true" className="size-3" />
              Cancel
            </InlineButton>
          ) : null}
        </td>
      )}
    </tr>
  );
}
