import { z } from 'zod';

import type { MatchSide } from '@/lib/match-detail';
import type { paths } from '@/lib/api-types.gen';

/**
 * Shape of ONE result submission — `POST /matches/{id}/result`.
 *
 * Read side (`lib/match-detail.ts`) and write side (`lib/match-mutations.ts`) both need it,
 * so it lives in its own module: the schema, the form values it validates and the two pure
 * derivations that turn a screen decision into the body the API expects.
 */
export type SubmitResultBody =
  paths['/matches/{id}/result']['post']['requestBody']['content']['application/json'];

/** Games a side must win to take the series. */
export const WINS_REQUIRED = 2;

/**
 * The only two shapes a finished best-of-3 can take, from the WINNER's point of view — and
 * therefore the only two values the score control ever offers.
 */
export const LOSER_GAMES: readonly string[] = ['0', '1'];

/**
 * Both fields are STRINGS: a radio group and a `<select>` only ever hand back strings, and
 * `loserGames` is turned into a number by `toResultBody` alone.
 */
export type MatchResultFormValues = z.infer<ReturnType<typeof matchResultSchema>>;

/**
 * Turns what the form holds ("who won", "how many games did the loser take") into the body the
 * API expects — scores RELATIVE TO THE SUBMITTER, deliberately not indexed on `sideIndex`.
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

/** Confirming, as a request body: the EXACT MIRROR of what the opponent declared. */
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

/** Front mirror of the two guards `POST /matches/{id}/result` applies to a score. */
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

      // Exactly one camp reaches 2 games — never both (two winners), never neither (a draw or
      // an unfinished series).
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
