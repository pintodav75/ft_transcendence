import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';

import type { components } from '@/lib/api-types.gen';

export type TeamListItem = components['schemas']['TeamListItem'];

// The caller's own teams: name, ladder, game, logo and captaincy — everything
// the "choose a team" grid needs, in one call. Roster faces and stats live on
// the team detail page (GET /teams/{id}), not here.
export function useMyTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: () => apiFetch<{ teams: TeamListItem[] }>('/teams'),
  });
}
