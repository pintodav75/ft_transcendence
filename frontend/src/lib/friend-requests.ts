import { useQuery } from '@tanstack/react-query';

import { apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';

// Read side of the "Add friend" tab ([FS-5]). Its write side lives in `friend-mutations.ts`,
// for the reason that module already states: queries and mutations have opposite lifecycles,
// and mixing them makes it impossible to see at a glance what invalidates what.

type RequestsResponse =
  paths['/friends/requests']['get']['responses'][200]['content']['application/json'];

/**
 * One pending friend request, whichever way it points.
 *
 * 🚨 `id` IS THE FRIENDSHIP ROW, NOT A PERSON — the same trap `Friend` documents. It is the
 * only id `/friends/{id}/accept`, `/friends/{id}/reject` and `DELETE /friends/{id}` accept;
 * sending the sender's id there answers 404 forever, and both are `string`.
 *
 * ⚠️ `from` and `to` EXCLUDE EACH OTHER, and the codegen types both as optional because they
 * really are: `direction=received` fills `from` (the sender), `direction=sent` fills `to` (the
 * addressee). Never read the one the direction did not ask for — use `counterpartOf` below.
 */
export type FriendRequest = RequestsResponse['requests'][number];

/** The person on the other end of a request — the only part a row actually renders. */
export type RequestCounterpart = components['schemas']['FriendSummary'];

export type RequestDirection = 'received' | 'sent';

/**
 * 🚨 A NAMESPACE OF ITS OWN, deliberately NOT under `FRIENDS_KEY` (`['friends']`).
 *
 * TanStack matches keys by PREFIX: nested under `['friends']`, every `invalidateQueries` of the
 * friends list — removing a friend, blocking someone from [FS-1] — would also refetch these two
 * lists, which nothing about those actions changed. The ticket asks for precise invalidation,
 * so the two domains stay side by side instead of one inside the other.
 *
 * Exported for the same reason `FRIENDS_KEY` is: the mutations invalidate the very key these
 * hooks read, rather than re-spelling the literal in a second module (the repo's rule since two
 * spellings of `MY_INVITATIONS_KEY` stopped a cache from refreshing).
 */
export const FRIEND_REQUESTS_KEY = ['friend-requests'] as const;

/** Keyed BY DIRECTION: received and sent are two lists, two caches, two invalidations. */
export function friendRequestsKey(direction: RequestDirection) {
  return ['friend-requests', direction] as const;
}

/**
 * My pending friend requests, in one direction.
 *
 * 🚨 ONLY CALL IT FROM A COMPONENT MOUNTED WHILE THE "ADD FRIEND" TAB IS VISIBLE. The social
 * rail is mounted on every authenticated page, so a hook called unconditionally would fire this
 * GET on every single screen of the app. `SocialPanel` renders the slot only while its tab is
 * on screen — the same discipline as [FS-3] and [FS-4], and there is deliberately no `enabled`
 * flag to get wrong.
 *
 * ⚠️ `retryServerErrorsOnly`: a 403/404/429 is a verdict, not a hiccup, and retrying it writes
 * four red lines in the console where one was already too many (zero console entries is a
 * project-rejection criterion).
 */
export function useFriendRequests(direction: RequestDirection) {
  return useQuery({
    queryKey: friendRequestsKey(direction),
    queryFn: () =>
      apiFetch<RequestsResponse>(`/friends/requests?direction=${direction}`),
    retry: retryServerErrorsOnly,
  });
}

/**
 * The person a request concerns, whichever direction it points in.
 *
 * Returns `undefined` rather than throwing when neither key is set: the row simply does not
 * render. A request without its counterpart is a server contract the front cannot repair, and
 * crashing the whole rail over it would be worse than one missing line.
 */
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
