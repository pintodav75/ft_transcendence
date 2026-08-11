import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';
import type { QueryClient } from '@tanstack/react-query';

export type PublicUser = components['schemas']['PublicUser'];
export type Friendship = components['schemas']['Friendship'];
// Solo ranking — Elo, record and rank
export type PlayerRanking = components['schemas']['PlayerRanking'];
// Team ranking
export type PlayerTeam = components['schemas']['PlayerTeam'];

type PublicUserResponse =
  paths['/users/{pseudo}']['get']['responses'][200]['content']['application/json'];

/** Client-only state attached to an already cached profile. */
export type PlayerProfile = PublicUserResponse & { __clientBlocked?: true };

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

// cta = call to action add friend? accept friend? pending?
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

// Built once at module scope, an Intl formatter is expensive to create and these options never
// change.
const joinDateFormat = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// * When the account was created, for the "Member since" line.

export function formatJoinDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return joinDateFormat.format(date);
}

// * When the two accounts became friends
export function formatFriendsSince(friendship: Friendship | null | undefined) {
  if (friendship?.status !== 'accepted') return null;

  return formatJoinDate(friendship.updatedAt);
}

/** Prefix shared by every cached public profile. */
export const PLAYER_PROFILES_KEY = ['player'] as const;

/** Cache key of one public profile. */
export function playerQueryKey(pseudo: string) {
  return [...PLAYER_PROFILES_KEY, pseudo.toLowerCase()] as const;
}

/** Marks whichever cached profile belongs to `userId` as blocked, without issuing a GET. */
export function markPlayerProfileBlocked(queryClient: QueryClient, userId: string) {
  queryClient.setQueriesData<PlayerProfile>({ queryKey: PLAYER_PROFILES_KEY }, (profile) =>
    profile?.user.id === userId ? { ...profile, __clientBlocked: true } : profile,
  );
}

/** The profile behind a pseudo. */
export function usePlayer(pseudo: string) {
  return useQuery({
    queryKey: playerQueryKey(pseudo),
    queryFn: () => apiFetch<PlayerProfile>(`/users/${encodeURIComponent(pseudo)}`),
    retry: retryServerErrorsOnly,
  });
}
