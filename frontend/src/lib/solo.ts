import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { useLadders } from '@/lib/games';

import type { MatchOpponentView } from '@/lib/match-history';
import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of the two solo screens — `/solo` and `/solo/$ladderId`.
 *
 * 🚨 THE ONE ASYMMETRY TO KEEP IN MIND, because every design decision below follows from it:
 * **there is no such thing as joining a solo ladder.** A `rankings` row is created by the
 * first match RESULT, never by an enrolment (that is also true of teams, but a team at least
 * exists before its first match). So "the ladders I am on" is not a question the API can
 * answer, and it is not the question `/solo` asks: the page lists the 1v1 ladders that
 * EXIST and hangs my standing off them when there is one. Listing only ranked ladders would
 * greet every new account with an empty page and no way in.
 */

type MyMatchesResponse =
  paths['/matches/me']['get']['responses'][200]['content']['application/json'];

/** One row of `GET /matches/me` — aligned on the team history's payload by B-SOLO. */
export type SoloMatch = MyMatchesResponse['matches'][number];
/** Discriminated by `type`: a player in 1v1, a team from 2v2 up, or `null`. */
export type SoloMatchOpponent = SoloMatch['opponent'];

// ------------------------------------------------------------------- ladders

/**
 * The 1v1 ladders, from the same cached `GET /ladders` every other screen already uses.
 *
 * ⚠️ Filtered on `format`, never on a hard-coded list of games: today that is Chess 1v1 and
 * Rocket League 1v1, but the ladders come from a migration and adding one must light it up
 * here for free. Same rule FT-3 applied to map pools — the data decides, not a literal.
 */
export function useSoloLadders() {
  const query = useLadders();
  const ladders = (query.data?.ladders ?? []).filter((ladder) => ladder.format === '1v1');

  return { ladders, isPending: query.isPending, isError: query.isError };
}

// ------------------------------------------------------------------- matches

/**
 * The one literal for the cache entry of `GET /matches/me?ladderId=` — read here, invalidated
 * by the slot mutations of `lib/match-mutations.ts` (which take the key as a parameter for
 * exactly this reason). Same discipline as `teamMatchesKey`.
 *
 * 🚨 THE ARGUMENT IS REQUIRED, AND IT MUST STAY REQUIRED. [F-HIST] first made it optional
 * (defaulting to `'all'`) so that `/history` could reuse it for the UNFILTERED list — which
 * worked, but silently removed a compile-time guard: a future caller who simply forgot the id
 * would have invalidated `/history`'s entry instead of its own, and nothing would have said
 * so. `/history` spells its own key out instead (`['matches', 'me', 'all']`).
 *
 * 🔑 The two keys share the `['matches', 'me']` PREFIX on purpose: `useAcceptMatch` sweeps
 * every one of my histories with that prefix, so both entries are covered for free. The two
 * slot mutations, by contrast, are handed ONE key by their caller and therefore only refresh
 * the screen that opened or cancelled the slot — `/history` catches up on its next mount
 * (the client's default `staleTime` is 0), which is the only moment it can be looked at.
 */
export function myMatchesKey(ladderId: string) {
  return ['matches', 'me', ladderId] as const;
}

/**
 * My matches on ONE ladder.
 *
 * ⚠️ THE `ladderId` FILTER IS LOAD-BEARING, it is not a convenience. `GET /matches/me` with no
 * query returns every ladder at once, and the solo page feeds this list to `openSlotCount`
 * and `engagementTimes` — both of which mirror server-side counters that are scoped, in 1v1,
 * to the couple **(player, ladder)** (`countOpenSlots` / `hasConflictingMatch` filter on
 * `matches.ladder_id`). Handing them the unfiltered list would count a chess slot against a
 * Rocket League cap and grey out a quarter the server would happily accept.
 */
export function useMyMatches(ladderId: string, enabled: boolean) {
  return useQuery({
    queryKey: myMatchesKey(ladderId),
    queryFn: () =>
      apiFetch<MyMatchesResponse>(`/matches/me?ladderId=${encodeURIComponent(ladderId)}`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

// --------------------------------------------------------- external accounts
//
// ⚠️ MOVED OUT BY [F4B] → `lib/external-accounts.ts`. `useExternalAccounts` and
// `hasLinkedProvider` were written here because `/solo` was their first consumer; they now
// have three (`/home` and `/profile` too), and `/profile` adds the mutations that invalidate
// their cache entry. The key, its reader and its writers had to end up in one module — see
// the docblock there.

// ------------------------------------------------------------------ opponent

/**
 * Turns the discriminated `opponent` of `GET /matches/me` into something a row can render.
 *
 * 🚨 `opponent: null` HAS FOUR CAUSES and they do not read the same way:
 *   1. nobody has accepted the slot yet   → `null` here, the "Open slot" pill says it;
 *   2. the slot was cancelled             → `null` here, the "Cancelled" pill says it;
 *   3. the opposing TEAM was dissolved    → « Disbanded team » (2v2+ only);
 *   4. the 1v1 opponent DELETED HIS ACCOUNT → « Deleted player ».
 *
 * Cases 3 and 4 land on a match that was really played, so an em dash there would quietly
 * erase an opponent who existed. The two are told apart by the **`format` of the ladder** and
 * never by the null itself — that is the FT-4A trap, where reading "no team" as "solo"
 * renamed a camp after its first player and dropped a five-man line-up. `format` is a closed
 * enum in the contract, so the codegen hands us a literal union: it is a fact, not a guess.
 *
 * The dividing line between (1,2) and (3,4) is the STATUS: a match that reached
 * `in_progress` or beyond necessarily had two sides, so a missing opponent means one of them
 * disappeared afterwards. `pending` and `cancelled` are the only statuses a one-sided match
 * can legitimately be in.
 */
const HAD_AN_OPPONENT = new Set([
  'in_progress',
  'awaiting_confirmation',
  'completed',
  'disputed',
]);

export function matchOpponentView(match: SoloMatch): MatchOpponentView {
  const { opponent } = match;

  if (opponent === null) {
    if (!HAD_AN_OPPONENT.has(match.status)) return null;
    return { kind: 'gone', name: match.format === '1v1' ? 'Deleted player' : 'Disbanded team' };
  }

  if (opponent.type === 'user') {
    return {
      kind: 'user',
      pseudo: opponent.pseudo,
      name: opponent.displayName ?? opponent.pseudo,
    };
  }

  return { kind: 'team', id: opponent.id, name: opponent.name };
}
