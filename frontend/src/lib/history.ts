import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { gameOrder } from '@/data/games';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { useGames, useLadders } from '@/lib/games';

import type { SoloMatch } from '@/lib/solo';
import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of `/history` — every match of mine, all games and all ladders at once.
 *
 * 🔑 WHY THIS SCREEN EXISTS AND WHY IT NEEDS NO NEW ROUTE. `GET /matches/me` with NO query
 * already answers exactly this question: it unions the matches I was fielded in with the
 * matches of my teams where I sat on the bench, de-duplicates them, and sorts them by
 * `scheduledAt` desc. [B-SOLO] made its payload polymorphic FOR this page. There is no
 * pagination and no cursor: one request returns the lot.
 *
 * 🚨 NO GLOBAL WIN–LOSS RECORD, and that is a product decision, not an omission. Two reasons,
 * the second on its own being enough: the payload does not say whether I was FIELDED or on
 * the bench, so a substitute would be shown a record he never played; and above all a
 * cross-ladder record is meaningless — ten wins at chess and ten losses on cs2 are not "50 %".
 * The record lives where it means something: per ladder, on `/solo/$ladderId` and on a team
 * page.
 */
type MyMatchesResponse =
  paths['/matches/me']['get']['responses'][200]['content']['application/json'];

/** One row of `GET /matches/me` — the very shape the solo page already consumes. */
export type HistoryMatch = SoloMatch;
/** Closed enum from the contract: `1v1 | 2v2 | 3v3 | 5v5`. */
export type MatchFormat = HistoryMatch['format'];

/**
 * The cache entry of the UNFILTERED `GET /matches/me` — a helper of its own, and deliberately
 * not an optional argument on `myMatchesKey`.
 *
 * 🔑 A DEFAULT VALUE WOULD HAVE MADE A FORGOTTEN ID INVISIBLE: `myMatchesKey()` would compile,
 * and a caller who meant "my chess history" would have invalidated THIS entry instead of its
 * own, silently. Two names, two intentions, and the type system tells them apart.
 *
 * `'all'` can never collide with a real ladder: those are uuids. And the shared
 * `['matches', 'me']` prefix is what lets `useAcceptMatch` refresh both entries at once.
 */
export function historyMatchesKey() {
  return ['matches', 'me', 'all'] as const;
}

/**
 * My whole match history, in ONE request.
 *
 * ⚠️ NO `?ladderId=` — that parameter is load-bearing on `/solo/$ladderId` (its slot counters
 * mirror server-side counters scoped to one ladder) and would be exactly wrong here. The two
 * live in different cache entries; see `historyMatchesKey` and `myMatchesKey`.
 */
export function useMyMatchHistory() {
  return useQuery({
    queryKey: historyMatchesKey(),
    queryFn: () => apiFetch<MyMatchesResponse>('/matches/me'),
    retry: retryServerErrorsOnly,
  });
}

// ------------------------------------------------------------------ identity

/** What a row needs to say which ladder it was played on. */
export type MatchLadderLabel = {
  /** Display name of the game, or its slug when the game list could not be resolved. */
  game: string;
  format: MatchFormat;
  /** Full ladder name ("Counter-Strike 2 5v5") when it is known — `undefined` otherwise. */
  ladderName: string | undefined;
};

export type MatchLabeller = {
  /** Ladder identity of one row. */
  forMatch: (match: HistoryMatch) => MatchLadderLabel;
  /** Display name of a game slug — what the Game filter puts in its options. */
  gameName: (gameId: string) => string;
};

/**
 * Names the ladder and the game of every row, from the two REFERENCE CACHES the rest of the
 * app already fills (`GET /games` and `GET /ladders`, `staleTime` one hour).
 *
 * 🔑 `GET /matches/me` serves `gameId` and `ladderId`, never their names — resolving them
 * per row over the network would be one request per line. Same discipline as the game slug
 * of [F-GAMES]: the answer is already in cache, so it costs nothing.
 *
 * ⚠️ A ROW WHOSE LADDER IS UNKNOWN MUST STILL READ. Both lookups fall back instead of
 * rendering `undefined`: an unresolved game shows its slug (`cs2`), and the format comes
 * straight from the payload, so the cell always says something true. The full ladder name is
 * the one thing that can be missing, and only the "waiting on you" cards use it — with
 * `game + format` as their fallback, which is exactly what a ladder IS
 * (`ladders_game_format_unique`).
 */
export function matchLabeller(
  ladders: { id: string; name: string }[] | undefined,
  games: { id: string; name: string }[] | undefined,
): MatchLabeller {
  const gameNames = new Map((games ?? []).map((game) => [game.id, game.name]));
  const ladderNames = new Map((ladders ?? []).map((ladder) => [ladder.id, ladder.name]));
  const gameName = (gameId: string) => gameNames.get(gameId) ?? gameId;

  return {
    gameName,
    forMatch: (match) => ({
      game: gameName(match.gameId),
      format: match.format,
      ladderName: ladderNames.get(match.ladderId),
    }),
  };
}

/** The two reference lists this page reads, from the caches every other screen fills. */
export function useMatchLabeller(): MatchLabeller {
  const gamesQuery = useGames();
  const laddersQuery = useLadders();

  return matchLabeller(laddersQuery.data?.ladders, gamesQuery.data?.games);
}

// ------------------------------------------------------------- what needs me

/**
 * The two statuses that are WAITING ON SOMEBODY, and the reason this page is worth building.
 *
 * 🔑 Nothing else in the app groups them: they are scattered across one team page per team
 * and one `/solo/$ladderId` per ladder. And they have a DEADLINE — the 24 h job
 * (`backend/src/jobs/index.ts`) auto-confirms a match left in `awaiting_confirmation` on the
 * single score that was submitted, and auto-cancels a dispute no admin has settled. Not
 * seeing them costs matches, in silence.
 */
export function needsMyAttention(match: Pick<HistoryMatch, 'status'>) {
  return match.status === 'awaiting_confirmation' || match.status === 'disputed';
}

/**
 * The statuses that are not over yet, behind the "still in play" filter.
 *
 * `pending` (an open slot, or one somebody has accepted) and `cancelled` are deliberately
 * LISTED by default — a withdrawn slot is part of the history — but a cancelled one is over,
 * so the filter drops it along with `completed`.
 */
// ⚠️ Typed on the CODEGEN union, not `Set<string>`: `status` is a closed enum in the contract,
// so a typo (`'in-progress'`) must fail the build instead of silently filtering nothing out.
const ONGOING_STATUSES = new Set<HistoryMatch['status']>([
  'pending',
  'in_progress',
  'awaiting_confirmation',
  'disputed',
]);

export function isOngoing(match: Pick<HistoryMatch, 'status'>) {
  return ONGOING_STATUSES.has(match.status);
}

// ------------------------------------------------------------------- filters

/** `undefined` on the first three means "no filter", never "the user has not chosen". */
export type HistoryFilterState = {
  gameId?: string;
  format?: MatchFormat;
  result?: 'win' | 'loss';
  ongoingOnly: boolean;
};

export const EMPTY_HISTORY_FILTERS: HistoryFilterState = { ongoingOnly: false };

export function hasActiveHistoryFilters(filters: HistoryFilterState) {
  return Boolean(filters.gameId || filters.format || filters.result || filters.ongoingOnly);
}

/**
 * How much of the history is on screen, in one sentence — **rendered** under the filters AND
 * **announced** when a filter changes.
 *
 * 🔑 ONE function for both readers, deliberately. A screen reader gets no feedback from a
 * `<select>` beyond the option it just picked: the table silently becomes something else, and
 * on this screen the four controls have no other effect (WCAG 4.1.3, status messages). Since
 * the announcement has to exist, it must be impossible for it to say something different from
 * what is written on screen — so both read the same function, never two hand-kept strings.
 */
export function historySummary(visible: number, total: number, filtersActive: boolean) {
  const matchWord = `match${total === 1 ? '' : 'es'}`;
  return filtersActive
    ? `${visible} of ${total} ${matchWord} shown.`
    : `${total} ${matchWord}, most recent first.`;
}

/**
 * 🚨 EVERY FILTER IS APPLIED CLIENT-SIDE, and no request is ever re-issued. The route returns
 * the WHOLE history in one call, so narrowing it is a `filter()` — asking the server again
 * would be a round trip for data already on the page, and it would put a spinner where the
 * answer is instant.
 */
export function applyHistoryFilters(matches: HistoryMatch[], filters: HistoryFilterState) {
  return matches.filter(
    (match) =>
      (!filters.gameId || match.gameId === filters.gameId) &&
      (!filters.format || match.format === filters.format) &&
      (!filters.result || match.result === filters.result) &&
      (!filters.ongoingOnly || isOngoing(match)),
  );
}

/**
 * 🚨 THE OPTIONS ARE DERIVED FROM THE MATCHES, NEVER FROM THE CONTRACT'S ENUMS. This is the
 * [F-MM] trap, restated: offering "Valorant" + "1v1" there produced an empty board and left
 * the reader unable to tell "nobody is playing" from "that combination cannot exist". Here we
 * hold the entire dataset, so every option is guaranteed to match at least one row.
 *
 * Ordered by the front's display order (`data/games.ts`), with anything unknown pushed to the
 * end by slug — the same rank function `sortGames` uses, applied to bare ids because the game
 * list may have failed to load and a filter must keep working without it.
 */
export function historyGameOptions(matches: HistoryMatch[], gameName: (id: string) => string) {
  const rank = (id: string) => {
    const index = gameOrder.indexOf(id);
    return index === -1 ? gameOrder.length : index;
  };

  return [...new Set(matches.map((match) => match.gameId))]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((id) => ({ id, name: gameName(id) }));
}

/**
 * The formats present, restricted to the selected game when there is one — cascading exactly
 * as the matchmaking board does, so switching game can never leave a format selected that the
 * new game does not have.
 *
 * Sorted by side size (1v1 before 5v5): the format is a number, and `'2v2' < '5v5'` happens
 * to agree here, but reading the number says what we mean.
 */
export function historyFormatOptions(matches: HistoryMatch[], gameId: string | undefined) {
  const pool = gameId ? matches.filter((match) => match.gameId === gameId) : matches;

  return [...new Set(pool.map((match) => match.format))].sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );
}

/**
 * Win / loss, offered only when the history actually holds one.
 *
 * ⚠️ `result` is SERVER-DERIVED (from `winnerSideId` compared to my side) and is never
 * recomputed here: a match settled by an admin has a result and no score at all.
 */
export function historyResultOptions(matches: HistoryMatch[]) {
  return (['win', 'loss'] as const).filter((result) =>
    matches.some((match) => match.result === result),
  );
}
