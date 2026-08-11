import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { useLadders } from '@/lib/games';

import type { MatchOpponentView } from '@/lib/match-history';
import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of the two solo screens, /solo and /solo/$ladderId.
 *
 * the asymmetry everything here follows from: you don't JOIN a solo ladder. a rankings row is
 * created by the first match result, never by an enrolment. so "the ladders I am on" isn't a
 * question the API can answer — /solo lists the 1v1 ladders that exist and hangs my standing
 * off the ones I've played. listing only ranked ones gives a new account an empty page.
 */

type MyMatchesResponse =
  paths['/matches/me']['get']['responses'][200]['content']['application/json'];

/** One row of `GET /matches/me` — aligned on the team history's payload. */
export type SoloMatch = MyMatchesResponse['matches'][number];
/** Discriminated by `type`: a player in 1v1, a team from 2v2 up, or `null`. */
export type SoloMatchOpponent = SoloMatch['opponent'];

// ------------------------------------------------------------------- ladders

/** The 1v1 ladders, from the same cached `GET /ladders` every other screen already uses. */
export function useSoloLadders() {
  const query = useLadders();
  const ladders = (query.data?.ladders ?? []).filter((ladder) => ladder.format === '1v1');

  return { ladders, isPending: query.isPending, isError: query.isError };
}

// ------------------------------------------------------------------- matches

/**
 * The one literal for the cache entry of `GET /matches/me?ladderId=` — read here, invalidated
 * by the slot mutations of `lib/match-mutations.ts` (which take the key as a parameter for
 * exactly this reason).
 */
export function myMatchesKey(ladderId: string) {
  return ['matches', 'me', ladderId] as const;
}

/** My matches on ONE ladder. */
export function useMyMatches(ladderId: string, enabled: boolean) {
  return useQuery({
    queryKey: myMatchesKey(ladderId),
    queryFn: () =>
      apiFetch<MyMatchesResponse>(`/matches/me?ladderId=${encodeURIComponent(ladderId)}`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

// --------------------------------------------------- external accounts MOVED OUT
// Now in `lib/external-accounts.ts`.

// ------------------------------------------------------------------ opponent

/**
 * Turns the discriminated `opponent` of GET /matches/me into something a row can render.
 *
 * `opponent: null` has four causes and they don't read the same:
 *   1. nobody accepted the slot yet — the "Open slot" pill says it
 *   2. the slot was cancelled — the "Cancelled" pill says it
 *   3. the opposing team was disbanded (2v2+ only)
 *   4. the 1v1 opponent deleted his account
 * 3 and 4 were really played, so a dash there erases an opponent who existed.
 *
 * status splits (1,2) from (3,4): in_progress or beyond necessarily had two sides.
 * 3 vs 4 is told apart by the ladder's FORMAT, never by the null itself — reading "no team" as
 * "solo" is the trap that renames a camp after its first player and drops a 5-man line-up.
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
