import { useId, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormMessage } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { OptionTile } from '@/components/ui/option-tile';
import { SectionTitle } from '@/components/ui/section-title';
import { Select } from '@/components/ui/select';
import { labelClasses } from '@/components/ui/label-variants';
import {
  canReportResult,
  confirmationMsLeft,
  isSoloMatch,
  sideName,
} from '@/lib/match-detail';
import {
  isSettledElsewhere,
  submitResultErrorMessage,
  useSubmitMatchResult,
} from '@/lib/match-mutations';
import {
  LOSER_GAMES,
  WINS_REQUIRED,
  matchResultSchema,
  mirrorOfOpponentSubmission,
  toResultBody,
} from '@/lib/match-result-schema';
import { useAuthStore } from '@/stores/auth-store';

import type { RefObject } from 'react';
import type { SubmitResultStatus } from '@/lib/match-mutations';
import type { MatchResultFormValues, SubmitResultBody } from '@/lib/match-result-schema';
import type { MatchSheet, MatchSide } from '@/lib/match-detail';

type ReportedHandler = (announcement: string) => void;

/**
 * What the live region says once the server has answered. The three outcomes of ONE route,
 * phrased in one place rather than at each of the two call sites.
 */
function reportedAnnouncement(
  status: SubmitResultStatus,
  winnerName: string,
  opponentName: string,
  loserGames: number,
) {
  const score = `${WINS_REQUIRED}–${loserGames}`;

  if (status === 'completed') {
    return `Result settled: ${winnerName} wins ${score}. The match is closed and Elo has been applied to both camps.`;
  }
  if (status === 'disputed') {
    return `Your result differs from ${opponentName}’s: the match is now in dispute and an admin will settle it.`;
  }
  return `Result reported: ${winnerName} wins ${score}. ${opponentName} now has to confirm or contest it.`;
}

/** What the live region says when the OTHER side settled the match while this tab sat open. */
const SETTLED_ELSEWHERE_ANNOUNCEMENT =
  'The other side settled this match while the page was open: the result form is gone, and the sheet now shows the final state.';

type MatchResultFormProps = {
  /** Target of the `aria-controls` of the button that discloses this form. */
  id: string;
  match: MatchSheet;
  mySide: MatchSide;
  opponent: MatchSide;
  /** Opened to CONTEST the opponent's report: changes the wording, not the request. */
  contesting: boolean;
  onReported: ReportedHandler;
  onCancel?: () => void;
};

/** The score form itself: who won, and in how many games. */
function MatchResultForm({
  id,
  match,
  mySide,
  opponent,
  contesting,
  onReported,
  onCancel,
}: MatchResultFormProps) {
  const scoreId = useId();
  const scoreHintId = useId();
  const scoreErrorId = useId();
  const winnerErrorId = useId();
  const winnerHintId = useId();

  const solo = isSoloMatch(match);
  const myName = sideName(mySide, solo);
  const opponentName = sideName(opponent, solo);

  const submit = useSubmitMatchResult({
    matchId: match.id,
    // 1v1: the camp is a player, there is no team history to refresh.
    teamId: mySide.team?.id,
    ladderId: match.ladderId,
  });

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MatchResultFormValues>({
    // The two side ids never change for a mounted form: they come from the match itself.
    resolver: zodResolver(matchResultSchema(mySide.id, opponent.id)),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { winnerSideId: '', loserGames: '' },
  });

  // `useWatch`, never the form's `watch()`: the latter is flagged by
  // react-hooks/incompatible-library (it defeats the compiler's memoization).
  const pickedWinner = useWatch({ control, name: 'winnerSideId' });

  const onSubmit = handleSubmit((values) => {
    const body = toResultBody(values, mySide.id);
    const winnerName = body.winnerSideId === mySide.id ? myName : opponentName;
    const loserGames = Math.min(body.scoreSelf, body.scoreOpponent);

    // `mutate`, not `mutateAsync`: a rejection lands in `submit.error` and is rendered below,
    // so no promise is left unhandled in this handler.
    submit.mutate(body, {
      onSuccess: ({ status }) =>
        onReported(reportedAnnouncement(status, winnerName, opponentName, loserGames)),
      // The 409 alone: its refetch unmounts this form, so the message rendered below would
      // flash and vanish unread. Everything else stays on screen and reads normally.
      onError: (error) => {
        if (isSettledElsewhere(error)) onReported(SETTLED_ELSEWHERE_ANNOUNCEMENT);
      },
    });
  });

  const winnerError = errors.winnerSideId?.message;
  const scoreError = errors.loserGames?.message;
  const serverError = submit.isError ? submitResultErrorMessage(submit.error) : null;

  return (
    <form id={id} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <fieldset
        // `fieldset` maps to role="group", which does take a description: the hint and the
        // failure are announced with the group instead of floating loose next to it.
        aria-describedby={winnerError ? `${winnerHintId} ${winnerErrorId}` : winnerHintId}
        className="flex min-w-0 flex-col gap-2 border-0 p-0"
      >

        <legend className={labelClasses('mb-2')}>Winner</legend>

        <div className="grid gap-2 sm:grid-cols-2">
          {[mySide, opponent].map((side) => (
            // `OptionTile` — the line-up picker's tile, generalised into `components/ui` for
            // this second use rather than having its class string copied here.
            <OptionTile key={side.id} selected={pickedWinner === side.id}>
              <input
                type="radio"
                value={side.id}
                // Marked on the CONTROLS, not just described on the group: without it a screen
                // reader reads the reason (through the fieldset) but never says which control
                // is refused.
                aria-invalid={Boolean(errors.winnerSideId)}
                className="focus-ring size-4 shrink-0 accent-action-primary"
                {...register('winnerSideId')}
              />
              <span className="min-w-0 truncate text-sm font-bold text-text-primary">
                {sideName(side, solo)}
              </span>
            </OptionTile>
          ))}
        </div>

        <p id={winnerHintId} className="text-xs text-text-muted">
          The camp that took the series — {myName} is yours.
        </p>
      </fieldset>

      {winnerError ? <FormMessage id={winnerErrorId}>{winnerError}</FormMessage> : null}

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={scoreId}>Games</Label>
        <Select
          id={scoreId}
          aria-invalid={Boolean(scoreError)}
          // Without this, a screen reader announces "invalid" and stops there: the reason sits
          // in an element nothing points at.
          aria-describedby={scoreError ? `${scoreHintId} ${scoreErrorId}` : scoreHintId}
          {...register('loserGames')}
        >
          <option value="">Pick the score…</option>
          {LOSER_GAMES.map((games) => (
            <option key={games} value={games}>
              {`${WINS_REQUIRED} – ${games}`}
            </option>
          ))}
        </Select>
        <p id={scoreHintId} className="text-xs text-text-muted">
          Winner&apos;s games first. Every match is a best-of-3, so a finished series always
          reads {WINS_REQUIRED}–0 or {WINS_REQUIRED}–1.
        </p>
        {scoreError ? <FormMessage id={scoreErrorId}>{scoreError}</FormMessage> : null}
      </div>

      {serverError ? <FormMessage>{serverError}</FormMessage> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? 'Sending…' : contesting ? 'Report my result' : 'Report the result'}
        </Button>
        {onCancel ? (
          <Button variant="secondary" disabled={submit.isPending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

type MatchResultPanelProps = {
  match: MatchSheet;
  sides: MatchSide[];
  /** Fresh clock from the page — kick-off must be PAST for the API to accept a result. */
  nowMs: number;
  /**
   * Where focus goes once this panel disappears (it does, on every success): the sheet's
   * `<h1>`.
   */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Hands the page the sentence to put in its ONE live region. */
  onReported: ReportedHandler;
};

/**
 * The only place in the app where the challenge/accept cycle can END: reporting a score,
 * confirming the opponent's, or contesting it.
 */
export function MatchResultPanel({
  match,
  sides,
  nowMs,
  returnFocusRef,
  onReported,
}: MatchResultPanelProps) {
  const formId = useId();
  const [contesting, setContesting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const meId = useAuthStore((state) => state.user?.id);
  const { mySide, opponent, blocker } = canReportResult(match, sides, meId, nowMs);

  // Hooks run on every render, so this one is created before any branch.
  const confirmResult = useSubmitMatchResult({
    matchId: match.id,
    teamId: mySide?.team?.id,
    ladderId: match.ladderId,
  });

  // Not a reporter (bench player, team-mate, visitor), or a slot with no opponent: this whole
  // section does not exist for them, dialog included.
  if (!mySide || !opponent) return null;

  // Bound to consts so the narrowing above survives inside the closures below.
  const me = mySide;
  const foe = opponent;

  const solo = isSoloMatch(match);
  const myName = sideName(me, solo);
  const opponentName = sideName(foe, solo);

  function handleReported(announcement: string) {
    onReported(announcement);
    setConfirming(false);
    setContesting(false);
    // The control that had focus is about to be unmounted.
    returnFocusRef.current?.focus();
  }

  function confirmOpponentResult(mirrored: SubmitResultBody) {
    const winnerName = mirrored.winnerSideId === me.id ? myName : opponentName;
    const loserGames = Math.min(mirrored.scoreSelf, mirrored.scoreOpponent);

    confirmResult.mutate(mirrored, {
      onSuccess: ({ status }) =>
        handleReported(reportedAnnouncement(status, winnerName, opponentName, loserGames)),
      /** The dialog does NOT close on its own here, and that is the whole point of this branch. */
      onError: (error) => {
        if (isSettledElsewhere(error)) handleReported(SETTLED_ELSEWHERE_ANNOUNCEMENT);
      },
    });
  }

  // The opponent's claim, turned into MY submission.
  const mirror = foe.submittedAt !== null ? mirrorOfOpponentSubmission(foe) : null;
  const mirrorWinnerName = mirror && mirror.winnerSideId === me.id ? myName : opponentName;
  const mirrorLoserGames = mirror ? Math.min(mirror.scoreSelf, mirror.scoreOpponent) : 0;

  /** The 24 h auto-confirmation window is over, but the job has not run yet. */
  const windowLeft = confirmationMsLeft(foe, nowMs);
  const windowClosed = windowLeft !== null && windowLeft <= 0;

  function body() {
    // The cycle is not waiting for a result (open slot, cancelled, disputed, completed):
    // `MatchStateNotice` already says which state the match is in.
    if (blocker === 'wrong_status') return null;

    if (blocker === 'not_started') {
      return (
        <section className="flex flex-col gap-3.5">
          <SectionTitle>Result</SectionTitle>

          <Callout tone="muted">
            You are the one who reports this match for{' '}
            <strong className="text-text-primary">{myName}</strong>. The form opens at kick-off,
            once the games have been played.
          </Callout>
        </section>
      );
    }

    // I have already reported: the wait belongs to `MatchStateNotice`. See the docblock —
    // overwriting my own verdict is out of scope.
    if (me.submittedAt !== null) return null;

    return (
      <section className="flex flex-col gap-3.5">
        <SectionTitle>Result</SectionTitle>

        {mirror ? (
          <>
            <p className="max-w-prose text-sm text-text-secondary">
              {opponentName} says{' '}
              <strong className="text-text-primary">
                {mirrorWinnerName} won {WINS_REQUIRED}–{mirrorLoserGames}
              </strong>
              . Confirming closes the match and applies Elo to both camps — it cannot be undone.
              Reporting anything else sends the match to an admin.
              {windowClosed ? (
                <>
                  {' '}
                  The 24-hour window has run out, so a job is about to apply that result as is —
                  your answer still counts until it does.
                </>
              ) : null}
            </p>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setConfirming(true)}>Confirm the result</Button>
              <Button
                variant="secondary"
                aria-expanded={contesting}
                // Only while the form exists: pointing at a missing id is invalid ARIA.
                aria-controls={contesting ? formId : undefined}
                onClick={() => setContesting((open) => !open)}
              >
                Contest
              </Button>
            </div>

            {contesting ? (
              <MatchResultForm
                id={formId}
                match={match}
                mySide={me}
                opponent={foe}
                contesting
                onReported={handleReported}
                onCancel={() => setContesting(false)}
              />
            ) : null}
          </>
        ) : (
          <>
            <p className="max-w-prose text-sm text-text-secondary">
              Report the best-of-3 you have just played. {opponentName} then confirms it — or
              reports a different result, which sends the match to an admin.
            </p>
            <MatchResultForm
              id={formId}
              match={match}
              mySide={me}
              opponent={foe}
              contesting={false}
              onReported={handleReported}
            />
          </>
        )}
      </section>
    );
  }

  return (
    <>
      {body()}

      <ConfirmDialog
        open={confirming && mirror !== null}
        title="Confirm this result?"
        description={
          <>
            You agree that{' '}
            <strong className="text-text-primary">
              {mirrorWinnerName} won {WINS_REQUIRED}–{mirrorLoserGames}
            </strong>
            . The match closes immediately and Elo is applied to both camps. This cannot be
            undone.
          </>
        }
        confirmLabel="Apply the result"
        cancelLabel="Not yet"
        // Not `danger`: agreeing with the opponent is the NORMAL end of the cycle, not a
        // destructive act. The warning lives in the sentence above.
        tone="primary"
        pending={confirmResult.isPending}
        error={confirmResult.isError ? submitResultErrorMessage(confirmResult.error) : null}
        onConfirm={() => (mirror ? confirmOpponentResult(mirror) : undefined)}
        onCancel={() => {
          confirmResult.reset();
          setConfirming(false);
        }}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}
