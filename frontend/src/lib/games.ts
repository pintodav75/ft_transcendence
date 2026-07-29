import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { gameOrder } from '@/data/games';

import type { components } from '@/lib/api-types.gen';

// Games and ladders are seeded reference data that doesn't change during a
// session, so we cache them for an hour: no refetch on remount or window focus.
const REFERENCE_STALE_TIME = 1000 * 60 * 60;

export type Game = {
  id: string;
  name: string;
  requiredProvider: string;
  isActive: boolean;
};

// Sorts games by the front-defined display order (data/games.ts); any game not
// listed there (not yet implemented front-side) is pushed to the end, keeping
// its incoming order via the stable sort. Copies first so the React Query cache
// array is never mutated in place.
export function sortGames(games: Game[]): Game[] {
  const rank = (id: string) => {
    const i = gameOrder.indexOf(id);
    return i === -1 ? gameOrder.length : i;
  };
  return [...games].sort((a, b) => rank(a.id) - rank(b.id));
}

export function useGames() {
  return useQuery({
    queryKey: ['games'],
    queryFn: () => apiFetch<{ games: Game[] }>('/games'),
    staleTime: REFERENCE_STALE_TIME,
  });
}

// useGames + display sort in one call, for the game collection components.
export function useSortedGames() {
  const query = useGames();
  const games = query.data ? sortGames(query.data.games) : [];
  return { games, isLoading: query.isLoading, isError: query.isError };
}

export type Ladder = {
  id: string;
  gameId: string;
  format: string;
  name: string;
  /**
   * Lockout window of §5.2, in minutes (60 in 5v5, 30 elsewhere). A match at `s` occupies
   * `]s − lockout, s + lockout[` for its side, which is what lets the client GREY OUT the
   * quarters a team is already engaged on instead of sending a POST bound for a 409.
   *
   * ⚠️ The field was already in the response (`Ladder` schema of `openapi.yaml`, and
   * `GET /ladders` does a bare `select()`): this hand-written type simply omitted it. No
   * backend change, nothing to regenerate.
   */
  lockoutMinutes: number;
};

// `enabled: false` keeps the request from leaving at all — used by the search bar, whose
// ladder→game map is dead weight when the search is restricted to players.
export function useLadders({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['ladders'],
    queryFn: () => apiFetch<{ ladders: Ladder[] }>('/ladders'),
    staleTime: REFERENCE_STALE_TIME,
    enabled,
  });
}

/**
 * The external account a game requires before a player can be fielded.
 *
 * ⚠️ Typed from the CODEGEN, not from the hand-written `Game` above: the union
 * (`riot | steam | epic | chess_com`) is a contract, and a page that renders a label per
 * member must break at compile time the day a provider is added.
 *
 * The labels moved out of `lib/team-detail.ts` when the ladder page became their second
 * reader — a ladder is a game × format, so "which account does this game require" belongs
 * with the games module, not with a team.
 */
export type RequiredProvider = components['schemas']['Game']['requiredProvider'];

const providerLabels: Record<RequiredProvider, string> = {
  riot: 'Riot',
  steam: 'Steam',
  epic: 'Epic',
  chess_com: 'chess.com',
};

export function providerLabel(provider: RequiredProvider) {
  return providerLabels[provider];
}

// Distinct ranking formats a game supports, derived from its ladders.
export function formatsForGame(ladders: Ladder[], gameId: string): string[] {
  const formats = ladders.filter((l) => l.gameId === gameId).map((l) => l.format);
  return [...new Set(formats)];
}
