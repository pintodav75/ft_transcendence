import { Link } from '@tanstack/react-router';

import { MatchStatusPill } from '@/components/teams/detail/MatchStatusPill';
import { matchAccentClass, matchStatusView } from '@/components/teams/detail/match-status';
import {
  EM_DASH,
  formatEloDelta,
  formatLineup,
  formatMatchDate,
  formatScore,
} from '@/lib/team-detail';
import { cn } from '@/lib/utils';

import type { TeamMatch } from '@/lib/team-detail';

type MatchRowProps = {
  match: TeamMatch;
  /** The whole column is dropped when no match carries a line-up (visitor response). */
  showLineup: boolean;
};

export function MatchRow({ match, showLineup }: MatchRowProps) {
  const { tone } = matchStatusView(match);
  // Only a finished match has a sheet to open; the others stay dimmed and inert.
  const isOpenable = match.status === 'completed';
  const date = formatMatchDate(match.scheduledAt);
  const opponentName = match.opponent?.name;
  const disputed = match.disputeStatus === 'open' || match.status === 'disputed';
  const eloDelta = match.eloDelta;
  // A row without a result is toned down — but only its NEUTRAL cells. Dimming the whole
  // row also dimmed the status pill, and dropped the "Disputed" pill to 3.07:1 contrast:
  // the one row the design wants to shout became the least readable of the page.
  const muted = isOpenable ? undefined : 'opacity-70';

  return (
    <tr
      className={cn(
        'border-t border-border-subtle',
        disputed && 'bg-arena-red/5',
        isOpenable && 'hover:bg-surface-card',
      )}
    >
      <td
        className={cn(
          'border-l-2 px-3 py-3 font-mono text-xs whitespace-nowrap text-text-secondary',
          matchAccentClass(tone),
          muted,
        )}
      >
        {date}
      </td>

      <td className={cn('px-3 py-3 font-bold', muted)}>
        {opponentName ? (
          isOpenable ? (
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
    </tr>
  );
}
