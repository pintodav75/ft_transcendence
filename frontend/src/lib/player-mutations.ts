import { ApiError, RATE_LIMITED_MESSAGE } from '@/lib/api';

// Write side of the player page, split from its read side (`lib/player-detail.ts`) for the
// reason spelled out in `lib/team-mutations.ts`: queries and mutations have opposite
// lifecycles, and mixing them hides what invalidates what.

// ------------------------------------------------------------------ error copy

/** The backend's 400 bodies, verbatim, mapped to sentences a player can read. */
const FRIEND_REQUEST_MESSAGES: Record<string, string> = {
  'already friends': 'You are already friends with this player.',
  'already requested': 'You have already sent this player a friend request.',
  "can't friend yourself": 'This is your own profile.',
};

const BLOCK_MESSAGES: Record<string, string> = {
  'already blocked': 'You have already blocked this player.',
  'cannot block yourself': 'This is your own profile.',
};

/** NEVER SAY "BLOCKED" ON A 404. */
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
    // 403 `not authorized` / 404 `friendship not found`: the relationship changed under a page
    // left open — the other side unfriended first, or blocked, which deletes the row.
    if (error.status === 403 || error.status === 404) {
      return 'This friendship no longer exists. Reload the page.';
    }
    // 400 `no deletable friendship for this action` — the route refuses to delete a request
    // someone sent to YOU (that is POST /friends/{id}/reject).
    if (error.status === 400) return 'This request cannot be withdrawn from here.';
  }

  return 'Could not update this friendship.';
}

/** Withdrawing a request I sent — `DELETE /friends/{id}`, the very route the unfriend uses. */
export function cancelFriendRequestErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return RATE_LIMITED_MESSAGE;
    // 404 the row is gone, 400 it is no longer mine to withdraw (accepted meanwhile), 403 it
    // never was.
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
    // 400 is sent as `already friends`, which is the route's way of saying "no longer pending"
    // — it also fires when the request was accepted meanwhile.
    if (error.status === 400) return 'This request has already been answered.';
  }

  return 'Could not refuse this request.';
}
