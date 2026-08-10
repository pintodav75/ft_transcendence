/*
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

/**
 * 🔑 NOTHING ELSE IN THE APP GROUPS THESE. A match in `awaiting_confirmation` or `disputed` is
 * visible only from the page of the team that played it, or from the one solo ladder it belongs
 * to — so someone who plays on three ladders has to visit three screens to find out that a score
 * is waiting for him. And they are on a CLOCK: the 24 h job auto-confirms an unanswered
 * submission on the single score that was submitted, and auto-cancels a dispute no admin has
 * settled. Missing them costs matches, silently. Hence: NOT affected by the page's filters, it
 * reads the FULL history, always.
 *
 * ⚠️ NO PER-MATCH COUNTDOWN. The 24 h run from the SUBMISSION, and `GET /matches/me` carries no
 * submission timestamp. Counting down from anything else would put a wrong number on screen.
 *
 * 🚨 THE COPY MUST NEVER SAY THE MATCH IS WAITING ON *ME* — the payload cannot support the
 * claim. Without `submitted_at` the front cannot know which side reported, and three cases break
 * the moment the wording gets personal: the side that has already submitted (the sheet answers
 * "the OTHER team has 20 h left"), a non-captain or a bench player (they see their team's matches
 * but may not answer), and `disputed` (that one waits on an ADMIN). "On the clock" is the
 * strongest thing true of all three, and the urgency survives it intact.
 */
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

      {/* Named so a screen reader hears WHICH list this is — the page holds a second one (the
          table below) — and so a selector can target it rather than any `<ul>` of the page.
          `role="list"` is explicit: Safari drops the list role from a `<ul>` whose display is
          not `list-item`. */}
      <ul role="list" aria-label="Matches on the clock" className="flex flex-col gap-2">
        {matches.map((match) => {
          const ladder = ladderOf(match);
          // 🚨 Never `match.opponent` directly: `null` has four causes and two of them mean
          // somebody really played and then vanished. `matchOpponentView` is what keeps a
          // dash from erasing them — see its docblock.
          const opponent = matchOpponentView(match);

          return (
            <li key={match.id}>
              {/* The card is NEUTRAL and its left edge carries the colour — the same accent the
                  table rows use (`matchAccentClass`), so the two halves of the page read as one
                  system. The class string itself moved to `MatchLineLink` when `/home` became
                  its second reader; the rendered DOM is unchanged. */}
              <MatchLineLink
                target={
                  // A dispute is settled by an ADMIN reading the file, so that is where the row
                  // leads — the sheet has no control to offer on a `disputed` match. Guarded on
                  // the status AND on the id: `disputeId` outlives the dispute (see the docblock).
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
                {/* `ms-auto` only from `sm`: on a narrow screen the date wraps onto its own
                    line, where pushing it right would leave it stranded on the far edge. */}
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
