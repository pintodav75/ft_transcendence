import { useQuery } from '@tanstack/react-query';

import { apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';

// Read side of the "Add friend" tab.

type RequestsResponse =
  paths['/friends/requests']['get']['responses'][200]['content']['application/json'];

/** One pending friend request, whichever way it points. */
export type FriendRequest = RequestsResponse['requests'][number];

/** The person on the other end of a request — the only part a row actually renders. */
export type RequestCounterpart = components['schemas']['FriendSummary'];

export type RequestDirection = 'received' | 'sent';

/** A NAMESPACE OF ITS OWN, deliberately NOT under `FRIENDS_KEY` (`['friends']`). */
export const FRIEND_REQUESTS_KEY = ['friend-requests'] as const;

/** Keyed BY DIRECTION: received and sent are two lists, two caches, two invalidations. */
export function friendRequestsKey(direction: RequestDirection) {
  return ['friend-requests', direction] as const;
}

/** My pending friend requests, in one direction. */
export function useFriendRequests(direction: RequestDirection) {
  return useQuery({
    queryKey: friendRequestsKey(direction),
    queryFn: () =>
      apiFetch<RequestsResponse>(`/friends/requests?direction=${direction}`),
    retry: retryServerErrorsOnly,
  });
}

/** The person a request concerns, whichever direction it points in. */
export function counterpartOf(request: FriendRequest): RequestCounterpart | undefined {
  return request.from ?? request.to;
}

/**
 * `GET /friends/requests`. The route has no 403/404 of its own — it answers with whatever is
 * pending for me — so only the shared failures apply.
 */
export function friendRequestsErrorMessage(error: unknown, direction: RequestDirection) {
  return (
    sharedApiErrorMessage(error) ??
    (direction === 'received'
      ? 'Could not load the requests you received.'
      : 'Could not load the requests you sent.')
  );
}
