import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { gameOrder } from '@/data/games';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';

// Games and ladders are seeded reference data that doesn't change during a session, so we cache
// them for an hour: no refetch on remount or window focus.
const REFERENCE_STALE_TIME = 1000 * 60 * 60;

export type Game = {
  id: string;
  name: string;
  /**
   * Typed from the CODEGEN union (see `RequiredProvider` below), not `string`: a screen that
   * renders one label per provider must break at COMPILE TIME the day a provider is added,
   * instead of rendering `undefined` at runtime.
   */
  requiredProvider: RequiredProvider;
  isActive: boolean;
};

// Sorts games by the front-defined display order (data/games.ts); any game not listed there
// (not yet implemented front-side) is pushed to the end, keeping its incoming order via the
// stable sort.
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

type GameDetailResponse =
  paths['/games/{id}']['get']['responses'][200]['content']['application/json'];

/** `GET /games/{id}` — the game AND its map pool. */
export function useGameDetail(gameId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['game', gameId],
    queryFn: () => apiFetch<GameDetailResponse>(`/games/${gameId}`),
    enabled,
    retry: retryServerErrorsOnly,
    staleTime: REFERENCE_STALE_TIME,
  });
}

export type Ladder = {
  id: string;
  gameId: string;
  format: string;
  name: string;
  /** Lockout window of §5.2, in minutes (60 in 5v5, 30 elsewhere). */
  lockoutMinutes: number;
};

// `enabled: false` keeps the request from leaving at all — used by the search bar, whose
// laddergame map is dead weight when the search is restricted to players.
export function useLadders({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['ladders'],
    queryFn: () => apiFetch<{ ladders: Ladder[] }>('/ladders'),
    staleTime: REFERENCE_STALE_TIME,
    enabled,
  });
}

export type GameByLadder = Map<string, { game: string; format: string }>;

/** `ladderId` le jeu et le format de ce ladder. */
export function useGameByLadder({ enabled = true }: { enabled?: boolean } = {}) {
  const { data } = useLadders({ enabled });
  return useMemo(() => {
    const map: GameByLadder = new Map();
    for (const ladder of data?.ladders ?? []) {
      map.set(ladder.id, { game: ladder.gameId, format: ladder.format });
    }
    return map;
  }, [data]);
}

/** The external account a game requires before a player can be fielded. */
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

/** Every provider the platform knows about, in display order. */
export const ALL_PROVIDERS = Object.keys(providerLabels) as RequiredProvider[];

// Distinct ranking formats a game supports, derived from its ladders.
export function formatsForGame(ladders: Ladder[], gameId: string): string[] {
  const formats = ladders.filter((l) => l.gameId === gameId).map((l) => l.format);
  return [...new Set(formats)];
}
