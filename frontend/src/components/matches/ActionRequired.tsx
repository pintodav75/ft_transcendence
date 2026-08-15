/**
 * The « matches on the clock » section, shared by `/history` and `/home`: everything of mine
 * that is waiting on somebody, across every ladder at once.
 */

import { MatchLineLink } from '@/components/matches/MatchLineLink';
import { MatchStatusPill } from '@/components/matches/MatchStatusPill';
import { SectionTitle } from '@/components/ui/section-title';
import { formatMatchDate } from '@/lib/match-detail';
import { matchAccentClass, matchStatusView } from '@/components/matches/match-status';
import { matchOpponentView } from '@/lib/solo';

import type { HistoryMatch, MatchLadderLabel } from '@/lib/history';

type ActionRequiredProps = {
  /** Already partitioned by the page — this component renders nothing when it is empty. */
  matches: HistoryMatch[];
  ladderOf: (match: HistoryMatch) => MatchLadderLabel;
};

/** NOTHING ELSE IN THE APP GROUPS THESE. */
export function ActionRequired({ matches, ladderOf }: ActionRequiredProps) {
  if (matches.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Matches on the clock</SectionTitle>

      <p className="max-w-prose text-sm text-text-secondary">
        {matches.length === 1
          ? 'One match is still open.'
          : `${matches.length} matches are still open.`}{' '}
        A reported score left alone is applied automatically after 24 hours, and a dispute
        nobody settles is cancelled after the same delay — open each one to see where it stands
        and who is expected to answer.
      </p>

      <ul role="list" aria-label="Matches on the clock" className="flex flex-col gap-2">
        {matches.map((match) => {
          const ladder = ladderOf(match);
          // Never `match.opponent` directly: `null` has four causes and two of them mean
          // somebody really played and then vanished.
          const opponent = matchOpponentView(match);

          return (
            <li key={match.id}>

              <MatchLineLink
                target={
                  // A dispute is settled by an ADMIN reading the file, so that is where the row
                  // leads — the sheet has no control to offer on a `disputed` match.
                  match.status === 'disputed' && match.disputeId
                    ? { kind: 'dispute', disputeId: match.disputeId }
                    : { kind: 'match', matchId: match.id }
                }
                accentClass={matchAccentClass(matchStatusView(match).tone)}
              >
                <MatchStatusPill match={match} />
                <span className="text-sm font-bold text-text-primary">
                  {ladder.ladderName ?? `${ladder.game} ${ladder.format}`}
                </span>
                {opponent && (
                  <span className="text-sm text-text-secondary">vs {opponent.name}</span>
                )}

                <span className="font-mono text-xs text-text-secondary sm:ms-auto">
                  {formatMatchDate(match.scheduledAt)}
                </span>
              </MatchLineLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
