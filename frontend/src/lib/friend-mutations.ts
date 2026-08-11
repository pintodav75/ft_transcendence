import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { BLOCKS_KEY } from '@/lib/blocks';
import { FRIEND_REQUESTS_KEY, friendRequestsKey } from '@/lib/friend-requests';
import { FRIENDS_KEY } from '@/lib/friends';
import { markPlayerProfileBlocked, PLAYER_PROFILES_KEY } from '@/lib/player-detail';
import { resynchronizeRealtime } from '@/lib/realtime-client';

import type { QueryClient } from '@tanstack/react-query';
import type { paths } from '@/lib/api-types.gen';

// Write side of the friends tab.

type RemoveFriendResponse =
  paths['/friends/{id}']['delete']['responses'][200]['content']['application/json'];
// 201, not 200: blocking CREATES a block row.
type BlockUserResponse =
  paths['/blocks/{userId}']['post']['responses'][201]['content']['application/json'];
type UnblockUserResponse =
  paths['/blocks/{userId}']['delete']['responses'][200]['content']['application/json'];
/**
 * THE 201 AND THE 200 NOW SHARE ONE SHAPE, and that is the whole mechanism behind
 * `SendRequestOutcome` below. See the note on `Friendship` in `openapi.yaml`.
 */
type SendFriendRequestResponse =
  paths['/friends']['post']['responses'][201]['content']['application/json'];
type AcceptRequestResponse =
  paths['/friends/{id}/accept']['post']['responses'][200]['content']['application/json'];
type RejectRequestResponse =
  paths['/friends/{id}/reject']['post']['responses'][200]['content']['application/json'];

// ---------------------------------------------------------------- error mapping

const FRIENDSHIP_GONE_MESSAGE =
  'You are not friends any more — the other side removed you, or you already did.';
const ACCOUNT_GONE_MESSAGE = 'This account no longer exists.';
/**
 * 404 ON `POST /friends` COVERS TWO CASES THE SERVER REFUSES TO TELL APART: an account that
 * does not exist, and one that has blocked me (`routes/friends.ts` answers `user not found` for
 * both, on purpose).
 */
const REQUEST_TARGET_GONE_MESSAGE = 'This player is not available.';
/** The request row is gone: cancelled by its sender, or already answered from another tab. */
const REQUEST_GONE_MESSAGE = 'This request is no longer pending.';

/** THE BACKEND DISCRIMINATES THESE 400s BY SENTENCE, NOT BY CODE. */
const ALREADY_FRIENDS_ERROR = 'already friends';
const ALREADY_REQUESTED_ERROR = 'already requested';
const SELF_REQUEST_ERROR = "can't friend yourself";

/** The row the user acted on is not in the database any anymore, so the list on screen is stale. */
function isStaleRowError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

/** THE SAME THING, FOR A REQUEST ROW — AND IT IS NOT ONLY THE 404. */
function isStaleRequestError(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

function refreshFriends(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: FRIENDS_KEY });
}

function refreshRequests(queryClient: QueryClient, direction: 'received' | 'sent') {
  return queryClient.invalidateQueries({ queryKey: friendRequestsKey(direction) });
}

/** A public profile embeds the relationship between its player and the viewer. */
function refreshPlayerProfiles(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: PLAYER_PROFILES_KEY });
}

/** A NEW FRIENDSHIP NEEDS A NEW PRESENCE SNAPSHOT, and this is the one place that knows it. */
function refreshPresence() {
  resynchronizeRealtime();
}

/** `DELETE /friends/{friendshipId}`. */
export function removeFriendErrorMessage(error: unknown) {
  // 403 ("not my friendship") and 429 say the same thing whatever the route.
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && error.status === 404) return FRIENDSHIP_GONE_MESSAGE;

  // Deliberately NOT mapping the 400: on this route it means "pending request received", and
  // this list only ever holds ACCEPTED friendships, so it is unreachable from here.
  return 'Could not remove this friend.';
}

/** `POST /blocks/{userId}`. */
export function blockUserErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && error.status === 404) return ACCOUNT_GONE_MESSAGE;

  // The route's 400 has two causes, both unreachable from a friend row: blocking MYSELF (I am
  // not in my own friends list) and "already blocked" (blocking deletes the friendship, so a
  // blocked account cannot still be a friend).
  return 'Could not block this player.';
}

/** `POST /friends`. */
export function sendFriendRequestErrorMessage(error: unknown, pseudo: string) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    if (error.status === 404) return REQUEST_TARGET_GONE_MESSAGE;
    if (error.status === 400) {
      if (error.message === ALREADY_FRIENDS_ERROR) return `You are already friends with @${pseudo}.`;
      if (error.message === ALREADY_REQUESTED_ERROR)
        return `You already sent @${pseudo} a friend request.`;
      if (error.message === SELF_REQUEST_ERROR)
        return 'You cannot send yourself a friend request.';
    }
  }

  return `Could not send a friend request to @${pseudo}.`;
}

/** `POST /friends/{id}/accept`. */
export function acceptFriendRequestErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  // 404 = the row is gone (cancelled). 400 = it is no longer `pending` (already accepted from
  // another tab).
  if (error instanceof ApiError && (error.status === 404 || error.status === 400))
    return REQUEST_GONE_MESSAGE;

  return 'Could not accept this friend request.';
}

/** `POST /friends/{id}/reject`. Same two stale cases as the acceptance. */
export function rejectFriendRequestErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && (error.status === 404 || error.status === 400))
    return REQUEST_GONE_MESSAGE;

  return 'Could not decline this friend request.';
}

/**
 * `DELETE /friends/{id}` used to CANCEL a request I sent — the same route as unfriending, which
 * is why it gets its own sentence rather than reusing `removeFriendErrorMessage`: from this
 * list a 404 means "that request is gone", never "you are not friends any more".
 */
export function cancelFriendRequestErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && (error.status === 404 || error.status === 400))
    return REQUEST_GONE_MESSAGE;

  return 'Could not cancel this friend request.';
}

/** `DELETE /blocks/{userId}`. */
export function unblockUserErrorMessage(error: unknown) {
  return sharedApiErrorMessage(error) ?? 'Could not unblock this player.';
}

// ----------------------------------------------------------------------- hooks

/** Removes one friend. Both sides may do it, and the other side is NOT notified. */
export function useRemoveFriend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (friendshipId: string) =>
      apiFetch<RemoveFriendResponse>(`/friends/${encodeURIComponent(friendshipId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      Promise.all([refreshFriends(queryClient), refreshPlayerProfiles(queryClient)]),
    // The friendship was already broken from the other tab / the other account: showing the
    // failure over a row that should have vanished is worse than the row vanishing.
    onError: (error) =>
      isStaleRowError(error)
        ? Promise.all([refreshFriends(queryClient), refreshPlayerProfiles(queryClient)])
        : undefined,
  });
}

/** Blocks a user. Takes the FRIEND'S id (`Friend.id`), not the friendship's. */
export function useBlockUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<BlockUserResponse>(`/blocks/${encodeURIComponent(userId)}`, { method: 'POST' }),
    onSuccess: async (_, userId) => {
      // A blocked profile cannot be refetched: the endpoint deliberately answers 404.
      await queryClient.cancelQueries({ queryKey: PLAYER_PROFILES_KEY });
      markPlayerProfileBlocked(queryClient, userId);

      await Promise.all([
        refreshFriends(queryClient),
        queryClient.invalidateQueries({ queryKey: BLOCKS_KEY }),
        /** AND THE TWO REQUEST LISTS. */
        queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY }),
      ]);
    },
    onError: (error) => (isStaleRowError(error) ? refreshFriends(queryClient) : undefined),
  });
}

/** WHAT THE SERVER ACTUALLY DID with `POST /friends`, which is not always what was asked. */
export type SendRequestOutcome = 'sent' | 'auto-accepted';

/**
 * Sends a friend request, or accepts one if they already sent me theirs (SendRequestOutcome).
 *
 * takes the other person's account id (addresseeId), never a friendship id — nothing exists yet.
 * the hook resolves to the outcome because the invalidation depends on it:
 *   - sent: only my sent list grew, nothing else moved.
 *   - auto-accepted: a friend appeared and the received request is gone, so both lists are
 *     stale plus the presence snapshot.
 * invalidating everything either way would refetch three lists to show one row.
 */
export function useSendFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (addresseeId: string): Promise<SendRequestOutcome> => {
      const { friendship } = await apiFetch<SendFriendRequestResponse>('/friends', {
        method: 'POST',
        body: { addresseeId },
      });

      return friendship.status === 'accepted' ? 'auto-accepted' : 'sent';
    },
    onSuccess: (outcome) => {
      if (outcome === 'sent')
        return Promise.all([
          refreshRequests(queryClient, 'sent'),
          refreshPlayerProfiles(queryClient),
        ]);

      refreshPresence();
      return Promise.all([
        refreshFriends(queryClient),
        refreshRequests(queryClient, 'received'),
        refreshPlayerProfiles(queryClient),
      ]);
    },
  });
}

/**
 * Accepts a request I received. TAKES THE FRIENDSHIP ID (`FriendRequest.id`), not the sender's
 * — the same trap as `useRemoveFriend`, and just as invisible to the compiler.
 */
export function useAcceptFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (friendshipId: string) =>
      apiFetch<AcceptRequestResponse>(
        `/friends/${encodeURIComponent(friendshipId)}/accept`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      // The other door into a new friendship — see `refreshPresence`.
      refreshPresence();
      return Promise.all([
        refreshFriends(queryClient),
        refreshRequests(queryClient, 'received'),
        refreshPlayerProfiles(queryClient),
      ]);
    },
    // The request was cancelled or answered elsewhere: the row must go, message or no message.
    onError: (error) =>
      isStaleRequestError(error)
        ? Promise.all([
            refreshRequests(queryClient, 'received'),
            refreshPlayerProfiles(queryClient),
          ])
        : undefined,
  });
}

/**
 * Declines a request I received. The row is DELETED server-side, so the sender can try again
 * later — and is not notified, exactly like an unfriend.
 */
export function useRejectFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (friendshipId: string) =>
      apiFetch<RejectRequestResponse>(
        `/friends/${encodeURIComponent(friendshipId)}/reject`,
        { method: 'POST' },
      ),
    onSuccess: () =>
      Promise.all([
        refreshRequests(queryClient, 'received'),
        refreshPlayerProfiles(queryClient),
      ]),
    onError: (error) =>
      isStaleRequestError(error)
        ? Promise.all([
            refreshRequests(queryClient, 'received'),
            refreshPlayerProfiles(queryClient),
          ])
        : undefined,
  });
}

/** Cancels a request I sent. */
export function useCancelFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (friendshipId: string) =>
      apiFetch<RemoveFriendResponse>(`/friends/${encodeURIComponent(friendshipId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      Promise.all([refreshRequests(queryClient, 'sent'), refreshPlayerProfiles(queryClient)]),
    // 400 as well as 404 — see `isStaleRequestError`.
    onError: (error) =>
      isStaleRequestError(error)
        ? Promise.all([
            refreshRequests(queryClient, 'sent'),
            refreshPlayerProfiles(queryClient),
          ])
        : undefined,
  });
}

/**
 * Unblocks a user. TAKES THE ACCOUNT ID (`BlockEntry.id`) — there is no relation id on this
 * route at all.
 */
export function useUnblockUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<UnblockUserResponse>(`/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: BLOCKS_KEY }),
        refreshPlayerProfiles(queryClient),
      ]),
  });
}
