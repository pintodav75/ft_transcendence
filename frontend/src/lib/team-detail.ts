import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError, apiFetch } from '@/lib/api';

import type { components, paths } from '@/lib/api-types.gen';

export type TeamDetail = components['schemas']['TeamDetail'];
export type TeamMember = components['schemas']['TeamMember'];
export type TeamInvitation = components['schemas']['TeamInvitation'];
export type RequiredProvider = TeamDetail['requiredProvider'];

type TeamDetailResponse =
  paths['/teams/{id}']['get']['responses'][200]['content']['application/json'];
type TeamMatchesResponse =
  paths['/teams/{id}/matches']['get']['responses'][200]['content']['application/json'];
type LadderRankingsResponse =
  paths['/ladders/{id}/rankings']['get']['responses'][200]['content']['application/json'];

export type TeamMatch = TeamMatchesResponse['matches'][number];
export type MatchLineup = NonNullable<TeamMatch['lineup']>;
export type LineupPlayer = MatchLineup['self'][number];
export type RankingEntry = LadderRankingsResponse['rankings'][number];
export type Competitor = RankingEntry['competitor'];
export type TeamCompetitor = Extract<Competitor, { type: 'team' }>;

// The backend refuses an eleventh slot (`used >= 10` -> 409 `roster_full`). It is a
// flat cap, NOT derived from the format: a 2v2 team may bench extra players, so the
// format only sizes a lineup. Since B-INV a PENDING INVITATION holds a slot too — see
// `rosterUsage` below.
export const ROSTER_LIMIT = 10;

/** Used where a value is legitimately unknown (no score, no Elo delta, no date). */
export const EM_DASH = '—';

// Mirrors the backend param schema (`z.uuid()` in routes/teams.ts): an id that cannot
// be a uuid can only ever come back as a 400, so the page renders its error state
// without spending a request — and without a red line in the console.
const teamIdSchema = z.uuid();

export function isValidTeamId(teamId: string) {
  return teamIdSchema.safeParse(teamId).success;
}

/**
 * A 4xx is a verdict, not a hiccup: retrying an unknown team three times (the TanStack
 * default) only delays the error screen and multiplies the browser's red lines.
 */
function retryServerErrorsOnly(failureCount: number, error: Error) {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

export function useTeam(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['team', teamId],
    queryFn: () => apiFetch<TeamDetailResponse>(`/teams/${teamId}`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

export function useTeamMatches(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['team', teamId, 'matches'],
    queryFn: () => apiFetch<TeamMatchesResponse>(`/teams/${teamId}/matches`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

// One rankings request feeds BOTH the header stats (Elo, record, rank) and the
// ladder excerpt of the Overview tab — same query key, so the second reader hits
// the cache.
export function useLadderRankings(ladderId: string | undefined) {
  return useQuery({
    queryKey: ['ladder', ladderId, 'rankings'],
    queryFn: () => apiFetch<LadderRankingsResponse>(`/ladders/${ladderId}/rankings`),
    // ladderId comes from GET /teams/{id}, so it is undefined on the first render:
    // firing early would request /ladders/undefined/rankings and get a 500.
    enabled: Boolean(ladderId),
    retry: retryServerErrorsOnly,
  });
}

// ---------------------------------------------------------------- derivations

/**
 * How many of the 10 roster slots are taken.
 *
 * The cap counts the SUM of members and pending invitations: the backend checks
 * `members + pending >= 10` when the captain invites, and a decline or a cancellation
 * gives the slot back. A counter showing members only would say "4/10" while the server
 * answers 409 `roster_full` — the screen would be contradicting the rule it displays.
 *
 * ⚠️ NO ROLE GUARD HERE, and none anywhere else on `invitations`. `GET /teams/{id}` OMITS
 * the key for a non-member (absent, not empty — same progressive disclosure as `lineup` on
 * the match history), so `data?.invitations ?? []` already yields `[]` for a visitor.
 * Re-deriving "may I see this?" client-side would be a second source of truth, and the two
 * would drift the day the backend changes its mind.
 */
export function rosterUsage(members: TeamMember[], invitations: TeamInvitation[]) {
  const pending = invitations.length;
  const used = members.length + pending;

  return { used, pending, full: used >= ROSTER_LIMIT };
}

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
export function rankingWindow(rankings: RankingEntry[], standing: RankingEntry | undefined, size = 5) {
  if (rankings.length <= size) return rankings;

  const index = standing ? rankings.indexOf(standing) : -1;
  if (index === -1) return rankings.slice(0, size);

  const start = Math.min(Math.max(index - Math.floor(size / 2), 0), rankings.length - size);
  return rankings.slice(start, start + size);
}

export type FormResult = 'win' | 'loss' | 'dispute';

/**
 * Last results, most recent first — the history is already sorted by `scheduledAt`
 * DESC. Matches without an outcome (open slot, in progress) are skipped; a match an
 * admin still has to settle counts as an unknown, not as a loss.
 */
export function recentForm(matches: TeamMatch[], limit = 5) {
  const form: { id: string; result: FormResult }[] = [];

  for (const match of matches) {
    if (match.disputeStatus === 'open') form.push({ id: match.id, result: 'dispute' });
    else if (match.result) form.push({ id: match.id, result: match.result });

    if (form.length === limit) break;
  }

  return form;
}

/**
 * The soonest slot still waiting for an opponent. Members only in practice: the
 * backend strips opponent-less matches from a non-member's history.
 */
export function nextOpenSlot(matches: TeamMatch[]) {
  return matches
    .filter((match) => match.status === 'pending' && match.opponent === null)
    // The history arrives DESC, so plain array order would surface the LATEST slot.
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
    .at(0);
}

export function openDisputeCount(matches: TeamMatch[]) {
  return matches.filter((match) => match.disputeStatus === 'open').length;
}

/** A lineup is ABSENT (not null) for a non-member: never assume the key is there. */
export function hasLineups(matches: TeamMatch[]) {
  return matches.some((match) => match.lineup !== undefined);
}

/** Nominative line-up of one side, members only (the key is absent for a visitor). */
export function formatLineup(players: LineupPlayer[]) {
  return players.map((player) => player.displayName ?? player.pseudo).join(' · ');
}

/**
 * `ladderName` is usually just "<game> <format>" ("Rocket League 2v2"), which the header
 * subtitle already spells out on its own — repeating it read "Rocket League · 2v2 ·
 * Rocket League 2v2". Some ladders DO carry more ("Counter-Strike 2 2v2 (Wingman)"), so
 * the name is kept whenever it says something the game and the format do not.
 */
export function ladderSubtitle(ladderName: string, gameName: string, format: string) {
  const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return squash(ladderName) === squash(`${gameName}${format}`) ? undefined : ladderName;
}

const providerLabels: Record<RequiredProvider, string> = {
  riot: 'Riot',
  steam: 'Steam',
  epic: 'Epic',
  chess_com: 'chess.com',
};

export function providerLabel(provider: RequiredProvider) {
  return providerLabels[provider];
}

// ---------------------------------------------------------------- formatting

// Built once at module scope: an Intl formatter is expensive to create and these
// options never change.
const shortDateFormat = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const longDateFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * `scheduledAt` / `completedAt` are ISO **strings** that can be `null` — and
 * `new Date(null)` silently yields 1970 instead of failing, so the null check is the
 * whole point of this helper.
 */
export function formatMatchDate(iso: string | null, style: 'short' | 'long' = 'short') {
  if (!iso) return EM_DASH;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EM_DASH;

  return (style === 'long' ? longDateFormat : shortDateFormat).format(date);
}

/** Bo3 score, or an em dash: `null` is possible even on a completed match. */
export function formatScore(score: TeamMatch['score']) {
  if (score.self === null || score.opponent === null) return EM_DASH;
  return `${score.self}–${score.opponent}`;
}

/** Signed Elo delta with a real minus sign (U+2212), never a hyphen. */
export function formatEloDelta(eloDelta: number | null) {
  if (eloDelta === null) return EM_DASH;
  if (eloDelta < 0) return `−${Math.abs(eloDelta)}`;
  return `+${eloDelta}`;
}

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
