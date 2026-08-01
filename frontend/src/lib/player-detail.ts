import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';

export type PublicUser = components['schemas']['PublicUser'];
export type Friendship = components['schemas']['Friendship'];
// Solo ranking  — Elo, record and rank
export type PlayerRanking = components['schemas']['PlayerRanking'];
// Team ranking
export type PlayerTeam = components['schemas']['PlayerTeam'];

type PublicUserResponse =
  paths['/users/{pseudo}']['get']['responses'][200]['content']['application/json'];

export const ViewerRole = {
  Guest: 0,
  Stranger: 1,
  Friend: 2,
  PageOwner: 3,
} as const;

export type ViewerRole = (typeof ViewerRole)[keyof typeof ViewerRole];

export function getViewerRole(
  profileUserId: string,
  connectedUserId?: string,
  friendship?: Friendship | null,
): ViewerRole {
  if (!connectedUserId) return ViewerRole.Guest;
  if (profileUserId === connectedUserId) return ViewerRole.PageOwner;
  if (friendship?.status === 'accepted') return ViewerRole.Friend;
  return ViewerRole.Stranger;
}

// cta = call to action
// add friend? accept friend? pending?
export type FriendCta = 'add' | 'accept' | 'pending' | 'none';

export function friendCta(
  friendship: Friendship | null | undefined,
  viewerId: string | undefined,
): FriendCta {
  if (!friendship) return 'add';
  if (friendship.status === 'accepted') return 'none';
  // Unknown viewer falls to `pending`. Unreachable in practice.
  if (!viewerId) return 'pending';

  return friendship.requesterId === viewerId ? 'pending' : 'accept';
}

// Built once at module scope, an Intl formatter is expensive to
// create and these options never change.
const joinDateFormat = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

//  * When the account was created, for the "Member since" line.
//  * `createdAt` arrives as an ISO **string**, not a `Date`

export function formatJoinDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return joinDateFormat.format(date);
}

//  * When the two accounts became friends
export function formatFriendsSince(friendship: Friendship | null | undefined) {
  if (friendship?.status !== 'accepted') return null;

  return formatJoinDate(friendship.updatedAt);
}

/**
 * Cache key of one public profile.
 *
 * Lowered: two spellings of one pseudo must not
 * become two cache entries holding the same user.
 */
export function playerQueryKey(pseudo: string) {
  return ['player', pseudo.toLowerCase()] as const;
}

/**
 * The profile behind a pseudo.
 *
 * NO client-side format gate, unlike `useTeam`: the backend's `:pseudo` param carries no
 * schema at all, so there is no such thing as a malformed pseudo to catch before spending
 * a request — anything unknown is simply a 404.
 *
 * ⚠️ That 404 also covers "one of us has blocked the other", deliberately, so the error
 * copy must never name blocking (see `lib/player-mutations.ts`).
 */
export function usePlayer(pseudo: string) {
  return useQuery({
    queryKey: playerQueryKey(pseudo),
    queryFn: () => apiFetch<PublicUserResponse>(`/users/${encodeURIComponent(pseudo)}`),
    retry: retryServerErrorsOnly,
  });
}
