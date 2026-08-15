import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';

/**
 * One accepted friendship, seen from my side.
 *
 * `id` and `friendshipId` are both strings, so the type can't stop you swapping them:
 *   - `id` is the FRIEND — block them, open their profile, message them.
 *   - `friendshipId` is the RELATION — the only id DELETE /friends/{id} accepts.
 * passing the user id to the deletion answers 404, which looks like a bug in the list.
 */
export type Friend = components['schemas']['FriendListItem'];

type FriendsResponse = paths['/friends']['get']['responses'][200]['content']['application/json'];

/**
 * Exported so `friend-mutations.ts` invalidates the very key this hook reads — the repo's rule
 * after two literals in two modules stopped a cache from refreshing (see `MY_INVITATIONS_KEY`
 * in `lib/teams.ts`).
 */
export const FRIENDS_KEY = ['friends'] as const;

/**
 * My accepted friends. Always an array — no pagination, no filter, no "empty" special case to
 * disambiguate from an error.
 */
export function useFriends() {
  return useQuery({
    queryKey: FRIENDS_KEY,
    queryFn: () => apiFetch<FriendsResponse>('/friends'),
    retry: retryServerErrorsOnly,
  });
}

/**
 * Alphabetical by pseudo, and DETERMINISTIC: `localeCompare` is pinned to `'en'` rather than
 * left to the runtime's locale, so the same list never renders in two different orders on two
 * machines.
 */
function byPseudo(a: Friend, b: Friend) {
  return (
    a.pseudo.localeCompare(b.pseudo, 'en', { sensitivity: 'base' }) ||
    a.pseudo.localeCompare(b.pseudo, 'en')
  );
}

export function sortedByPseudo(friends: Friend[]) {
  return [...friends].sort(byPseudo);
}

/** Splits the list in two along the presence snapshot, each half sorted by pseudo. */
export function splitByPresence(friends: Friend[], onlineFriendIds: string[]) {
  const online = new Set(onlineFriendIds);

  return {
    online: sortedByPseudo(friends.filter((friend) => online.has(friend.id))),
    offline: sortedByPseudo(friends.filter((friend) => !online.has(friend.id))),
  };
}
