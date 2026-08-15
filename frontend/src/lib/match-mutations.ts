import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, RATE_LIMITED_MESSAGE, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { MAX_OPEN_SLOTS } from '@/lib/match-slots';
import { OPEN_SLOTS_ROOT_KEY } from '@/lib/matchmaking';
import { WINS_REQUIRED } from '@/lib/match-result-schema';
import { myMatchesKey } from '@/lib/solo';
import { teamMatchesKey } from '@/lib/team-detail';

import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { SubmitResultBody } from '@/lib/match-result-schema';
import type { paths } from '@/lib/api-types.gen';

/**
 * Write side of a match: reporting a result, opening and cancelling a slot.
 * Read side is lib/match-detail.ts.
 *
 * the slot hooks live here and not in team-mutations.ts because a 1v1 ladder opens and cancels
 * slots too, where nothing is a team. they're key-driven for that reason.
 * queries and mutations stay in separate modules so you can see what invalidates what.
 */
type SubmitResultResponse =
  paths['/matches/{id}/result']['post']['responses'][200]['content']['application/json'];
type CreateMatchBody = paths['/matches']['post']['requestBody']['content']['application/json'];
type CreateMatchResponse = paths['/matches']['post']['responses'][201]['content']['application/json'];
type CancelMatchResponse =
  paths['/matches/{id}']['delete']['responses'][200]['content']['application/json'];
type AcceptMatchResponse =
  paths['/matches/{id}/accept']['post']['responses'][200]['content']['application/json'];

/**
 * What the server made of my submission — the three ends of the state machine, straight from
 * the contract (closed enum in `openapi.yaml`, so the codegen hands us a literal union).
 */
export type SubmitResultStatus = SubmitResultResponse['status'];

// ---------------------------------------------------------------- error mapping

/** Turns the route's refusals into something a human can act on. */
export function submitResultErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    // 100 req/min per account. Reachable by a jumpy user, so it must say "wait", not "failed".
    if (error.status === 429) return RATE_LIMITED_MESSAGE;

    if (error.status === 400) {
      // Three causes, and the screen pre-empts all three: the controls cannot produce an
      // illegal best-of-3, the winner is picked FROM the two sides (never typed), and the form
      // is only offered once kick-off has passed.
      return `This result was refused: a best-of-3 ends ${WINS_REQUIRED}–0 or ${WINS_REQUIRED}–1 in favour of the declared winner, and a match cannot be reported before its kick-off time.`;
    }

    // Should never surface: the form is only rendered for the captain of a side (the player in
    // 1v1). It fires on a stale page — the team changed hands while the tab sat open.
    if (error.status === 403) {
      return 'You are not the one who reports for this side: in a team match only the captain can, in 1v1 only the player.';
    }

    if (error.status === 404) return 'This match no longer exists.';

    // The other side confirmed, contested, or a 24 h job closed the match while this page was
    // open. The screen is stale, hence the refetch in `onError` below.
    if (error.status === 409) {
      return 'This match is no longer waiting for a result — it has just been settled or closed. The page is refreshing.';
    }
  }

  return 'Could not report this result.';
}

/** Is this the ONE refusal that pulls the screen out from under its own error message? */
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

/** Reports a result: first submission, confirmation of the opponent's, or contestation. */
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
      // d'équipe sur un ladder 2v2+, ma ligne perso sur un ladder solo.
      refreshes.push(
        queryClient.invalidateQueries({
          queryKey: teamId ? teamMatchesKey(teamId) : myMatchesKey(ladderId),
        }),
      );

      // ONLY on `completed`.
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
    // A 409 means the screen is LYING (the other side answered while this tab sat open): the
    // message alone would leave the same dead buttons on display.
    onError: (error) =>
      error instanceof ApiError && error.status === 409
        ? queryClient.invalidateQueries({ queryKey: ['match', matchId] })
        : undefined,
  });
}

// ------------------------------------------------------------------------------- slots

/** ONE key, and only one. */
function refreshHistory(queryClient: QueryClient, historyKey: QueryKey) {
  return queryClient.invalidateQueries({ queryKey: historyKey });
}

/**
 * Zod's 400 has an `errors` ARRAY and no `error` field; the business 400s have `error` and no
 * `errors`.
 */
function hasZodIssues(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return false;
  if (!('errors' in payload)) return false;

  const { errors } = payload as Record<'errors', unknown>;
  return Array.isArray(errors);
}

/**
 * `POST /matches` answers `{ error, unlinkedPlayers }` when a selected player has no linked
 * game account.
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
 * drawn and the moment the request landed.
 */
export function isExpiredSlotError(error: unknown) {
  return error instanceof ApiError && error.status === 400 && hasZodIssues(error.payload);
}

/**
 * What the caller must tell us to phrase a refusal — discriminated by `side`, because the two
 * ladders do not fail the same way.
 */
export type CreateMatchErrorContext =
  | {
      side: 'team';
      /**
       * Locally counted still-valid open slots (`openSlotCount`). This is what tells the two
       * 409s of `POST /matches` apart — see below.
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
      // THE TWO 409s OF THIS ROUTE CARRY NO STABLE `code` — unlike the invitation routes.
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
      // Zod: off-grid time, or a slot that fell under the 15-minute bound while the panel was open.
      if (hasZodIssues(error.payload)) {
        return 'That time slot has just passed — pick another one.';
      }

      if (context.side === 'solo') {
        // §5.1, single player flavour: `validateSide()` answers « you must have a linked
        // <provider> account » with no array to map.
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

/** Opens a slot on a ladder. */
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

/** Withdraws a slot nobody has accepted yet. */
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

// ------------------------------------------------------------ accepting a slot

export type AcceptMatchVariables = {
  matchId: string;
  /** EXACTLY `format_size` roster ids on a 2v2+ ladder, **omitted entirely in 1v1**. */
  lineup?: string[];
  /** The team I am committing, when there is one. */
  teamId?: string;
};

/** Message for a refusal of `POST /matches/{id}/accept`. */
export function acceptMatchErrorMessage(error: unknown, members: { id: string; pseudo: string }[]) {
  // 403 (`only the captain can engage the team` — the team changed hands) and 429.
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    if (error.status === 409) {
      // Four causes in the contract and NONE of them carries a stable `code`: no longer
      // pending, expired, race lost against another camp, §5.2 clash.
      return 'This slot is no longer available: another camp has just taken it, or it has passed its acceptance deadline. The board is refreshing.';
    }

    if (error.status === 404) return 'This slot no longer exists.';

    if (error.status === 400) {
      // §5.1 in its TEAM flavour: the answer carries `unlinkedPlayers`, an array of uuids the
      // caller maps onto its roster — a raw uuid explains nothing to a captain.
      const unlinked = unlinkedPlayerIds(error.payload);
      if (unlinked.length > 0) {
        const named = unlinked
          .map((id) => members.find((member) => member.id === id)?.pseudo)
          .filter((pseudo): pseudo is string => Boolean(pseudo))
          .map((pseudo) => `@${pseudo}`);

        return named.length > 0
          ? `${named.join(', ')} no longer has a linked game account — unselect them and pick someone else.`
          : 'One of the selected players no longer has a linked game account.';
      }

      // Zod (a line-up of the wrong size), a player who has left the roster, or — in 1v1 — §5.1
      // with no array to map, since there is only one player and he is reading this.
      return 'This line-up was refused: every player must still be on this team, with a linked game account.';
    }
  }

  return 'Could not accept this slot.';
}

/** Did the slot disappear from under the click? */
export function isSlotGone(error: unknown) {
  return error instanceof ApiError && (error.status === 409 || error.status === 404);
}

/**
 * Takes the second side of an open slot. The match starts immediately (`in_progress`), and the
 * caller then routes to its sheet.
 */
export function useAcceptMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matchId, lineup }: AcceptMatchVariables) =>
      apiFetch<AcceptMatchResponse>(`/matches/${encodeURIComponent(matchId)}/accept`, {
        method: 'POST',
        // See `AcceptMatchVariables.lineup`: no key at all in 1v1, never an empty one.
        ...(lineup ? { body: { lineup } } : {}),
      }),
    onSuccess: (_data, { teamId }) => {
      const refreshes = [
        // EVERY filter combination of the board, by prefix: the slot is gone from all of them,
        // and the accept also cancelled my own overlapping slots, which were listed nowhere
        // else.
        queryClient.invalidateQueries({ queryKey: OPEN_SLOTS_ROOT_KEY }),
        // My own histories, all ladders: `myMatchesKey(id)` is `['matches', 'me', id]`, so the
        // shared prefix sweeps them without this hook having to know which ladder is on screen.
        queryClient.invalidateQueries({ queryKey: ['matches', 'me'] }),
      ];

      if (teamId) refreshes.push(queryClient.invalidateQueries({ queryKey: teamMatchesKey(teamId) }));

      return Promise.all(refreshes);
    },
    // The board is LYING (the slot was taken or expired while the page sat open): the message
    // alone would leave the same dead button on screen.
    onError: (error) =>
      error instanceof ApiError && (error.status === 409 || error.status === 404)
        ? queryClient.invalidateQueries({ queryKey: OPEN_SLOTS_ROOT_KEY })
        : undefined,
  });
}
