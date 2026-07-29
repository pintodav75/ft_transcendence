import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, RATE_LIMITED_MESSAGE, apiFetch } from '@/lib/api';
import { MY_INVITATIONS_KEY } from '@/lib/teams';
import { NAME_MAX_LENGTH } from '@/lib/create-team-schema';
import { MAX_OPEN_SLOTS, ROSTER_LIMIT } from '@/lib/team-detail';
import { uploadFile } from '@/lib/upload';

import type { QueryClient } from '@tanstack/react-query';
import type { components, paths } from '@/lib/api-types.gen';

// Write side of the team page. Its read side (`lib/team-detail.ts`) stays untouched:
// queries and mutations have opposite lifecycles (cached vs. one-shot) and mixing them
// in one module makes it impossible to see, at a glance, what invalidates what.

type UpdateTeamBody = paths['/teams/{id}']['patch']['requestBody']['content']['application/json'];
type UpdateTeamResponse =
  paths['/teams/{id}']['patch']['responses'][200]['content']['application/json'];
type UploadLogoResponse =
  paths['/teams/{id}/logo']['post']['responses'][200]['content']['application/json'];
type RemoveMemberResponse =
  paths['/teams/{id}/members/{userId}']['delete']['responses'][200]['content']['application/json'];
type DissolveTeamResponse =
  paths['/teams/{id}']['delete']['responses'][200]['content']['application/json'];
type InviteResponse =
  paths['/teams/{id}/invitations']['post']['responses'][201]['content']['application/json'];
type CancelInvitationResponse =
  paths['/teams/{id}/invitations/{invitationId}']['delete']['responses'][200]['content']['application/json'];
type AcceptInvitationResponse =
  paths['/teams/invitations/{invitationId}/accept']['post']['responses'][200]['content']['application/json'];
type DeclineInvitationResponse =
  paths['/teams/invitations/{invitationId}/decline']['post']['responses'][200]['content']['application/json'];
type InvitationErrorCode = components['schemas']['TeamInvitationError']['code'];
type CreateMatchBody = paths['/matches']['post']['requestBody']['content']['application/json'];
type CreateMatchResponse = paths['/matches']['post']['responses'][201]['content']['application/json'];
type CancelMatchResponse =
  paths['/matches/{id}']['delete']['responses'][200]['content']['application/json'];

// ------------------------------------------------------------------ invalidation

type RefreshOptions = {
  /** Also refetch the match history — its line-ups name the roster. */
  matches?: boolean;
};

/**
 * Refetches everything a team mutation can have made stale.
 *
 * ⚠️ TanStack Query matches keys by PREFIX: `['team', id]` alone would already sweep
 * `['team', id, 'matches']`. `exact: true` keeps the two decisions separate and honest —
 * renaming a team or swapping its logo changes nothing in its match history, only a
 * roster change does.
 *
 * The returned promise is handed back to `onSuccess` on purpose: the mutation then stays
 * `isPending` until the screen actually shows fresh data, instead of flashing the old
 * roster for one frame between "done" and "refetched".
 */
function refreshTeam(queryClient: QueryClient, teamId: string, { matches = false }: RefreshOptions = {}) {
  const refreshes = [
    queryClient.invalidateQueries({ queryKey: ['team', teamId], exact: true }),
    // The /teams grid renders each team's name and logo, so a rename or a new logo
    // makes it stale too.
    queryClient.invalidateQueries({ queryKey: ['teams'] }),
  ];

  if (matches) {
    refreshes.push(queryClient.invalidateQueries({ queryKey: ['team', teamId, 'matches'] }));
  }

  return Promise.all(refreshes);
}

// ---------------------------------------------------------------- error mapping

export const NAME_TAKEN_MESSAGE = 'This name is already taken on this ladder.';
const NOT_ALLOWED_MESSAGE = 'You are not allowed to do this.';
const TEAM_GONE_MESSAGE = 'This team no longer exists.';

/** The statuses that say the same thing whatever the action. `undefined` = action-specific. */
function sharedMessage(error: unknown) {
  if (!(error instanceof ApiError)) return undefined;
  // 100 req/min per account (20/min on the logo upload). Reachable by a jumpy user, so it
  // needs a message that says "wait", not "it failed".
  if (error.status === 429) return RATE_LIMITED_MESSAGE;
  // Should never surface: the UI only offers these actions to the captain. Mapped anyway,
  // because a stale page (demoted, or the team changed hands) is exactly when it fires.
  if (error.status === 403) return NOT_ALLOWED_MESSAGE;
  return undefined;
}

export type TeamUpdateError = {
  /** `'name'` when the message belongs under the name field, `null` for a form-level one. */
  field: 'name' | null;
  message: string;
};

export function updateTeamErrorMessage(error: unknown): TeamUpdateError {
  const shared = sharedMessage(error);
  if (shared) return { field: null, message: shared };

  if (error instanceof ApiError) {
    // ⚠️ Unlike the 409 of POST /teams (which carries a `TeamCreateConflict.code`), this
    // one is a bare `{ error }`. No matter: `unique(ladder_id, name)` is its ONLY cause
    // here, so the status alone identifies it — no substring matching on the message.
    if (error.status === 409) return { field: 'name', message: NAME_TAKEN_MESSAGE };
    if (error.status === 404) return { field: null, message: TEAM_GONE_MESSAGE };
    // Empty body, name out of range, non-https logoUrl. All three are caught client-side
    // before the request; this is the safety net, not the normal path.
    if (error.status === 400) {
      return {
        field: null,
        message: `Use a name of 1 to ${NAME_MAX_LENGTH} characters and an https logo URL.`,
      };
    }
  }

  return { field: null, message: 'Could not save the changes.' };
}

export function uploadTeamLogoErrorMessage(error: unknown) {
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Both are pre-empted by ImagePicker (2 MB cap + MIME filter); kept so a file that
    // slips through gets an explanation instead of a generic failure.
    if (error.status === 413) return 'This image is larger than 2 MB.';
    if (error.status === 400) return 'Use a JPEG, PNG or WebP image.';
    if (error.status === 404) return TEAM_GONE_MESSAGE;
    // Status 0 is upload.ts's own network/abort error, already phrased for a human.
    if (error.status === 0) return error.message;
  }

  return 'Could not upload the logo.';
}

// ------------------------------------------------------- invitations (B-INV / FT-INV)

const INVITATION_GONE_MESSAGE =
  'This invitation is no longer pending — it was answered or cancelled in the meantime.';

/**
 * Reads the STABLE `code` of `components['schemas']['TeamInvitationError']`.
 *
 * The five invitation routes all answer `{ error, code }`: `error` is display prose the
 * backend may reword at any time, `code` is the contract — so this is what we test, and
 * the prose is never rendered. Narrowing rather than casting: a payload of another shape
 * returns `undefined` and the caller falls back on OUR wording instead of `undefined`.
 */
function invitationErrorCode(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  if (!('code' in payload)) return undefined;

  const { code } = payload as Record<'code', unknown>;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The invitation the user is acting on is not `pending` any more (answered, cancelled, or
 * gone with its team). The screen is stale, so the caller must REFETCH on top of showing
 * the message — an error banner over a row that should no longer be there is worse than
 * the row disappearing.
 */
function isStaleInvitationError(error: unknown) {
  if (!(error instanceof ApiError)) return false;

  const code = invitationErrorCode(error.payload);
  return code === 'invitation_not_found' || code === 'not_pending';
}

/**
 * Turns a `code -> message` table into a lookup keyed by a plain string.
 *
 * The tables below are typed `Partial<Record<InvitationErrorCode, string>>`, so a code the
 * backend renames (or that never existed) is a COMPILE error on the key instead of a
 * message that silently rots into the fallback. The lookup itself stays untyped on
 * purpose: `invitationErrorCode` returns `string | undefined`, and an unrecognised value
 * must simply miss and fall back on our own wording.
 */
function messageTable(messages: Partial<Record<InvitationErrorCode, string>>) {
  return new Map(Object.entries(messages));
}

const inviteMessages = messageTable({
  // Says WHY the count differs from the number of faces on screen. Without the "pending
  // invitations count" half, a captain reading "5 players" and "roster full" concludes
  // the app is broken.
  roster_full: `This roster is full — its ${ROSTER_LIMIT} slots count members AND pending invitations. Cancel an invitation or remove a player first.`,
  already_invited: 'This player already has a pending invitation from this team.',
  already_member: 'This player is already on the roster.',
  already_in_team_on_ladder: 'This player already has a team on this ladder.',
  already_in_team: 'This player already has a team on this ladder.',
  // ⚠️ NEUTRAL on purpose: the backend answers `user_not_found` both for an account that
  // does not exist and for one that has BLOCKED the captain (indistinguishable by design,
  // exactly like POST /friends). "This account was deleted" would be a lie half the time
  // — and would confirm the block the other half.
  user_not_found: 'This player cannot be invited right now.',
  team_not_found: TEAM_GONE_MESSAGE,
});

const cancelInvitationMessages = messageTable({
  // One code covers "already answered", "already cancelled" and "belongs to another
  // team": from here they are the same fact — there is nothing left to cancel.
  invitation_not_found: INVITATION_GONE_MESSAGE,
  team_not_found: TEAM_GONE_MESSAGE,
});

const respondMessages = messageTable({
  invitation_not_found: INVITATION_GONE_MESSAGE,
  not_pending: INVITATION_GONE_MESSAGE,
  team_not_found: TEAM_GONE_MESSAGE,
  roster_full: 'This roster filled up before you answered.',
  already_in_team: 'You already have a team on this ladder.',
});

/** Captain side: `POST /teams/{id}/invitations`. */
export function inviteTeamMemberErrorMessage(error: unknown) {
  // 403 (`not_captain`) and 429 are handled here, before any code lookup.
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    const code = invitationErrorCode(error.payload);
    const message = code === undefined ? undefined : inviteMessages.get(code);
    if (message) return message;

    // Empty/non-uuid `userId`: unreachable through the search panel, kept as a net.
    if (error.status === 400) return 'Pick a player from the search results.';
  }

  return 'Could not invite this player.';
}

/** Captain side: `DELETE /teams/{id}/invitations/{invitationId}`. */
export function cancelTeamInvitationErrorMessage(error: unknown) {
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    const code = invitationErrorCode(error.payload);
    const message = code === undefined ? undefined : cancelInvitationMessages.get(code);
    if (message) return message;
  }

  return 'Could not cancel this invitation.';
}

/**
 * Invited player side, shared by accept and decline: their refusals overlap, and the two
 * codes they do not share (`roster_full`, `already_in_team`, only reachable on accept)
 * simply never fire on decline.
 */
export function respondToInvitationErrorMessage(error: unknown) {
  // `not_your_invitation` is a 403, so it lands here as NOT_ALLOWED_MESSAGE.
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    const code = invitationErrorCode(error.payload);
    const message = code === undefined ? undefined : respondMessages.get(code);
    if (message) return message;
  }

  return 'Could not answer this invitation.';
}

export function removeTeamMemberErrorMessage(error: unknown) {
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // The route's only 400: the captain trying to remove themselves. Unreachable through
    // the UI (a captain gets "Dissolve", never "Leave"), mapped for the stale-page case.
    if (error.status === 400) return 'The captain cannot leave — dissolve the team instead.';
    if (error.status === 404) return TEAM_GONE_MESSAGE;
  }

  return 'Could not remove this player.';
}

export function dissolveTeamErrorMessage(error: unknown) {
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && error.status === 404) return TEAM_GONE_MESSAGE;

  return 'Could not dissolve the team.';
}

// ----------------------------------------------------------------------- hooks

/** Rename and/or set a logo URL. At least one field: an empty body is a 400. */
export function useUpdateTeam(teamId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateTeamBody) =>
      apiFetch<UpdateTeamResponse>(`/teams/${teamId}`, { method: 'PATCH', body }),
    onSuccess: () => refreshTeam(queryClient, teamId),
  });
}

/**
 * Uploads a logo file to MinIO. Goes through `uploadFile` (XHR) and not `apiFetch`
 * (fetch) for one reason: `fetch` has no upload-progress event, so the progress bar of
 * ImagePicker would have nothing to display.
 */
export function useUploadTeamLogo(teamId: string, onProgress?: (percent: number) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) =>
      uploadFile<UploadLogoResponse>(`/teams/${teamId}/logo`, file, { field: 'logo', onProgress }),
    onSuccess: () => refreshTeam(queryClient, teamId),
  });
}

/**
 * Captain only: invites a player. `userId` comes from GET /search?type=user.
 *
 * ⚠️ There is no "add a member" route any more — `POST /teams/{id}/members` was REMOVED by
 * B-INV. The player does NOT join here; they get a pending invitation and a notification,
 * and the roster only changes if they accept.
 *
 * No `{ matches: true }`: an invited player is in no line-up of any match, so the history
 * is not stale. `refreshTeam` keeps `exact: true` on `['team', id]` for exactly that
 * reason — TanStack matches by PREFIX and would otherwise sweep `['team', id, 'matches']`.
 */
export function useInviteTeamMember(teamId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<InviteResponse>(`/teams/${teamId}/invitations`, {
        method: 'POST',
        body: { userId },
      }),
    onSuccess: () => refreshTeam(queryClient, teamId),
  });
}

/**
 * Captain only: withdraws an invitation that is still pending, which gives the roster slot
 * back. NOT the same thing as `useRemoveTeamMember` — that one kicks a player who actually
 * joined; here nobody ever did, and nobody is notified.
 *
 * `apiFetch` sends no body and therefore no `content-type` on a DELETE (see `prepareBody`
 * in `lib/api.ts`), which is what keeps Fastify from answering 400
 * `FST_ERR_CTP_EMPTY_JSON_BODY`.
 */
export function useCancelTeamInvitation(teamId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch<CancelInvitationResponse>(
        `/teams/${teamId}/invitations/${encodeURIComponent(invitationId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => refreshTeam(queryClient, teamId),
    // The invitation was answered while the tab sat open: showing the failure over a chip
    // that should already be gone is half a fix — the list has to catch up too.
    onError: (error) =>
      isStaleInvitationError(error) ? refreshTeam(queryClient, teamId) : undefined,
  });
}

/**
 * Invited player only: accepts, and becomes a member.
 *
 * ⚠️ The invalidation is deliberately BY PREFIX here, unlike every captain-side mutation
 * above. Joining flips `isMember` on `GET /teams/{id}/matches`, which makes the whole
 * history change FOR ME (opponent-less slots and `lineup` appear), so `['team', teamId]`
 * without `exact` — sweeping `['team', teamId, 'matches']` too — is the correct behaviour,
 * not an oversight.
 *
 * `['team-invitations','me']` is refetched last for the rule the server applies silently:
 * accepting cancels my other pending invitations ON THAT LADDER, so rows I never touched
 * must disappear. That is the server's answer, never a client-side simulation.
 */
export function useAcceptTeamInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch<AcceptInvitationResponse>(
        `/teams/invitations/${encodeURIComponent(invitationId)}/accept`,
        { method: 'POST' },
      ),
    onSuccess: ({ teamId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team', teamId] }),
        queryClient.invalidateQueries({ queryKey: ['teams'] }),
        queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_KEY }),
      ]),
    onError: (error) =>
      isStaleInvitationError(error)
        ? queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_KEY })
        : undefined,
  });
}

/**
 * Invited player only: declines, which frees the team's slot and notifies its captain.
 * Nothing else about me changes — no membership, no team of mine — so a single key.
 */
export function useDeclineTeamInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch<DeclineInvitationResponse>(
        `/teams/invitations/${encodeURIComponent(invitationId)}/decline`,
        { method: 'POST' },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_KEY }),
    onError: (error) =>
      isStaleInvitationError(error)
        ? queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_KEY })
        : undefined,
  });
}

/**
 * Removes one member. Serves BOTH the captain's kick and a member's own departure
 * (`userId === me`) — it is the same route, and it is idempotent server-side.
 *
 * A voluntary departure needs no special cache handling: the team still exists and
 * `GET /teams/{id}` has no membership guard, so the refetch below answers 200 and the
 * page can navigate to /teams whenever it likes. Only DISSOLUTION is dangerous — see
 * `useDissolveTeam`.
 */
export function useRemoveTeamMember(teamId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<RemoveMemberResponse>(
        `/teams/${teamId}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => refreshTeam(queryClient, teamId, { matches: true }),
  });
}

/**
 * Dissolves the team. Captain only, cascades on the members.
 *
 * ⚠️ THE ORDER OF THE CLEANUP IS LOAD-BEARING, which is why the hook owns it instead of
 * leaving it to the page. The team is gone from the database, so:
 *
 * - `invalidateQueries(['team', id])` would refetch a URL that now answers 404. Chrome
 *   prints "Failed to load resource" for every non-2xx fetch → console audit red → and a
 *   dirty console is a project-rejection criterion, not a detail.
 * - `removeQueries` alone is not enough either: destroying a query that still has a
 *   MOUNTED observer makes that observer rebuild and refetch it — the same 404.
 *
 * Hence: leave the page FIRST (awaited, so the team page is really unmounted), then drop
 * the dead entry, then refresh the /teams grid, which is a URL that still exists.
 * `leaveTeamPage` is passed in rather than called by the page afterwards precisely so the
 * correct order cannot be got wrong at the call site.
 */
export function useDissolveTeam(teamId: string, leaveTeamPage: () => void | Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch<DissolveTeamResponse>(`/teams/${teamId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await leaveTeamPage();
      queryClient.removeQueries({ queryKey: ['team', teamId] });
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

// ------------------------------------------------------------- matchs (FT-2C)
//
// Opening and cancelling a slot live here rather than in a module of their own for one
// reason: `sharedMessage()` (429 / 403) is private to this file and must not be copied.
// ⚠️ The `/matches/$matchId` ticket will add result submission and dispute evidence — at
// that second consumer, these four exports should move to `lib/match-mutations.ts`.

/**
 * ONE key, and only one. Neither creating nor cancelling a slot changes `GET /teams/{id}`
 * (identity, roster, invitations) or the rankings (no result is entered), so `refreshTeam()`
 * is deliberately NOT called here: it would also sweep `['team', id]` and `['teams']`, i.e.
 * two requests the screen has no use for.
 */
function refreshTeamMatches(queryClient: QueryClient, teamId: string) {
  return queryClient.invalidateQueries({ queryKey: ['team', teamId, 'matches'] });
}

/**
 * Zod's 400 has an `errors` ARRAY and no `error` field; the business 400s have `error` and
 * no `errors`. Narrowing by shape, never casting the payload into a contract it may not
 * honour.
 */
function hasZodIssues(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return false;
  if (!('errors' in payload)) return false;

  const { errors } = payload as Record<'errors', unknown>;
  return Array.isArray(errors);
}

/**
 * `POST /matches` answers `{ error, unlinkedPlayers }` when a selected player has no linked
 * game account. The array holds **uuids**, never pseudos — the caller maps them onto its
 * roster, because showing a raw uuid to a captain explains nothing.
 */
function unlinkedPlayerIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  if (!('unlinkedPlayers' in payload)) return [];

  const { unlinkedPlayers } = payload as Record<'unlinkedPlayers', unknown>;
  if (!Array.isArray(unlinkedPlayers)) return [];

  return unlinkedPlayers.filter((value): value is string => typeof value === 'string');
}

/**
 * The slot the captain picked slipped under the 15-minute bound between the moment the list
 * was drawn and the moment the request landed. The panel must not only show the message: it
 * has to REDRAW the list, or the next click repeats the same failure.
 */
export function isExpiredSlotError(error: unknown) {
  return error instanceof ApiError && error.status === 400 && hasZodIssues(error.payload);
}

export type CreateMatchErrorContext = {
  /**
   * Locally counted still-valid open slots (`openSlotCount`). This is what tells the two
   * 409s of `POST /matches` apart — see below.
   *
   * `undefined` when the team's history could not be loaded: the count is then UNKNOWN, not
   * zero. Passing 0 in that case would state "you are already engaged at that time" with
   * full confidence while the server actually refused for the cap — a message that sends
   * the captain looking for a conflict that does not exist.
   */
  openSlots: number | undefined;
  /** The roster, used to turn `unlinkedPlayers` uuids into pseudos. */
  members: { id: string; pseudo: string }[];
};

export function createMatchErrorMessage(
  error: unknown,
  { openSlots, members }: CreateMatchErrorContext,
) {
  // 403 (`only the captain can engage the team`, on a page that changed hands) and 429.
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    if (error.status === 409) {
      // ⚠️ THE TWO 409s OF THIS ROUTE CARRY NO STABLE `code` — unlike the invitation
      // routes of B-INV. Invariant #8 forbids routing a message on the server's prose, so
      // they are told apart by the only reliable local signal: our own count of open slots.
      // Both are pre-empted by the UI; this is the net for a stale page.
      //
      // With no count at all (history unavailable) the two cannot be told apart, so the
      // message names BOTH possibilities instead of picking one at random. Saying nothing
      // false is worth more than sounding sure.
      if (openSlots === undefined) {
        return `This slot was refused: either this team is already engaged around that time, or it already holds ${MAX_OPEN_SLOTS} open slots on this ladder. Reload the page to see its matches.`;
      }

      return openSlots >= MAX_OPEN_SLOTS
        ? `This team already holds ${MAX_OPEN_SLOTS} open slots on this ladder — cancel one before opening another.`
        : 'This team is already engaged around that time. The list of times has just been refreshed.';
    }

    if (error.status === 404) return 'This ladder no longer exists.';

    if (error.status === 400) {
      const unlinked = unlinkedPlayerIds(error.payload);
      if (unlinked.length > 0) {
        const named = unlinked
          .map((id) => members.find((member) => member.id === id)?.pseudo)
          .filter((pseudo): pseudo is string => Boolean(pseudo))
          .map((pseudo) => `@${pseudo}`);

        return named.length > 0
          ? `${named.join(', ')} no longer has a linked game account — unselect them and pick someone else.`
          : 'One of the selected players no longer has a linked game account.';
      }

      // Zod: off-grid time, or a slot that fell under the 15-minute bound while the panel
      // was open. Only the second is reachable from this screen.
      if (hasZodIssues(error.payload)) {
        return 'That time slot has just passed — pick another one.';
      }

      return 'This line-up was refused: every player must still be on this team.';
    }
  }

  return 'Could not open the slot.';
}

export function cancelMatchErrorMessage(error: unknown) {
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Somebody accepted the slot between the render and the click.
    if (error.status === 409) return 'This slot has just been accepted — it cannot be cancelled.';
    if (error.status === 404) return 'This match no longer exists.';
  }

  return 'Could not cancel this slot.';
}

/**
 * Captain only: opens a slot on the team's ladder. `lineup` holds EXACTLY `parseInt(format)`
 * member ids, all with a linked game account.
 *
 * The invalidation promise is returned from `onSuccess` (repo idiom): the mutation then
 * stays `isPending` until the history really shows the new slot, instead of the panel
 * closing on the previous state for one frame.
 *
 * A 409 means the screen is LYING (another captain accepted one of our slots, a window
 * moved): the message alone would leave the same stale options on screen, so the history is
 * refetched too — which also re-greys the selector.
 */
export function useCreateMatch(teamId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateMatchBody) =>
      apiFetch<CreateMatchResponse>('/matches', { method: 'POST', body }),
    onSuccess: () => refreshTeamMatches(queryClient, teamId),
    onError: (error) =>
      error instanceof ApiError && error.status === 409
        ? refreshTeamMatches(queryClient, teamId)
        : undefined,
  });
}

/**
 * Captain only: withdraws a slot nobody has accepted yet. The match is NOT deleted — it
 * turns `cancelled` and stays in the history, which is why the row must not be removed
 * optimistically.
 *
 * `apiFetch` sends no body and therefore no `content-type` on a DELETE (`prepareBody` in
 * `lib/api.ts`), which is what keeps Fastify from answering 400 `FST_ERR_CTP_EMPTY_JSON_BODY`.
 */
export function useCancelMatch(teamId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (matchId: string) =>
      apiFetch<CancelMatchResponse>(`/matches/${encodeURIComponent(matchId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => refreshTeamMatches(queryClient, teamId),
    // 409 (accepted in the meantime) and 404 (gone) both mean the row on screen is stale.
    onError: (error) =>
      error instanceof ApiError && (error.status === 409 || error.status === 404)
        ? refreshTeamMatches(queryClient, teamId)
        : undefined,
  });
}
