import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { gameOrder } from '@/data/games';
import { matchOpponentView } from '@/lib/solo';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { useGames, useLadders } from '@/lib/games';

import type { SoloMatch } from '@/lib/solo';
import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of `/history` — every match of mine, all games and all ladders at once. There is no
 * pagination and no cursor: one request returns the lot.
 */
type MyMatchesResponse =
  paths['/matches/me']['get']['responses'][200]['content']['application/json'];

/** One row of `GET /matches/me` — the very shape the solo page already consumes. */
export type HistoryMatch = SoloMatch;
/** Closed enum from the contract: `1v1 | 2v2 | 3v3 | 5v5`. */
export type MatchFormat = HistoryMatch['format'];

/**
 * My whole match history, in 1 request. `'all'` can never collide with a real ladder: those are
 * uuids.
 */
export function useMyMatchHistory() {
  return useQuery({
    queryKey: ['matches', 'me', 'all'],
    queryFn: () => apiFetch<MyMatchesResponse>('/matches/me'),
    retry: retryServerErrorsOnly,
  });
}

// ------------------------------------------------------------------ identity

// GET /matches/me ships ids, not names. three row components on two pages have to print a
// ladder name, and hold only ids.

// matchLabeller returns:
export type MatchLabeller = {
  /** Ladder identity of one row. */
  gameName: (gameId: string) => string;
  forMatch: (match: HistoryMatch) => MatchLadderLabel;
};

// what forMatch returns
export type MatchLadderLabel = {
  game: string;
  format: MatchFormat;
  ladderName: string | undefined;
  // "Counter-Strike 2 5v5" when it is known — `undefined` otherwise.
};

export function matchLabeller(
  ladders: { id: string; name: string }[] | undefined,
  games: { id: string; name: string }[] | undefined,
): MatchLabeller {
  // map 1
  const gameNames = new Map((games ?? []).map((game) => [game.id, game.name]));
  // map 2
  const ladderNames = new Map((ladders ?? []).map((ladder) => [ladder.id, ladder.name]));

  // gameid -> game str
  const getgameName = (gameId: string) => gameNames.get(gameId) ?? gameId;

  return {
    gameName: getgameName,
    forMatch: (match) => ({
      game: getgameName(match.gameId),
      format: match.format, // '1v1' | '2v2' | '3v3' | '5v5'
      ladderName: ladderNames.get(match.ladderId), // Counter-Strike 2 2v2 (Wingman)
    }),
  };
}

export function useMatchLabeller(): MatchLabeller {
  const gamesQuery = useGames();
  const laddersQuery = useLadders();

  return matchLabeller(laddersQuery.data?.ladders, gamesQuery.data?.games);
}

// ------------------------------------------------------------- what needs me

export function needsMyAttention(match: Pick<HistoryMatch, 'status'>) {
  return match.status === 'awaiting_confirmation' || match.status === 'disputed';
}

const ONGOING_STATUSES = new Set<HistoryMatch['status']>([
  'pending',
  'in_progress',
  'awaiting_confirmation',
  'disputed',
]);

// The statuses that are not over yet, behind the "still in play" filter.
export function isOngoing(match: Pick<HistoryMatch, 'status'>) {
  return ONGOING_STATUSES.has(match.status);
}

// ------------------------------------------------------------------- filters

/** `undefined` on the three enums means "no filter", never "the user has not chosen". */
export type HistoryFilterState = {
  /** Free text, matched against the opponent's DISPLAYED name. `''` means "no filter". */
  query: string;
  gameId?: string;
  format?: MatchFormat;
  result?: 'win' | 'loss';
  ongoingOnly: boolean;
  /**
   * A SORT DIRECTION, NOT A FILTER — see `hasActiveHistoryFilters`, which deliberately ignores
   * it.
   */
  oldestFirst: boolean;
};

export const EMPTY_HISTORY_FILTERS: HistoryFilterState = {
  query: '',
  ongoingOnly: false,
  oldestFirst: false,
};

export function hasActiveHistoryFilters(filters: HistoryFilterState) {
  return Boolean(
    filters.query.trim() ||
    filters.gameId ||
    filters.format ||
    filters.result ||
    filters.ongoingOnly,
  );
}

export function matchOpponentName(match: HistoryMatch): string {
  return matchOpponentView(match)?.name ?? '';
}

export function historySummary({
  matched,
  total,
  filtersActive,
  oldestFirst,
  from,
  to,
}: {
  /** How many rows survive the filters — all pages taken together. */
  matched: number;
  total: number;
  filtersActive: boolean;
  oldestFirst: boolean;
  /** 1-based bounds of the page on screen. Equal to `1`/`matched` on a single page. */
  from: number;
  to: number;
}) {
  const matchWord = `match${total === 1 ? '' : 'es'}`;
  // THE ORDER IS NAMED IN **EVERY** VARIANT, and that is an accessibility requirement,
  const order = oldestFirst ? 'oldest first' : 'most recent first';
  const head = filtersActive
    ? `${matched} of ${total} ${matchWord} shown, ${order}.`
    : `${total} ${matchWord}, ${order}.`;

  // The range is only worth saying when a page is a subset of the matches
  return matched > to - from + 1 ? `${head} Showing ${from}–${to}.` : head;
}

/** EVERY FILTER IS APPLIED CLIENT-SIDE, */
export function applyHistoryFilters(matches: HistoryMatch[], filters: HistoryFilterState) {
  const needle = filters.query.trim().toLowerCase();

  return matches.filter(
    (match) =>
      (!needle || matchOpponentName(match).toLowerCase().includes(needle)) &&
      (!filters.gameId || match.gameId === filters.gameId) &&
      (!filters.format || match.format === filters.format) &&
      (!filters.result || match.result === filters.result) &&
      (!filters.ongoingOnly || isOngoing(match)),
  );
}

/** The sort control: one direction, applied to the order the server already chose. */
export function applyHistoryOrder(matches: HistoryMatch[], oldestFirst: boolean) {
  return oldestFirst ? [...matches].reverse() : matches;
}

// --------------------------------------------------------------- pagination

export const HISTORY_PAGE_SIZES = [10, 25, 50, 100] as const;

export type HistoryPageSize = (typeof HISTORY_PAGE_SIZES)[number];

export const DEFAULT_HISTORY_PAGE_SIZE: HistoryPageSize = 10;

export const MIN_HISTORY_PAGE_SIZE = HISTORY_PAGE_SIZES[0];

export function historyPageCount(matched: number, pageSize: number) {
  return Math.max(1, Math.ceil(matched / pageSize));
}

/** Clamps a page number against a list that may have shrunk under it. */
export function clampHistoryPage(page: number, matched: number, pageSize: number) {
  return Math.min(Math.max(page, 1), historyPageCount(matched, pageSize));
}

/** The rows of one page, plus the 1-based bounds the summary and the pager both need. */
export function historyPage(matches: HistoryMatch[], page: number, pageSize: number) {
  const safePage = clampHistoryPage(page, matches.length, pageSize);
  const start = (safePage - 1) * pageSize;
  const rows = matches.slice(start, start + pageSize);

  return {
    rows,
    page: safePage,
    pageCount: historyPageCount(matches.length, pageSize),
    // `0 of 0` rather than `1 of 0` on an empty result — the summary reads it verbatim.
    from: rows.length === 0 ? 0 : start + 1,
    to: start + rows.length,
  };
}

export function historyPageForSize(from: number, nextPageSize: number) {
  return Math.max(1, Math.floor(Math.max(from - 1, 0) / nextPageSize) + 1);
}

// returns { id: string; name: string }[]
export function historyGameOptions(matches: HistoryMatch[], gameName: (id: string) => string) {
  const rank = (id: string) => {
    const index = gameOrder.indexOf(id);
    return index === -1 ? gameOrder.length : index;
  };

  return [...new Set(matches.map((match) => match.gameId))]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((id) => ({ id, name: gameName(id) }));
}

export function historyFormatOptions(matches: HistoryMatch[], gameId: string | undefined) {
  const pool = gameId ? matches.filter((match) => match.gameId === gameId) : matches;

  return [...new Set(pool.map((match) => match.format))].sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );
}

// history with wins and losses ['win', 'loss'] history with only wins ['win'] empty history, or
// only ongoing matches with no result yet []
export function historyResultOptions(matches: HistoryMatch[]) {
  return (['win', 'loss'] as const).filter((result) =>
    matches.some((match) => match.result === result),
  );
}
