import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { FRIENDS_KEY } from '@/lib/friends';

import type { QueryClient } from '@tanstack/react-query';
import type { paths } from '@/lib/api-types.gen';

// Write side of the friends tab. Its read side (`lib/friends.ts`) stays separate for the
// reason `team-mutations.ts` states: queries and mutations have opposite lifecycles, and
// mixing them makes it impossible to see at a glance what invalidates what.

type RemoveFriendResponse =
  paths['/friends/{id}']['delete']['responses'][200]['content']['application/json'];
// 201, not 200: blocking CREATES a block row. Reading the wrong status here would type the
// payload as `never` and the build would say so — which is the point of going through the
// codegen instead of hand-writing `{ ok: boolean }`.
type BlockUserResponse =
  paths['/blocks/{userId}']['post']['responses'][201]['content']['application/json'];

// ---------------------------------------------------------------- error mapping

const FRIENDSHIP_GONE_MESSAGE =
  'You are not friends any more — the other side removed you, or you already did.';
const ACCOUNT_GONE_MESSAGE = 'This account no longer exists.';

/**
 * The row the user acted on is not in the database any anymore, so the list on screen is
 * stale. The caller must REFETCH on top of showing the message: an error printed over a row
 * that should not be there is half a fix.
 */
function isStaleRowError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

function refreshFriends(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: FRIENDS_KEY });
}

/** `DELETE /friends/{friendshipId}`. */
export function removeFriendErrorMessage(error: unknown) {
  // 403 ("not my friendship") and 429 say the same thing whatever the route.
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && error.status === 404) return FRIENDSHIP_GONE_MESSAGE;

  // Deliberately NOT mapping the 400: on this route it means "pending request received",
  // and this list only ever holds ACCEPTED friendships, so it is unreachable from here.
  // Inventing a sentence for it would put words in the server's mouth.
  return 'Could not remove this friend.';
}

/** `POST /blocks/{userId}`. */
export function blockUserErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && error.status === 404) return ACCOUNT_GONE_MESSAGE;

  // The route's 400 has two causes, both unreachable from a friend row: blocking MYSELF (I am
  // not in my own friends list) and "already blocked" (blocking deletes the friendship, so a
  // blocked account cannot still be a friend). Neither gets a sentence it would never show.
  return 'Could not block this player.';
}

// ----------------------------------------------------------------------- hooks

/**
 * Removes one friend. Both sides may do it, and the other side is NOT notified.
 *
 * 🚨 TAKES THE `friendshipId`, NOT THE FRIEND'S `id`. They are both `string`, so nothing but
 * this line stands between a working button and a permanent 404 — see the note on `Friend`.
 *
 * `apiFetch` sends no body and therefore no `content-type` on a DELETE (`prepareBody` in
 * `lib/api.ts`), which is what keeps Fastify from answering 400 `FST_ERR_CTP_EMPTY_JSON_BODY`.
 */
export function useRemoveFriend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (friendshipId: string) =>
      apiFetch<RemoveFriendResponse>(`/friends/${encodeURIComponent(friendshipId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => refreshFriends(queryClient),
    // The friendship was already broken from the other tab / the other account: showing the
    // failure over a row that should have vanished is worse than the row vanishing.
    onError: (error) => (isStaleRowError(error) ? refreshFriends(queryClient) : undefined),
  });
}

/**
 * Blocks a user. Takes the FRIEND'S id (`Friend.id`), not the friendship's.
 *
 * ⚠️ The server DELETES the friendship in the same call, in both directions — blocking is not
 * "block and keep them as a friend". That is why this invalidates the friends list exactly
 * like the removal above: the row must disappear because the server dropped it, never because
 * the client decided to hide it.
 *
 * No block LIST is invalidated here: [FS-5] owns that screen and does not exist yet. It will
 * add its own key to this hook rather than re-deciding the invalidation at its call site.
 */
export function useBlockUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<BlockUserResponse>(`/blocks/${encodeURIComponent(userId)}`, { method: 'POST' }),
    onSuccess: () => refreshFriends(queryClient),
    onError: (error) => (isStaleRowError(error) ? refreshFriends(queryClient) : undefined),
  });
}
