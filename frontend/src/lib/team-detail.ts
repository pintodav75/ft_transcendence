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

// The backend refuses an eleventh slot (`used >= 10` -> 409 `roster_full`). It is a
// flat cap, NOT derived from the format: a 2v2 team may bench extra players, so the
// format only sizes a lineup. Since B-INV a PENDING INVITATION holds a slot too — see
// `rosterUsage` below.
export const ROSTER_LIMIT = 10;

// Mirrors the backend param schema (`z.uuid()` in routes/teams.ts): an id that cannot
// be a uuid can only ever come back as a 400, so the page renders its error state
// without spending a request — and without a red line in the console.
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

/**
 * The one literal for this team's history cache entry.
 *
 * Exported so the slot mutations invalidate the very key this hook fills — they live in
 * `lib/match-mutations.ts` since [F-SOLO] and are key-driven, because the same two mutations
 * now serve a solo history under a completely different key. Two literals in two modules is
 * exactly how a cache stops refreshing after a rename nobody noticed (same reasoning as
 * `MY_INVITATIONS_KEY` in `lib/teams.ts`).
 */
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

/**
 * ⚠️ THE SLOT RULES AND THE HISTORY DERIVATIONS MOVED OUT (F-SOLO, rule of the second use).
 *
 * - `lib/match-slots.ts` — `MAX_OPEN_SLOTS`, `MIN_LEAD_MINUTES`, `SLOT_GRID_MINUTES`,
 *   `SLOT_LEAD_MARGIN_MINUTES`, `SLOT_HORIZON_DAYS`, `engagementTimes`, `openSlotCount`,
 *   `conflictsWithEngagement`, `slotDays`, `slotTimes`, `SlotDay`, `SlotTime`.
 * - `lib/match-history.ts` — `recentForm`, `nextOpenSlot`, `openDisputeCount`,
 *   `isCancellableSlot`, `formatScore`, `FormResult`.
 *
 * A 1v1 ladder opens its slots under the very same rules and asks its history the very same
 * questions, and a solo page importing "team-detail" would say the opposite of what the code
 * does. Nothing was rewritten — only the file they live in, and their inputs became
 * structural so both `GET /teams/{id}/matches` and `GET /matches/me` satisfy them.
 *
 * There is deliberately NO re-export shim here: it would hide the move from the next reader,
 * exactly as `formatMatchDate` was moved to `lib/match-detail.ts` without one.
 */

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

// ---------------------------------------------------------------- formatting

/**
 * ⚠️ `formatMatchDate` and `formatEloDelta` MOVED to `lib/match-detail.ts` (FT-4A, rule of
 * the second use): they format a MATCH, not a team, and the match sheet is their second
 * reader. `formatScore` MOVED to `lib/match-history.ts` (F-SOLO, same rule): its
 * `{ self, opponent }` pair is no longer produced by `GET /teams/{id}/matches` alone —
 * B-SOLO gave `GET /matches/me` the very same field.
 *
 * Import them from there — there is deliberately no re-export shim here, which would hide
 * the move from the next reader.
 */
