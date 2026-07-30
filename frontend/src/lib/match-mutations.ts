import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, RATE_LIMITED_MESSAGE, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { MAX_OPEN_SLOTS } from '@/lib/match-slots';
import { WINS_REQUIRED } from '@/lib/match-result-schema';
import { myMatchesKey } from '@/lib/solo';
import { teamMatchesKey } from '@/lib/team-detail';

import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { SubmitResultBody } from '@/lib/match-result-schema';
import type { paths } from '@/lib/api-types.gen';

/**
 * Write side of a match: reporting a result (FT-4B) and opening/cancelling a slot (FT-2C).
 * The read side (`lib/match-detail.ts`) stays untouched: queries and mutations have opposite
 * lifecycles (cached vs. one-shot), and mixing them in one module makes it impossible to see
 * at a glance what invalidates what — same split as `team-detail.ts` / `team-mutations.ts`.
 *
 * ⚠️ THE SLOT MUTATIONS ARRIVED HERE WITH [F-SOLO], and that was the plan written into the
 * code: `team-mutations.ts` hosted them only because `sharedMessage()` (429 / 403) was
 * private to that file, and its comment asked for the move "at the second consumer". FT-4B
 * declined (it added a route, it needed none of them); the solo page opens and cancels slots
 * on a 1v1 ladder, where NOTHING is a team, so it is the real second consumer. `sharedMessage`
 * went up to `lib/api.ts` (it describes the rate limiter, not a team) and the hooks became
 * key-driven. **Nothing was redesigned beyond that**: same requests, same invalidations, same
 * messages.
 */
type SubmitResultResponse =
  paths['/matches/{id}/result']['post']['responses'][200]['content']['application/json'];
type CreateMatchBody = paths['/matches']['post']['requestBody']['content']['application/json'];
type CreateMatchResponse = paths['/matches']['post']['responses'][201]['content']['application/json'];
type CancelMatchResponse =
  paths['/matches/{id}']['delete']['responses'][200]['content']['application/json'];

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

      // Les DEUX historiques où ce match peut être listé, et ils sont exclusifs : une ligne
      // d'équipe sur un ladder 2v2+, ma ligne perso sur un ladder solo. Les clés viennent des
      // helpers des hooks de LECTURE (`teamMatchesKey` / `myMatchesKey`) — un littéral ici
      // survivrait à un renommage là-bas en invalidant une entrée que personne ne lit.
      // ⚠️ Le cas solo manquait : soumettre un score en 1v1 laissait l'onglet Matches de
      // `/solo/$ladderId` sur son état d'avant, alors que le statut de la ligne venait de
      // changer. `staleTime` à 0 le rattrapait au remontage — un flash, pas un mensonge
      // durable, mais l'asymétrie n'avait aucune raison d'être.
      refreshes.push(
        queryClient.invalidateQueries({
          queryKey: teamId ? teamMatchesKey(teamId) : myMatchesKey(ladderId),
        }),
      );

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

// ------------------------------------------------------- slots (FT-2C, moved by F-SOLO)

/**
 * ONE key, and only one. Neither creating nor cancelling a slot changes `GET /teams/{id}`
 * (identity, roster, invitations) or the rankings (no result is entered), so the team page's
 * `refreshTeam()` is deliberately NOT used here: it would also sweep `['team', id]` and
 * `['teams']`, i.e. two requests the screen has no use for.
 *
 * ⚠️ The key is a PARAMETER since [F-SOLO], and it has to be: the two histories a slot can
 * appear in are different cache entries — `['team', id, 'matches']` on a team ladder,
 * `['matches', 'me', ladderId]` on a solo one. Each caller passes the key its OWN read hook
 * fills (`teamMatchesKey` / `myMatchesKey`), so a rename can never leave the mutation
 * invalidating an entry nobody reads.
 */
function refreshHistory(queryClient: QueryClient, historyKey: QueryKey) {
  return queryClient.invalidateQueries({ queryKey: historyKey });
}

/**
 * Zod's 400 has an `errors` ARRAY and no `error` field; the business 400s have `error` and
 * no `errors`. Narrowing by shape, never casting the payload into a contract it may not
 * honour.
 */
function hasZodIssues(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return false;
  if (!('errors' in payload)) return false;

  const { errors } = payload as Record<'errors', unknown>;
  return Array.isArray(errors);
}

/**
 * `POST /matches` answers `{ error, unlinkedPlayers }` when a selected player has no linked
 * game account. The array holds **uuids**, never pseudos — the caller maps them onto its
 * roster, because showing a raw uuid to a captain explains nothing.
 *
 * ⚠️ TEAM LADDERS ONLY. In 1v1 the server refuses the same rule (§5.1) with a bare
 * `{ error }` and no array: there is only one player to name, and he is the one reading the
 * screen. That asymmetry is why `CreateMatchErrorContext` is a discriminated union below.
 */
function unlinkedPlayerIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  if (!('unlinkedPlayers' in payload)) return [];

  const { unlinkedPlayers } = payload as Record<'unlinkedPlayers', unknown>;
  if (!Array.isArray(unlinkedPlayers)) return [];

  return unlinkedPlayers.filter((value): value is string => typeof value === 'string');
}

/**
 * The slot the user picked slipped under the 15-minute bound between the moment the list was
 * drawn and the moment the request landed. The panel must not only show the message: it has
 * to REDRAW the list, or the next click repeats the same failure.
 */
export function isExpiredSlotError(error: unknown) {
  return error instanceof ApiError && error.status === 400 && hasZodIssues(error.payload);
}

/**
 * What the caller must tell us to phrase a refusal — discriminated by `side`, because the
 * two ladders do not fail the same way.
 *
 * 🔑 THE DISCRIMINANT IS NOT COSMETIC. On a 1v1 ladder there is no team, no roster and no
 * line-up: "this team is already engaged" and "every player must still be on this team" would
 * both be lies, and the 400 has a different cause entirely (§5.1 — *I* have no linked
 * account, and the server says so without an `unlinkedPlayers` array). Making the caller
 * declare its side is what stops the solo screen from inheriting team prose.
 */
export type CreateMatchErrorContext =
  | {
      side: 'team';
      /**
       * Locally counted still-valid open slots (`openSlotCount`). This is what tells the two
       * 409s of `POST /matches` apart — see below.
       *
       * `undefined` when the history could not be loaded: the count is then UNKNOWN, not
       * zero. Passing 0 in that case would state "you are already engaged at that time" with
       * full confidence while the server actually refused for the cap — a message that sends
       * the user looking for a conflict that does not exist.
       */
      openSlots: number | undefined;
      /** The roster, used to turn `unlinkedPlayers` uuids into pseudos. */
      members: { id: string; pseudo: string }[];
    }
  | {
      side: 'solo';
      openSlots: number | undefined;
      /** Display name of the account this game requires ("chess.com", "Epic"). */
      providerName: string;
    };

export function createMatchErrorMessage(error: unknown, context: CreateMatchErrorContext) {
  // 403 (`only the captain can engage the team`, on a page that changed hands) and 429.
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    if (error.status === 409) {
      // ⚠️ THE TWO 409s OF THIS ROUTE CARRY NO STABLE `code` — unlike the invitation routes
      // of B-INV. Invariant #8 forbids routing a message on the server's prose, so they are
      // told apart by the only reliable local signal: our own count of open slots. Both are
      // pre-empted by the UI; this is the net for a stale page.
      //
      // With no count at all (history unavailable) the two cannot be told apart, so the
      // message names BOTH possibilities instead of picking one at random. Saying nothing
      // false is worth more than sounding sure.
      // ⚠️ THE THREE TEAM SENTENCES ARE WORD FOR WORD THE ONES FT-2C SHIPPED, and they must
      // stay that way: `teams-matchmaking.mjs` waits on « This team is already engaged around
      // that time… » and on « already holds 5 open slots ». Spelling both sides out in full,
      // rather than assembling them from fragments, is what makes that verifiable at a glance.
      if (context.side === 'team') {
        if (context.openSlots === undefined) {
          return `This slot was refused: either this team is already engaged around that time, or it already holds ${MAX_OPEN_SLOTS} open slots on this ladder. Reload the page to see its matches.`;
        }

        return context.openSlots >= MAX_OPEN_SLOTS
          ? `This team already holds ${MAX_OPEN_SLOTS} open slots on this ladder — cancel one before opening another.`
          : 'This team is already engaged around that time. The list of times has just been refreshed.';
      }

      if (context.openSlots === undefined) {
        return `This slot was refused: either you are already engaged around that time, or you already hold ${MAX_OPEN_SLOTS} open slots on this ladder. Reload the page to see your matches.`;
      }

      return context.openSlots >= MAX_OPEN_SLOTS
        ? `You already hold ${MAX_OPEN_SLOTS} open slots on this ladder — cancel one before opening another.`
        : 'You are already engaged around that time. The list of times has just been refreshed.';
    }

    if (error.status === 404) return 'This ladder no longer exists.';

    if (error.status === 400) {
      // Zod: off-grid time, or a slot that fell under the 15-minute bound while the panel
      // was open. Only the second is reachable from these screens, and it is checked FIRST
      // because it is the one cause both sides share.
      if (hasZodIssues(error.payload)) {
        return 'That time slot has just passed — pick another one.';
      }

      if (context.side === 'solo') {
        // §5.1, single player flavour: `validateSide()` answers
        // « you must have a linked <provider> account » with no array to map. Pre-empted by
        // the screen (the button does not exist without a linked account); this is the net
        // for a page left open while the account was unlinked elsewhere.
        return `This ladder needs a linked ${context.providerName} account before you can open a slot.`;
      }

      const unlinked = unlinkedPlayerIds(error.payload);
      if (unlinked.length > 0) {
        const named = unlinked
          .map((id) => context.members.find((member) => member.id === id)?.pseudo)
          .filter((pseudo): pseudo is string => Boolean(pseudo))
          .map((pseudo) => `@${pseudo}`);

        return named.length > 0
          ? `${named.join(', ')} no longer has a linked game account — unselect them and pick someone else.`
          : 'One of the selected players no longer has a linked game account.';
      }

      return 'This line-up was refused: every player must still be on this team.';
    }
  }

  return 'Could not open the slot.';
}

export function cancelMatchErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Somebody accepted the slot between the render and the click.
    if (error.status === 409) return 'This slot has just been accepted — it cannot be cancelled.';
    if (error.status === 404) return 'This match no longer exists.';
  }

  return 'Could not cancel this slot.';
}

/**
 * Opens a slot on a ladder. Captain only on a team ladder, where `lineup` holds EXACTLY
 * `parseInt(format)` member ids all with a linked game account; on a 1v1 ladder the caller IS
 * the side and `lineup` is omitted (the server ignores it).
 *
 * The invalidation promise is returned from `onSuccess` (repo idiom): the mutation then stays
 * `isPending` until the history really shows the new slot, instead of the panel closing on
 * the previous state for one frame.
 *
 * A 409 means the screen is LYING (another side accepted one of our slots, a window moved):
 * the message alone would leave the same stale options on screen, so the history is refetched
 * too — which also re-greys the selector.
 */
export function useCreateMatch(historyKey: QueryKey) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateMatchBody) =>
      apiFetch<CreateMatchResponse>('/matches', { method: 'POST', body }),
    onSuccess: () => refreshHistory(queryClient, historyKey),
    onError: (error) =>
      error instanceof ApiError && error.status === 409
        ? refreshHistory(queryClient, historyKey)
        : undefined,
  });
}

/**
 * Withdraws a slot nobody has accepted yet. The match is NOT deleted — it turns `cancelled`
 * and stays in the history, which is why the row must not be removed optimistically.
 *
 * `apiFetch` sends no body and therefore no `content-type` on a DELETE (`prepareBody` in
 * `lib/api.ts`), which is what keeps Fastify from answering 400 `FST_ERR_CTP_EMPTY_JSON_BODY`.
 */
export function useCancelMatch(historyKey: QueryKey) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (matchId: string) =>
      apiFetch<CancelMatchResponse>(`/matches/${encodeURIComponent(matchId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => refreshHistory(queryClient, historyKey),
    // 409 (accepted in the meantime) and 404 (gone) both mean the row on screen is stale.
    onError: (error) =>
      error instanceof ApiError && (error.status === 409 || error.status === 404)
        ? refreshHistory(queryClient, historyKey)
        : undefined,
  });
}
