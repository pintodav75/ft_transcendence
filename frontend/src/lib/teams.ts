import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';

import type { components, paths } from '@/lib/api-types.gen';

export type TeamListItem = components['schemas']['TeamListItem'];
export type MyTeamInvitation = components['schemas']['MyTeamInvitation'];

type MyInvitationsResponse =
  paths['/teams/invitations/me']['get']['responses'][200]['content']['application/json'];

/**
 * Exported so `team-mutations.ts` invalidates the very key this hook reads. Two literals
 * in two modules is exactly how a cache stops refreshing after a rename nobody noticed.
 */
export const MY_INVITATIONS_KEY = ['team-invitations', 'me'] as const;

// The caller's own teams: name, ladder, game, logo and captaincy — everything
// the "choose a team" grid needs, in one call. Roster faces and stats live on
// the team detail page (GET /teams/{id}), not here.
export function useMyTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: () => apiFetch<{ teams: TeamListItem[] }>('/teams'),
  });
}

/**
 * The invitations I have RECEIVED and not answered yet, most recent first — the other side
 * of the same feature from `GET /teams/{id}`, which lists the ones a team has SENT.
 *
 * Always an array (empty when there is nothing), so no error state to disambiguate: the
 * caller renders nothing at all when the list is empty.
 */
export function useMyTeamInvitations() {
  return useQuery({
    queryKey: MY_INVITATIONS_KEY,
    queryFn: () => apiFetch<MyInvitationsResponse>('/teams/invitations/me'),
  });
}
