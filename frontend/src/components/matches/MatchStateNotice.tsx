import { Callout } from '@/components/ui/callout';
import {
  CONFIRMATION_WINDOW_HOURS,
  confirmationMsLeft,
  formatDuration,
  formatMatchDate,
  isSoloMatch,
  msUntil,
  settledByAdmin,
  sideName,
  submittedSide,
} from '@/lib/match-detail';
import { MIN_LEAD_MINUTES } from '@/lib/team-detail';

import type { MatchSheet, MatchSide } from '@/lib/match-detail';

type MatchStateNoticeProps = {
  match: MatchSheet;
  sides: MatchSide[];
  /** Read at render by the page — see its comment on why this sheet does not tick. */
  nowMs: number;
};

/**
 * What is happening RIGHT NOW, in one sentence — the only part of the sheet that changes
 * between the seven states of the cycle.
 *
 * 🚨 It STATES, it never acts. The actions live one block below, in `MatchResultPanel`
 * ([FT-4B]), and the two are complementary by design: a side that has already reported gets
 * no form at all, only the wait — with its 24 h deadline — announced here.
 */
export function MatchStateNotice({ match, sides, nowMs }: MatchStateNoticeProps) {
  const kickoffIn = msUntil(match.scheduledAt, nowMs);
  const kickoff = formatMatchDate(match.scheduledAt, 'long');
  const solo = isSoloMatch(match);

  if (match.status === 'disputed') {
    return (
      <Callout tone="danger">
        <strong className="text-text-primary">The two sides disagree.</strong> Each reported a
        different result, so the match is on hold until an admin settles it. Nothing is applied to
        the ladder in the meantime.
      </Callout>
    );
  }

  if (match.status === 'cancelled') {
    return (
      <Callout>
        This match was cancelled and counts for nothing — no result, no Elo. A slot is withdrawn by
        the side that opened it, or automatically once it is too late for anyone to accept it.
      </Callout>
    );
  }

  if (match.status === 'completed') {
    return (
      <Callout tone="success">
        Result settled on {formatMatchDate(match.completedAt, 'long')}
        {settledByAdmin(match, sides)
          ? ' by an admin, after a dispute. The winner was ruled on; no game score was recorded.'
          : ', both sides having reported the same score.'}
      </Callout>
    );
  }

  if (match.status === 'awaiting_confirmation') {
    const reporter = submittedSide(sides);
    const other = sides.find((side) => side.id !== reporter?.id);
    const left = confirmationMsLeft(reporter, nowMs);

    return (
      <Callout>
        <strong className="text-text-primary">
          {reporter ? sideName(reporter, solo) : 'One side'} reported a result
        </strong>
        {/* ⚠️ `reporter &&` first: without it, `undefined !== null` is TRUE and the sentence
            would render an empty "( – )" when no side has reported. */}
        {reporter &&
          reporter.submittedScoreSelf !== null &&
          reporter.submittedScoreOpponent !== null && (
            <>
              {' '}
              ({reporter.submittedScoreSelf}–{reporter.submittedScoreOpponent} in their favour)
            </>
          )}
        {reporter?.submittedAt ? ` on ${formatMatchDate(reporter.submittedAt, 'long')}` : ''}.{' '}
        {left !== null && left > 0 ? (
          <>
            {other ? sideName(other, solo) : 'The other side'} has{' '}
            <strong className="text-text-primary">{formatDuration(left)}</strong> left to confirm or
            contest it.
          </>
        ) : (
          <>
            The {CONFIRMATION_WINDOW_HOURS}-hour window has closed: the reported result is applied
            as is.
          </>
        )}
      </Callout>
    );
  }

  // `pending` with a single side: the slot is open, nobody has accepted it.
  if (match.status === 'pending' && sides.length < 2) {
    return (
      <Callout>
        Slot open for {kickoff}
        {kickoffIn !== null && kickoffIn > 0 ? ` — in ${formatDuration(kickoffIn)}` : ''}. It is
        withdrawn automatically once it falls under {MIN_LEAD_MINUTES} minutes from kick-off, the point where
        nobody can accept it any more.
      </Callout>
    );
  }

  // Accepted (`pending` with both sides, or `in_progress`): before or after kick-off.
  if (kickoffIn !== null && kickoffIn > 0) {
    return (
      <Callout>
        Kick-off {kickoff} — <strong className="text-text-primary">in {formatDuration(kickoffIn)}</strong>
        . Play the Bo3 on the game itself, then come back to report the score.
      </Callout>
    );
  }

  return (
    <Callout>
      Kick-off was {kickoff}. Both sides can now report the result; the match closes as soon as
      they agree, and goes to an admin if they do not.
    </Callout>
  );
}
