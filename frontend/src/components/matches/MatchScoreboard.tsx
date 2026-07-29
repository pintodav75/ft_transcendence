import { MatchSideCard } from '@/components/matches/MatchSideCard';
import { formatSideScore, isSoloMatch, sideName } from '@/lib/match-detail';
import { MIN_LEAD_MINUTES } from '@/lib/team-detail';
import { EM_DASH } from '@/lib/utils';

import type { MatchSheet, MatchSide } from '@/lib/match-detail';

type MatchScoreboardProps = {
  match: MatchSheet;
  sides: MatchSide[];
};

/**
 * What a screen reader hears in place of the big "2 – 1".
 *
 * ⚠️ Before a match closes, `score` is null on BOTH sides and the visible digits are two em
 * dashes — read out, that is either silence or "dash, dash", which says nothing. A sentence is
 * spelled out instead; the state notice below carries the detail.
 */
function scoreLabel(home: MatchSide, away: MatchSide, solo: boolean) {
  const names = [sideName(home, solo), sideName(away, solo)];
  if (home.score === null && away.score === null) return `${names[0]} vs ${names[1]}, no score yet`;
  return `${names[0]} ${formatSideScore(home)}, ${names[1]} ${formatSideScore(away)}`;
}

/**
 * The two camps face to face, Bo3 score in the middle.
 *
 * The score shown is the FINAL one only (`match_sides.score`, written at closure). A result
 * one side has reported but the other has not confirmed is deliberately NOT printed here —
 * it is a claim, not an outcome, and the state notice below states it as such, with its
 * author. Printing it big would make a pending claim look settled.
 */
export function MatchScoreboard({ match, sides }: MatchScoreboardProps) {
  const [home, away] = sides;
  if (!home) return null;

  const solo = isSoloMatch(match);
  // ⚠️ Having no second side does NOT mean the slot is still takeable. `cancelExpiredSlots`
  // cancels every `pending` slot that drops under MIN_LEAD_MINUTES, and those rows stay in the
  // team history — which THIS ticket just made clickable for a member. Announcing "any team can
  // accept it" on a cancelled slot promises an action the API refuses, right under a CANCELLED
  // pill. The status is the authority here, never the absence of an opponent.
  const isOpenSlot = match.status === 'pending';

  return (
    // One column below `sm` (two 5v5 team names side by side at 375 px left ~120 px each),
    // three from `sm` up. The DOM order — home, score, away — is the reading order in both
    // layouts, so nothing has to be reordered visually.
    <section
      aria-label="Score"
      className="grid grid-cols-1 items-center gap-6 rounded-card border border-border-subtle bg-surface-card p-5 sm:grid-cols-[1fr_auto_1fr] sm:gap-4"
    >
      <MatchSideCard side={home} isWinner={match.winnerSideId === home.id} solo={solo} />

      <div className="flex flex-col items-center gap-1">
        {away ? (
          // The visible "2 – 1" says nothing about WHOSE 2 it is once read out of the layout,
          // which is exactly what a screen reader does — hence the spelled-out label. The two
          // `<span>`s stay `aria-hidden` so the pair is announced ONCE.
          //
          // ⚠️ `role="img"` is NOT decoration here, it is what makes the label legal. ARIA 1.2
          // PROHIBITS `aria-label` on `role="paragraph"`, which is what a bare `<p>` is: Chrome
          // honoured it anyway, so the defect was invisible — but in a conforming implementation
          // the score had NO accessible name at all, the digits below being `aria-hidden`.
          // `img` accepts a name and is a leaf in the accessibility tree, which is exactly what
          // this is: a graphic rendering of one fact, read as one string.
          <p
            role="img"
            aria-label={scoreLabel(home, away, solo)}
            className="font-mono text-4xl font-bold tabular-nums text-text-primary"
          >
            <span aria-hidden="true">
              {formatSideScore(home)}
              <span className="mx-2 text-text-muted">–</span>
              {formatSideScore(away)}
            </span>
          </p>
        ) : (
          <p className="font-mono text-4xl font-bold tabular-nums text-text-muted">{EM_DASH}</p>
        )}
        <p className="text-xs label-caps text-text-muted">
          {away ? 'Games won (Bo3)' : isOpenSlot ? 'No opponent yet' : 'No opponent'}
        </p>
      </div>

      {away ? (
        <MatchSideCard side={away} isWinner={match.winnerSideId === away.id} solo={solo} />
      ) : isOpenSlot ? (
        <p className="text-center text-sm text-text-secondary">
          Nobody has taken this slot yet. Any team of the ladder can accept it until{' '}
          {MIN_LEAD_MINUTES} minutes before kick-off.
        </p>
      ) : (
        <p className="text-center text-sm text-text-secondary">
          This slot never found an opponent, and can no longer be taken.
        </p>
      )}
    </section>
  );
}
