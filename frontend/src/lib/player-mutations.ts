import { ApiError, RATE_LIMITED_MESSAGE } from '@/lib/api';

// Write side of the player page, split from its read side (`lib/player-detail.ts`) for the
// reason spelled out in `lib/team-mutations.ts`: queries and mutations have opposite
// lifecycles, and mixing them hides what invalidates what.
//
// 🔑 THE HOOKS THEMSELVES LIVE IN `lib/friend-mutations.ts`, the social rail's layer, and this
// page calls them directly. It used to carry its own copies — same routes, same payloads — and
// they were not merely redundant: they invalidated NOTHING of the rail. Blocking someone from
// their profile left them in the friends tab and out of the blocked tab until the next reload.
// The rail's versions also split "cancel MY request" from "unfriend" (same route, different
// list to refetch) and resynchronise the presence socket on an auto-accept. One relationship,
// one cache policy — this file is now only the WORDS this page puts on a failure.
//
// ⚠️ THE COPY IS DELIBERATELY NOT THE RAIL'S. Its sentences name the person ("You are already
// friends with @bob") because it lists ten of them; here the whole page is about one person
// already, so naming them again reads as a machine talking. Same server literals, two audiences.
//
// `RATE_LIMITED_MESSAGE` comes from `lib/api.ts`: the 429 sentence describes the rate limiter,
// which is a property of the API layer, not of any domain. The 403/404 lines below are NOT
// shared copy — each action needs its own sentence, so `sharedApiErrorMessage()` is not used.

// ------------------------------------------------------------------ error copy

/**
 * The backend's 400 bodies, verbatim, mapped to sentences a player can read.
 *
 * Matching on the literal is what keeps "already friends" and "already requested" distinct:
 * they are the same status code but not the same news, and the difference is the only thing
 * the visitor actually wants to know. `ApiError.message` IS that literal — `apiFetch` builds
 * the message from the payload's `error` field.
 */
const FRIEND_REQUEST_MESSAGES: Record<string, string> = {
  'already friends': 'You are already friends with this player.',
  'already requested': 'You have already sent this player a friend request.',
  "can't friend yourself": 'This is your own profile.',
};

const BLOCK_MESSAGES: Record<string, string> = {
  'already blocked': 'You have already blocked this player.',
  'cannot block yourself': 'This is your own profile.',
};

/**
 * ⚠️ NEVER SAY "BLOCKED" ON A 404. The API answers 404 both for an unknown pseudo and for
 * a profile hidden by a block IN EITHER DIRECTION — that conflation is the privacy
 * mechanism. Wording it as "this player blocked you" would leak exactly the fact the other
 * account chose to hide.
 */
const PROFILE_GONE_MESSAGE = 'This profile is no longer available.';

export function sendFriendRequestErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED_MESSAGE;
    if (error.status === 400) {
      const known = FRIEND_REQUEST_MESSAGES[error.message];
      if (known) return known;
    }
    if (error.status === 404) return PROFILE_GONE_MESSAGE;
  }

  return 'Could not send the friend request.';
}

export function blockUserErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED_MESSAGE;
    if (error.status === 400) {
      const known = BLOCK_MESSAGES[error.message];
      if (known) return known;
    }
    if (error.status === 404) return PROFILE_GONE_MESSAGE;
  }

  return 'Could not block this player.';
}

export function removeFriendshipErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED_MESSAGE;
    // 403 `not authorized` / 404 `friendship not found`: the relationship changed under a
    // page left open — the other side unfriended first, or blocked, which deletes the row.
    if (error.status === 403 || error.status === 404) {
      return 'This friendship no longer exists. Reload the page.';
    }
    // 400 `no deletable friendship for this action` — the route refuses to delete a request
    // someone sent to YOU (that is POST /friends/{id}/reject). The UI never offers it, so
    // this only fires on a page whose data has gone stale.
    if (error.status === 400) return 'This request cannot be withdrawn from here.';
  }

  return 'Could not update this friendship.';
}

/**
 * Withdrawing a request I sent — `DELETE /friends/{id}`, the very route the unfriend uses.
 * Its own sentence all the same: from here a 404 means "that request is gone", never "you are
 * not friends any more", and telling someone to reload over a friendship they never had would
 * be a non-sequitur.
 */
export function cancelFriendRequestErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED_MESSAGE;
    // 404 the row is gone, 400 it is no longer mine to withdraw (accepted meanwhile), 403 it
    // never was. One sentence: they all mean the screen is out of date, and it is refetched
    // underneath either way.
    if (error.status === 400 || error.status === 403 || error.status === 404) {
      return 'This request no longer exists. Reload the page.';
    }
  }

  return 'Could not withdraw this friend request.';
}

export function rejectFriendRequestErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED_MESSAGE;
    if (error.status === 403 || error.status === 404) {
      return 'This request no longer exists. Reload the page.';
    }
    // 400 is sent as `already friends`, which is the route's way of saying "no longer
    // pending" — it also fires when the request was accepted meanwhile. The literal would
    // read as a non-sequitur under a Refuse button, so it is reworded.
    if (error.status === 400) return 'This request has already been answered.';
  }

  return 'Could not refuse this request.';
}
