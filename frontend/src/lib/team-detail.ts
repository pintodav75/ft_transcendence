import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { apiFetch } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';

export type TeamDetail = components['schemas']['TeamDetail'];
export type TeamMember = components['schemas']['TeamMember'];
export type TeamInvitation = components['schemas']['TeamInvitation'];

type TeamDetailResponse =
  paths['/teams/{id}']['get']['responses'][200]['content']['application/json'];
type TeamMatchesResponse =
  paths['/teams/{id}/matches']['get']['responses'][200]['content']['application/json'];

export type TeamMatch = TeamMatchesResponse['matches'][number];
export type MatchLineup = NonNullable<TeamMatch['lineup']>;
export type LineupPlayer = MatchLineup['self'][number];

// The backend refuses an eleventh slot (`used >= 10` -> 409 `roster_full`).
export const ROSTER_LIMIT = 10;

// Mirrors the backend param schema (`z.uuid()` in routes/teams.ts): an id that cannot be a uuid
// can only ever come back as a 400, so the page renders its error state without spending a
// request — and without a red line in the console.
const teamIdSchema = z.uuid();

export function isValidTeamId(teamId: string) {
  return teamIdSchema.safeParse(teamId).success;
}

export function useTeam(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['team', teamId],
    queryFn: () => apiFetch<TeamDetailResponse>(`/teams/${teamId}`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

/** The one literal for this team's history cache entry. */
export function teamMatchesKey(teamId: string) {
  return ['team', teamId, 'matches'] as const;
}

export function useTeamMatches(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: teamMatchesKey(teamId),
    queryFn: () => apiFetch<TeamMatchesResponse>(`/teams/${teamId}/matches`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

// ---------------------------------------------------------------- derivations

/** How many of the 10 roster slots are taken. */
export function rosterUsage(members: TeamMember[], invitations: TeamInvitation[]) {
  const pending = invitations.length;
  const used = members.length + pending;

  return { used, pending, full: used >= ROSTER_LIMIT };
}

/**
 * Not here, on purpose (a solo ladder uses both, and importing "team-detail" from /solo would
 * say the opposite of what the code does). No re-export shim — import them directly:
 *   - slot rules (MAX_OPEN_SLOTS, MIN_LEAD_MINUTES, slotDays, ...) -> lib/match-slots.ts
 *   - history derivations (recentForm, nextOpenSlot, formatScore, ...) -> lib/match-history.ts
 */

/** Nominative line-up of one side, members only (the key is absent for a visitor). */
export function formatLineup(players: LineupPlayer[]) {
  return players.map((player) => player.displayName ?? player.pseudo).join(' · ');
}

/**
 * `ladderName` is usually just "<game> <format>" ("Rocket League 2v2"), which the header
 * subtitle already spells out on its own — repeating it read "Rocket League · 2v2 · Rocket
 * League 2v2".
 */
export function ladderSubtitle(ladderName: string, gameName: string, format: string) {
  const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return squash(ladderName) === squash(`${gameName}${format}`) ? undefined : ladderName;
}

// ---------------------------------------------------------------- formatting

/**
 * `formatMatchDate` and `formatEloDelta` MOVED to `lib/match-detail.ts` (rule of the
 * second use): they format a MATCH, not a team, and the match sheet is their second reader.
 */
