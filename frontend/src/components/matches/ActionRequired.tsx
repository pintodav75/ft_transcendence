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
 * The « waiting on somebody » section, shared by `/history` (where it is the real reason the
 * page is worth building) and by `/home`.
 *
 * ⚠️ It MOVED from `components/history/` to `components/matches/` when `/home` became its second
 * reader — it describes matches, not a history — exactly as `MatchStatusPill` did on FT-4A. Not
 * a line of its logic or of its markup changed with the move.
 *
 * 🔑 NOTHING ELSE IN THE APP GROUPS THESE. A match in `awaiting_confirmation` or `disputed`
 * is visible only from the page of the team that played it, or from the one solo ladder it
 * belongs to — so someone who plays on three ladders has to visit three screens to find out
 * that a score is waiting for him. And they are on a CLOCK: the 24 h job
 * (`backend/src/jobs/index.ts`) auto-confirms an unanswered submission on the single score
 * that was submitted, and auto-cancels a dispute no admin has settled. Missing them costs
 * matches, silently.
 *
 * 🚨 IT IS NOT AFFECTED BY THE FILTERS. The whole point is that it cannot be missed; hiding
 * it behind "Game: Valorant" would defeat it. It reads the FULL history, always.
 *
 * ⚠️ NO PER-MATCH COUNTDOWN. The 24 h run from the SUBMISSION, and `GET /matches/me` carries
 * no submission timestamp (only `scheduledAt` / `startedAt` / `completedAt`). Counting down
 * from anything else would put a wrong number on screen; the rule is stated once, in prose.
 *
 * ⚠️ ONE link per row and nothing nested inside it: the whole card goes to the match sheet,
 * which is where confirming and contesting live (FT-4B). The opponent's own page is one click
 * away from the table below — putting a second target inside this one would make a card whose
 * two halves lead to different places.
 *
 * 🚨 THE COPY MUST NEVER SAY THE MATCH IS WAITING ON *ME*, AND THIS IS NOT A STYLE CHOICE — the
 * payload cannot support the claim. `GET /matches/me` exposes `score` (`match_sides.score`,
 * null until the match closes) and never `submitted_at`, so the front CANNOT know which side
 * reported. Three cases break the moment the wording gets personal:
 *   1. the side that has ALREADY submitted — `MatchResultPanel` renders nothing for it, so the
 *      sheet the card links to answers "the OTHER team has 20 h left to confirm";
 *   2. a non-captain, or a team-mate on the bench — `GET /matches/me` returns their team's
 *      matches too, but only the captain may answer;
 *   3. `disputed` — that one waits on an ADMIN, never on a player.
 * Saying "on the clock" is the strongest thing that is true of all three, and the urgency —
 * which is the whole reason this section exists — survives it intact. Telling people who must
 * act would need a per-row request or a backend field; it is not worth either.
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
        nobody settles is cancelled after the same delay — open the sheet to see where it
        stands and who is expected to answer.
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
                matchId={match.id}
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
