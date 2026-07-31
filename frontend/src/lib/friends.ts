import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';

import type { components, paths } from '@/lib/api-types.gen';

/**
 * One accepted friendship, seen from MY side.
 *
 * 🚨 `id` and `friendshipId` ARE NOT INTERCHANGEABLE, and the type cannot stop you from
 * swapping them (both are `string`):
 *   - `id` is the FRIEND — block them, open their profile, message them later;
 *   - `friendshipId` is the RELATION — the only id `DELETE /friends/{id}` accepts.
 * Passing the user id to the deletion answers 404 ("friendship not found"), which reads as
 * a bug in the list rather than as the mix-up it is.
 */
export type Friend = components['schemas']['FriendListItem'];

type FriendsResponse = paths['/friends']['get']['responses'][200]['content']['application/json'];

/**
 * Exported so `friend-mutations.ts` invalidates the very key this hook reads — the repo's
 * rule after two literals in two modules stopped a cache from refreshing (see
 * `MY_INVITATIONS_KEY` in `lib/teams.ts`).
 *
 * FS-2/FS-3/FS-5 will need it too: accepting a friend request, blocking from the block list
 * and unblocking all change this list without going through the friends tab.
 */
export const FRIENDS_KEY = ['friends'] as const;

/**
 * My accepted friends. Always an array — no pagination, no filter, no "empty" special case
 * to disambiguate from an error.
 *
 * ⚠️ PRESENCE IS NOT HERE. `GET /friends` says nothing about who is connected: that lives in
 * the realtime store (`onlineFriendIds`), fed by the single WebSocket opened by [FS-0]. The
 * two are joined at render time by `splitByPresence` below — never by re-fetching this list
 * when somebody connects.
 */
export function useFriends() {
  return useQuery({
    queryKey: FRIENDS_KEY,
    queryFn: () => apiFetch<FriendsResponse>('/friends'),
  });
}

/**
 * Alphabetical by pseudo, and DETERMINISTIC: `localeCompare` is pinned to `'en'` rather than
 * left to the runtime's locale, so the same list never renders in two different orders on two
 * machines. `sensitivity: 'base'` puts `Bob` next to `bob` instead of sorting every capital
 * ahead of every lowercase; the raw compare that follows breaks the tie it creates, so the
 * result never depends on the order the server happened to return (which is itself two
 * concatenated queries — "friendships I requested", then "friendships I received").
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

/**
 * Splits the list in two along the presence snapshot, each half sorted by pseudo.
 *
 * ⚠️ ONLY CALL THIS WHEN `hasPresenceSnapshot` IS TRUE. While the socket is reconnecting the
 * store keeps the ids it last knew but marks them stale, and everyone would silently land in
 * "Offline" — a statement the server never made. The caller renders one flat list instead.
 */
export function splitByPresence(friends: Friend[], onlineFriendIds: string[]) {
  const online = new Set(onlineFriendIds);

  return {
    online: sortedByPseudo(friends.filter((friend) => online.has(friend.id))),
    offline: sortedByPseudo(friends.filter((friend) => !online.has(friend.id))),
  };
}
