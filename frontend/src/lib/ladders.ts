import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError, apiFetch } from '@/lib/api';
import { EM_DASH } from '@/lib/utils';

import type { paths } from '@/lib/api-types.gen';

/**
 * Everything that describes a LADDER and its standings.
 *
 * These helpers were written by FT-2A inside `lib/team-detail.ts`, because a team page was
 * their only reader. FT-3 is the second one — and a ladder page importing "team-detail"
 * would say the opposite of what the code does. So they MOVED here (rule of two): no logic
 * was rewritten, only the file they live in. `team-detail.ts` now reads from this module.
 */

type LadderDetailResponse =
  paths['/ladders/{id}']['get']['responses'][200]['content']['application/json'];
type LadderRankingsResponse =
  paths['/ladders/{id}/rankings']['get']['responses'][200]['content']['application/json'];

export type Ladder = LadderDetailResponse['ladder'];
export type LadderGame = LadderDetailResponse['game'];
export type RankingEntry = LadderRankingsResponse['rankings'][number];
export type Competitor = RankingEntry['competitor'];
export type TeamCompetitor = Extract<Competitor, { type: 'team' }>;

// Mirrors the backend param schema (`z.uuid()` in routes/ladders.ts): an id that cannot be
// a uuid can only ever come back as a 400, so a page renders its error state without
// spending a request — and without a red line in the console. Same shape as
// `isValidTeamId`, deliberately: two screens, one rule.
const ladderIdSchema = z.uuid();

export function isValidLadderId(ladderId: string) {
  return ladderIdSchema.safeParse(ladderId).success;
}

/**
 * A 4xx is a verdict, not a hiccup: retrying an unknown ladder three times (the TanStack
 * default) only delays the error screen and multiplies the browser's red lines.
 *
 * Shared with `lib/team-detail.ts` — same reasoning, same numbers.
 */
export function retryServerErrorsOnly(failureCount: number, error: Error) {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

/** Ladders, games and map pools are SEEDED reference data: they do not change in a session. */
const REFERENCE_STALE_TIME = 1000 * 60 * 60;

/**
 * Standings only move when a match is COMPLETED, which no screen can do yet. A minute of
 * freshness is what keeps a same-tab navigation (team page -> "See the full ladder") on the
 * cache: with the client default of 0, mounting a second observer on the very same key
 * refires the request the previous screen just made.
 */
const RANKINGS_STALE_TIME = 1000 * 60;

/** `GET /ladders/{id}` — the ladder, its parent game, and the game's map pool. */
export function useLadder(ladderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ladder', ladderId],
    queryFn: () => apiFetch<LadderDetailResponse>(`/ladders/${ladderId}`),
    enabled,
    retry: retryServerErrorsOnly,
    staleTime: REFERENCE_STALE_TIME,
  });
}

/**
 * One rankings request feeds the team page (header stats + ladder excerpt) AND the ladder
 * page. ⚠️ The key must stay `['ladder', id, 'rankings']` for that to hold: it is the cache
 * entry the excerpt already filled, so following "See the full ladder" costs nothing.
 */
export function useLadderRankings(ladderId: string | undefined) {
  return useQuery({
    queryKey: ['ladder', ladderId, 'rankings'],
    queryFn: () => apiFetch<LadderRankingsResponse>(`/ladders/${ladderId}/rankings`),
    // On the team page `ladderId` comes from GET /teams/{id}, so it is undefined on the
    // first render: firing early would request /ladders/undefined/rankings and get a 500.
    // The ladder page passes `undefined` for a malformed id, for the same reason.
    enabled: Boolean(ladderId),
    retry: retryServerErrorsOnly,
    staleTime: RANKINGS_STALE_TIME,
  });
}

// ---------------------------------------------------------------- competitors

export function isTeamCompetitor(competitor: Competitor): competitor is TeamCompetitor {
  return competitor.type === 'team';
}

export function competitorName(competitor: Competitor) {
  return competitor.type === 'user'
    ? (competitor.displayName ?? competitor.pseudo)
    : competitor.name;
}

export function competitorAvatarUrl(competitor: Competitor) {
  return (competitor.type === 'user' ? competitor.avatarUrl : competitor.logoUrl) ?? undefined;
}

/**
 * The consulted team's ladder line — `undefined` when the team is not ranked yet: a
 * line is created by the FIRST match result, not by team creation. Callers must show
 * an explicit "not ranked" state rather than a fabricated Elo.
 */
export function findTeamStanding(rankings: RankingEntry[], teamId: string) {
  return rankings.find(
    (entry) => isTeamCompetitor(entry.competitor) && entry.competitor.id === teamId,
  );
}

/**
 * A `size`-row slice of the ladder centred on the team. The window is clamped at both
 * ends so rank 1 still shows rows 1-5 instead of three rows and two holes. Falls back
 * to the top of the ladder when the team has no line yet.
 */
export function rankingWindow(
  rankings: RankingEntry[],
  standing: RankingEntry | undefined,
  size = 5,
) {
  if (rankings.length <= size) return rankings;

  const index = standing ? rankings.indexOf(standing) : -1;
  if (index === -1) return rankings.slice(0, size);

  const start = Math.min(Math.max(index - Math.floor(size / 2), 0), rankings.length - size);
  return rankings.slice(start, start + size);
}

// ---------------------------------------------------------------- formatting

export function formatRecord(wins: number, losses: number) {
  return `${wins}–${losses}`;
}

/**
 * Win rate, rounded. A competitor with no game played has no rate — `0%` would read as
 * "always loses" instead of "never played", so it stays an em dash.
 */
export function formatWinRate(wins: number, losses: number) {
  const played = wins + losses;
  if (played === 0) return EM_DASH;

  return `${Math.round((wins / played) * 100)}%`;
}
