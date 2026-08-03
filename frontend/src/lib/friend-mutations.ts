import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { BLOCKS_KEY } from '@/lib/blocks';
import { FRIEND_REQUESTS_KEY, friendRequestsKey } from '@/lib/friend-requests';
import { FRIENDS_KEY } from '@/lib/friends';
import { markPlayerProfileBlocked, PLAYER_PROFILES_KEY } from '@/lib/player-detail';
import { resynchronizeRealtime } from '@/lib/realtime-client';

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
type UnblockUserResponse =
  paths['/blocks/{userId}']['delete']['responses'][200]['content']['application/json'];
/**
 * 🔑 THE 201 AND THE 200 NOW SHARE ONE SHAPE, and that is the whole mechanism behind
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
 * 🚨 404 ON `POST /friends` COVERS TWO CASES THE SERVER REFUSES TO TELL APART: an account that
 * does not exist, and one that has blocked me (`routes/friends.ts` answers `user not found` for
 * both, on purpose). The sentence must therefore name NEITHER — saying "they blocked you" would
 * leak exactly what the API is hiding. Same rule, same wording style as `messages.ts`.
 */
const REQUEST_TARGET_GONE_MESSAGE = 'This player is not available.';
/** The request row is gone: cancelled by its sender, or already answered from another tab. */
const REQUEST_GONE_MESSAGE = 'This request is no longer pending.';

/**
 * 🚨 THE BACKEND DISCRIMINATES THESE 400s BY SENTENCE, NOT BY CODE. `routes/friends.ts` answers
 * `{ error: 'already friends' }` / `{ error: 'already requested' }` / `{ error: "can't friend
 * yourself" }`, and `apiFetch` copies that string into `ApiError.message` (`getErrorMessage`).
 * There is no `code` to key on the way `team-mutations.ts` does.
 *
 * ⚠️ SO NOTHING TYPE-CHECKS THIS. Rewording the server string turns these three cases back into
 * the generic fallback below — silently. It is written here, in one place, rather than spread
 * over the component, so that a backend rename has exactly one place to fix.
 *
 * ⚠️ And the three are unreachable in normal use anyway: the tab knows who is already a friend
 * and who already has a pending request from me, so it never fires the call (see
 * `AddFriendSlot`). They are mapped for the stale tab that disproves "unreachable".
 */
const ALREADY_FRIENDS_ERROR = 'already friends';
const ALREADY_REQUESTED_ERROR = 'already requested';
const SELF_REQUEST_ERROR = "can't friend yourself";

/**
 * The row the user acted on is not in the database any anymore, so the list on screen is
 * stale. The caller must REFETCH on top of showing the message: an error printed over a row
 * that should not be there is half a fix.
 */
function isStaleRowError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

/**
 * 🚨 THE SAME THING, FOR A REQUEST ROW — AND IT IS NOT ONLY THE 404. Answering a request that is
 * no longer `pending` (accepted or refused from another tab, or by the other side) answers **400**,
 * not 404: the row still exists, its status simply moved on. Both mean "the list on screen is
 * out of date", which is exactly what `acceptFriendRequestErrorMessage` and its two siblings
 * already say with ONE sentence for both statuses — so both must trigger the refetch too.
 *
 * Testing only the 404 left the row on screen after a 400, with a button that could only ever
 * fail again: one more red line in the console per click.
 */
function isStaleRequestError(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

function refreshFriends(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: FRIENDS_KEY });
}

function refreshRequests(queryClient: QueryClient, direction: 'received' | 'sent') {
  return queryClient.invalidateQueries({ queryKey: friendRequestsKey(direction) });
}

/**
 * A public profile embeds the relationship between its player and the viewer. The social rail
 * remains mounted next to that profile and uses these same mutations, so refreshing only the
 * rail's lists leaves the profile button one action behind (for example, "Add friend" after a
 * request was sent). The prefix covers whichever profile is currently active without making
 * mutation callers know its pseudo.
 */
function refreshPlayerProfiles(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: PLAYER_PROFILES_KEY });
}

/**
 * 🚨 A NEW FRIENDSHIP NEEDS A NEW PRESENCE SNAPSHOT, and this is the one place that knows it.
 *
 * The server sends `initial_presence` — the list of my connected friends — ONCE, when the
 * WebSocket opens, and never republishes it. Somebody who becomes my friend after that is not
 * in the snapshot I am holding, so the friends tab would draw them offline until the next full
 * page load, whatever they are actually doing. `resynchronize()` reopens the socket, which is
 * what makes the server recompute and resend the snapshot.
 *
 * It lives in the mutations rather than at the call sites so it cannot be forgotten by one of
 * the TWO doors into a new friendship — accepting a request, and the auto-accept that answers
 * a request I sent to somebody who had already sent me one.
 *
 * ⚠️ Not awaited and deliberately fire-and-forget: it drops and reopens a socket, the store
 * reports the reconnection on its own, and nothing on screen waits for it.
 *
 * 🚨 YES, IT REALLY DOES CLOSE AND REOPEN THE SOCKET, AND THAT IS AN ACCEPTED DEBT — DO NOT
 * "FIX" IT. Every one of my friends sees my presence blink off and back on, and the components
 * that re-ask the server on reconnection (the conversation list, an open conversation) reload
 * once. It is kept anyway because there is NO route to re-ask for the presence snapshot without
 * reopening the connection — the server sends `initial_presence` exactly once per socket — and
 * the alternative is worse: a brand-new friend shown OFFLINE in the friends tab, whatever they
 * are really doing, until the next full page load. Decision taken with the reviewer on [FS-5];
 * removing this call trades a blink nobody complains about for a lie on screen.
 *
 * ⚠️ ITS ONE REAL VICTIM WAS A CHAT SEND IN FLIGHT — the conversation took the reconnection for
 * a dropped connection, declared the message lost and put the text back in the composer, while
 * the server had stored it; re-sending created a duplicate. That one IS handled:
 * `realtimeClient.resynchronize()` now waits for the send to be acknowledged first (see it).
 */
function refreshPresence() {
  resynchronizeRealtime();
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

/**
 * `POST /friends`. Takes the pseudo because every one of these sentences is about a PERSON, and
 * "already friends" with nobody named is useless in a rail that lists ten results.
 */
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
  // another tab). Both mean the same thing to the person looking at a stale list, and the list
  // is refetched underneath, so they get one sentence.
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
 * is why it gets its own sentence rather than reusing `removeFriendErrorMessage`: from this list
 * a 404 means "that request is gone", never "you are not friends any more".
 *
 * ⚠️ The route's other 400 ("pending request RECEIVED — use reject") is unreachable here: this
 * list only ever holds requests where I am the requester.
 */
export function cancelFriendRequestErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && (error.status === 404 || error.status === 400))
    return REQUEST_GONE_MESSAGE;

  return 'Could not cancel this friend request.';
}

/**
 * `DELETE /blocks/{userId}`. The route is IDEMPOTENT — unblocking somebody who is not blocked
 * answers 200 — so there is no "not blocked" case to map, and its only 400 is a malformed uuid,
 * which the list cannot produce.
 */
export function unblockUserErrorMessage(error: unknown) {
  return sharedApiErrorMessage(error) ?? 'Could not unblock this player.';
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

/**
 * Blocks a user. Takes the FRIEND'S id (`Friend.id`), not the friendship's.
 *
 * ⚠️ The server DELETES the friendship in the same call, in both directions — blocking is not
 * "block and keep them as a friend". That is why this invalidates the friends list exactly
 * like the removal above: the row must disappear because the server dropped it, never because
 * the client decided to hide it.
 *
 * ⚠️ IT INVALIDATES THE BLOCK LIST TOO, and that is [FS-5] honouring the to-do [FS-1] left
 * here. Both lists live in the same rail, one tab apart: blocking from "Friends" adds a row to
 * "Add friend" > blocked players, and without this the new row only appears on the next reload.
 */
export function useBlockUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<BlockUserResponse>(`/blocks/${encodeURIComponent(userId)}`, { method: 'POST' }),
    onSuccess: async (_, userId) => {
      // A blocked profile cannot be refetched: the endpoint deliberately answers 404. Cancel
      // any older request first, then mark the matching cached profile so a block triggered
      // from the rail updates an already-open page too.
      await queryClient.cancelQueries({ queryKey: PLAYER_PROFILES_KEY });
      markPlayerProfileBlocked(queryClient, userId);

      await Promise.all([
        refreshFriends(queryClient),
        queryClient.invalidateQueries({ queryKey: BLOCKS_KEY }),
        /**
         * 🔑 AND THE TWO REQUEST LISTS. The server deletes the friendship row in BOTH
         * directions when blocking, whatever its status — so a request pending between us,
         * either way round, is gone with it. Leaving it on screen would offer an "Accept"
         * button that can only ever answer 404.
         */
        queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY }),
      ]);
    },
    onError: (error) => (isStaleRowError(error) ? refreshFriends(queryClient) : undefined),
  });
}

/**
 * WHAT THE SERVER ACTUALLY DID with `POST /friends`, which is not always what was asked.
 *
 * 🚨 SENDING A REQUEST AND BECOMING FRIENDS ARE THE SAME CALL. If the other side had already
 * sent me one, the server treats mine as an acceptance and answers 200 + `accepted` instead of
 * 201 + `pending` — the friendship exists there and then. Telling the user "request sent" would
 * be plainly false: nobody is going to accept anything, and their new friend is already in the
 * other tab.
 *
 * ⚠️ IT IS READ FROM `friendship.status`, NOT FROM THE HTTP STATUS, and that is not a
 * preference: `apiFetch` resolves to the parsed BODY and throws away the `Response`. Rather
 * than widen the whole API client for one route, the contract carries the answer — which is
 * why `Friendship.status` is `required` in `openapi.yaml` (see the note there).
 */
export type SendRequestOutcome = 'sent' | 'auto-accepted';

/**
 * Sends a friend request — or accepts one, see `SendRequestOutcome`.
 *
 * ⚠️ TAKES THE OTHER PERSON'S ACCOUNT ID (`addresseeId`), never a friendship id: nothing exists
 * yet to have one.
 *
 * 🔑 THE INVALIDATION DEPENDS ON THE OUTCOME, which is exactly why this hook resolves to it
 * instead of to the raw payload:
 *   - `sent` — only MY sent list grew. Nothing else moved.
 *   - `auto-accepted` — a friend appeared AND the request I had received is gone, so both those
 *     lists are stale, and the presence snapshot with them.
 * Invalidating everything in both cases would refetch three lists to show one new row.
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
 * Accepts a request I received. 🚨 TAKES THE FRIENDSHIP ID (`FriendRequest.id`), not the
 * sender's — the same trap as `useRemoveFriend`, and just as invisible to the compiler.
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
 *
 * No friends list to invalidate: nothing was ever accepted, so nothing changed there.
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

/**
 * Cancels a request I sent.
 *
 * ⚠️ SAME ROUTE AS UNFRIENDING (`DELETE /friends/{id}`) — the server decides which of the two it
 * is from the row's status. So this hook is `useRemoveFriend`'s twin in everything but the cache
 * it invalidates, and merging them would have one action refetching the other's list.
 */
export function useCancelFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (friendshipId: string) =>
      apiFetch<RemoveFriendResponse>(`/friends/${encodeURIComponent(friendshipId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      Promise.all([refreshRequests(queryClient, 'sent'), refreshPlayerProfiles(queryClient)]),
    // 400 as well as 404 — see `isStaleRequestError`. On this route the 400 is "pending request
    // RECEIVED, use reject", which this list cannot produce; it costs nothing to refetch on it
    // and it keeps the three request actions behaving identically.
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
 *
 * ⚠️ IT DOES NOT RESTORE THE FRIENDSHIP. The profiles still have to be invalidated, though:
 * `GET /users/{pseudo}` becomes readable again after the unblock. In particular, a profile
 * left open on its local "Player blocked" screen needs that successful refetch to recover.
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
