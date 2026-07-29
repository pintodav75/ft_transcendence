import { z } from 'zod';

import type { MatchSide } from '@/lib/match-detail';
import type { paths } from '@/lib/api-types.gen';

/**
 * Shape of ONE result submission — `POST /matches/{id}/result` (B6).
 *
 * Read side (`lib/match-detail.ts`) and write side (`lib/match-mutations.ts`) both need it,
 * so it lives in its own module: the schema, the form values it validates and the two pure
 * derivations that turn a screen decision into the body the API expects.
 */
export type SubmitResultBody =
  paths['/matches/{id}/result']['post']['requestBody']['content']['application/json'];

/**
 * Games a side must win to take the series. EVERY match of the platform is a best-of-3,
 * all games and all ladders confounded (product decision) — mirror of `WINS_REQUIRED` in
 * `backend/src/routes/matches.ts`, duplicated for the same reason as
 * `CONFIRMATION_WINDOW_HOURS`: the screen cannot offer a score it does not know. The server
 * stays the authority and refuses anything else in 400.
 */
export const WINS_REQUIRED = 2;

/**
 * The only two shapes a finished best-of-3 can take, from the WINNER's point of view — and
 * therefore the only two values the score control ever offers.
 *
 * Typed `readonly string[]` rather than a literal tuple on purpose: the form value is a raw
 * `<select>` string, and `.includes()` on it is exactly how the schema below checks the
 * bounds the backend declares (`z.int().min(0).max(2)`). A literal tuple would force a cast
 * at that call site to say the same thing.
 */
export const LOSER_GAMES: readonly string[] = ['0', '1'];

/**
 * ⚠️ Both fields are STRINGS: a radio group and a `<select>` only ever hand back strings,
 * and `loserGames` is turned into a number by `toResultBody` alone. Keeping the raw form
 * value here is what lets `''` mean "nothing picked yet" instead of a misleading `0`.
 */
export type MatchResultFormValues = z.infer<ReturnType<typeof matchResultSchema>>;

/**
 * Turns what the form holds ("who won", "how many games did the loser take") into the body
 * the API expects — scores RELATIVE TO THE SUBMITTER, deliberately not indexed on
 * `sideIndex`.
 */
export function toResultBody(values: MatchResultFormValues, mySideId: string): SubmitResultBody {
  const winnerIsMe = values.winnerSideId === mySideId;
  const loserGames = Number(values.loserGames);

  return {
    winnerSideId: values.winnerSideId,
    scoreSelf: winnerIsMe ? WINS_REQUIRED : loserGames,
    scoreOpponent: winnerIsMe ? loserGames : WINS_REQUIRED,
  };
}

/**
 * Confirming, as a request body: the EXACT MIRROR of what the opponent declared.
 *
 * 🔑 There is no "confirm" endpoint. Agreeing means posting the opponent's own submission
 * back with the two scores crossed over — his `scoreSelf` is my `scoreOpponent` — and the
 * same `submittedWinnerSideId`. Anything else (same winner, different games) is read as a
 * DISAGREEMENT by the backend and opens a dispute. B16 exposes both submitted scores for
 * precisely this computation.
 *
 * `null` when the opponent has not submitted, or submitted an incomplete row: the caller
 * then offers the form instead of a Confirm button, rather than sending a body full of
 * zeroes that would silently claim a 0–0.
 */
export function mirrorOfOpponentSubmission(opponent: MatchSide): SubmitResultBody | null {
  const { submittedWinnerSideId, submittedScoreSelf, submittedScoreOpponent } = opponent;
  if (
    submittedWinnerSideId === null ||
    submittedScoreSelf === null ||
    submittedScoreOpponent === null
  ) {
    return null;
  }

  return {
    winnerSideId: submittedWinnerSideId,
    scoreSelf: submittedScoreOpponent,
    scoreOpponent: submittedScoreSelf,
  };
}

/**
 * Front mirror of the two guards `POST /matches/{id}/result` applies to a score.
 *
 * ⚠️ Unlike `createMatchSchema`, this one DOES replay rules the screen makes unreachable —
 * the two controls can only ever produce a legal best-of-3, by construction. That is on
 * purpose and it is not belt-and-braces: these two rules are the contract of the route, the
 * kind of thing a later ticket "just" turns into two number inputs. Written here, the day
 * that happens the form refuses locally instead of discovering it in a 400.
 *
 * @param mySideId the submitter's own side — the scores are relative to HIM, so the
 * consistency rule cannot be expressed without it.
 */
export function matchResultSchema(mySideId: string, opponentSideId: string) {
  return z
    .object({
      winnerSideId: z.string().min(1, 'Pick the winner of this match.'),
      loserGames: z.string().min(1, 'Pick the score of the series.'),
    })
    .superRefine((values, ctx) => {
      if (values.winnerSideId !== mySideId && values.winnerSideId !== opponentSideId) {
        // Unreachable from the radio group; reachable the day a stale side id survives a
        // refetch that replaced the two camps.
        ctx.addIssue({
          code: 'custom',
          path: ['winnerSideId'],
          message: 'Pick one of the two sides of this match.',
        });
        return;
      }

      // Bounds first — mirror of `z.int().min(0).max(WINS_REQUIRED)` on the backend's body.
      // Without it a stray `'5'` would sail through the two rules below (one side at 2, the
      // other at 5: still "exactly one winner") and be refused by the API instead.
      if (!LOSER_GAMES.includes(values.loserGames)) {
        ctx.addIssue({
          code: 'custom',
          path: ['loserGames'],
          message: `A best-of-3 ends ${WINS_REQUIRED}–0 or ${WINS_REQUIRED}–1.`,
        });
        return;
      }

      const body = toResultBody(values, mySideId);
      const selfReachedWins = body.scoreSelf === WINS_REQUIRED;
      const opponentReachedWins = body.scoreOpponent === WINS_REQUIRED;

      // Exactly one camp reaches 2 games — never both (two winners), never neither (a draw
      // or an unfinished series).
      if (selfReachedWins === opponentReachedWins) {
        ctx.addIssue({
          code: 'custom',
          path: ['loserGames'],
          message: `A best-of-3 ends ${WINS_REQUIRED}–0 or ${WINS_REQUIRED}–1: exactly one side reaches ${WINS_REQUIRED} games.`,
        });
        return;
      }

      // …and that camp must be the one declared winner, otherwise the score contradicts the
      // verdict (declaring the opponent winner while keeping the winning score).
      if ((body.winnerSideId === mySideId) !== selfReachedWins) {
        ctx.addIssue({
          code: 'custom',
          path: ['winnerSideId'],
          message: `The side that reaches ${WINS_REQUIRED} games must be the one declared winner.`,
        });
      }
    });
}
