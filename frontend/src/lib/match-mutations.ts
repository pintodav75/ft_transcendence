import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, RATE_LIMITED_MESSAGE, apiFetch } from '@/lib/api';
import { WINS_REQUIRED } from '@/lib/match-result-schema';

import type { SubmitResultBody } from '@/lib/match-result-schema';
import type { paths } from '@/lib/api-types.gen';

/**
 * Write side of the match sheet. Its read side (`lib/match-detail.ts`) stays untouched:
 * queries and mutations have opposite lifecycles (cached vs. one-shot), and mixing them in
 * one module makes it impossible to see at a glance what invalidates what — same split as
 * `team-detail.ts` / `team-mutations.ts`.
 *
 * ⚠️ `useCreateMatch` / `useCancelMatch` (FT-2C) are still in `team-mutations.ts`, whose
 * comment asks for them to move here at the second consumer. They are NOT moved by [FT-4B]:
 * this ticket adds a route that file never had, moving four exports would touch the team
 * page and its three audit scenarios for no functional gain. Deliberate, and left as a
 * one-line job for whoever needs them from a match screen.
 */
type SubmitResultResponse =
  paths['/matches/{id}/result']['post']['responses'][200]['content']['application/json'];

/**
 * What the server made of my submission — the three ends of the state machine, straight from
 * the contract (closed enum in `openapi.yaml`, so the codegen hands us a literal union). The
 * screen phrases three different sentences from it, hence the export.
 */
export type SubmitResultStatus = SubmitResultResponse['status'];

// ---------------------------------------------------------------- error mapping

/**
 * Turns the route's refusals into something a human can act on.
 *
 * ⚠️ NONE of these 400s/409s carries a stable `code` (unlike the invitation routes of
 * B-INV), and invariant #8 forbids routing a message on the server's prose — it is display
 * text the backend may reword. The status alone is therefore the whole signal, which is why
 * the 400 below names BOTH of its reachable causes instead of picking one at random.
 */
export function submitResultErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    // 100 req/min per account. Reachable by a jumpy user, so it must say "wait", not "failed".
    if (error.status === 429) return RATE_LIMITED_MESSAGE;

    if (error.status === 400) {
      // Three causes, and the screen pre-empts all three: the controls cannot produce an
      // illegal best-of-3, the winner is picked FROM the two sides (never typed), and the
      // form is only offered once kick-off has passed. The sentence names the two a human
      // can act on — "pick a legal score", "wait for kick-off" — and skips the third, which
      // no user can cause and which would only read as noise. The one that still fires in
      // practice is a client clock running ahead of the server's.
      return `This result was refused: a best-of-3 ends ${WINS_REQUIRED}–0 or ${WINS_REQUIRED}–1 in favour of the declared winner, and a match cannot be reported before its kick-off time.`;
    }

    // Should never surface: the form is only rendered for the captain of a side (the player
    // in 1v1). It fires on a stale page — the team changed hands while the tab sat open.
    if (error.status === 403) {
      return 'You are not the one who reports for this side: in a team match only the captain can, in 1v1 only the player.';
    }

    if (error.status === 404) return 'This match no longer exists.';

    // The other side confirmed, contested, or a 24 h job closed the match while this page
    // was open. The screen is stale, hence the refetch in `onError` below.
    if (error.status === 409) {
      return 'This match is no longer waiting for a result — it has just been settled or closed. The page is refreshing.';
    }
  }

  return 'Could not report this result.';
}

/**
 * Is this the ONE refusal that pulls the screen out from under its own error message?
 *
 * ⚠️ A 409 is the only status `onError` refetches, and that refetch resolves the match into
 * `completed`/`disputed` — which unmounts the whole panel, message included. So the sentence
 * returned by `submitResultErrorMessage(409)` is, on its own, written to never be read: the
 * user watches the form evaporate without a word. The callers use this to route the news to
 * the page's live region instead, the one element that survives the unmount — and to close
 * the confirmation dialog, whose button would otherwise stay clickable on a request the app
 * already knows will be refused a second time (a red console line is a rejection criterion).
 */
export function isSettledElsewhere(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}

// ----------------------------------------------------------------------- hooks

type SubmitResultOptions = {
  matchId: string;
  /**
   * The viewer's OWN team, when his camp is a team — its match history prints this score.
   * `undefined` in 1v1 (the camp is a player, there is no team history to refresh).
   */
  teamId: string | undefined;
  /** `match.ladderId` — only refetched when Elo has actually moved (see below). */
  ladderId: string;
};

/**
 * Reports a result: first submission, confirmation of the opponent's, or contestation.
 *
 * 🔑 ONE route for all three. There is no "confirm" endpoint — confirming is posting the
 * exact mirror of the opponent's submission (`mirrorOfOpponentSubmission`), contesting is
 * posting a different one. The 200 says which of the three the server made of it:
 * `awaiting_confirmation`, `completed` or `disputed`.
 *
 * The invalidation promise is returned from `onSuccess` (repo idiom): the mutation stays
 * `isPending` until the sheet really shows the new state, instead of flashing the old form
 * for one frame between "done" and "refetched".
 */
export function useSubmitMatchResult({ matchId, teamId, ladderId }: SubmitResultOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SubmitResultBody) =>
      apiFetch<SubmitResultResponse>(`/matches/${encodeURIComponent(matchId)}/result`, {
        method: 'POST',
        body,
      }),
    onSuccess: ({ status }) => {
      const refreshes = [
        // Always: the sheet's own state, scores and submission flags all just changed.
        queryClient.invalidateQueries({ queryKey: ['match', matchId] }),
      ];

      if (teamId) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ['team', teamId, 'matches'] }));
      }

      // ⚠️ ONLY on `completed`. Elo is written at closure and nowhere else: a first
      // submission and a dispute both leave every ranking untouched, so refetching the
      // ladder there would be two requests for a screen that cannot have changed.
      if (status === 'completed') {
        refreshes.push(
          // `exact: true` because TanStack matches keys by PREFIX and `['ladder', id]` alone
          // would already sweep the rankings below — two decisions, kept separate and honest.
          queryClient.invalidateQueries({ queryKey: ['ladder', ladderId], exact: true }),
          queryClient.invalidateQueries({ queryKey: ['ladder', ladderId, 'rankings'] }),
        );
      }

      return Promise.all(refreshes);
    },
    // A 409 means the screen is LYING (the other side answered while this tab sat open):
    // the message alone would leave the same dead buttons on display.
    // ⚠️ Deliberately NOT on 404 — refetching a match that no longer exists would replay the
    // 404 and print "Failed to load resource" in the console, which is a rejection criterion.
    onError: (error) =>
      error instanceof ApiError && error.status === 409
        ? queryClient.invalidateQueries({ queryKey: ['match', matchId] })
        : undefined,
  });
}
