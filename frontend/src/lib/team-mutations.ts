import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, errorPayloadCode, sharedApiErrorMessage } from '@/lib/api';
import { MY_INVITATIONS_KEY } from '@/lib/teams';
import { NAME_MAX_LENGTH } from '@/lib/create-team-schema';
import { ROSTER_LIMIT, teamMatchesKey } from '@/lib/team-detail';
import { uploadFile } from '@/lib/upload';

import type { QueryClient } from '@tanstack/react-query';
import type { components, paths } from '@/lib/api-types.gen';

// Write side of the team page. Its read side (`lib/team-detail.ts`) stays untouched: queries
// and mutations have opposite lifecycles (cached vs.

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
// The two 409 of the team routes are INLINE payloads in `openapi.yaml` (no named schema, unlike
// `TeamInvitationError`), so their `code` is read straight off `paths`.
type RemoveMemberConflictCode =
  paths['/teams/{id}/members/{userId}']['delete']['responses'][409]['content']['application/json']['code'];
type DissolveTeamConflictCode =
  paths['/teams/{id}']['delete']['responses'][409]['content']['application/json']['code'];

// ------------------------------------------------------------------ invalidation

type RefreshOptions = {
  /** Also refetch the match history — its line-ups name the roster. */
  matches?: boolean;
};

/** Refetches everything a team mutation can have made stale. */
function refreshTeam(queryClient: QueryClient, teamId: string, { matches = false }: RefreshOptions = {}) {
  const refreshes = [
    queryClient.invalidateQueries({ queryKey: ['team', teamId], exact: true }),
    // The /teams grid renders each team's name and logo, so a rename or a new logo makes it
    // stale too.
    queryClient.invalidateQueries({ queryKey: ['teams'] }),
  ];

  if (matches) {
    refreshes.push(queryClient.invalidateQueries({ queryKey: teamMatchesKey(teamId) }));
  }

  return Promise.all(refreshes);
}

// ---------------------------------------------------------------- error mapping

export const NAME_TAKEN_MESSAGE = 'This name is already taken on this ladder.';
const TEAM_GONE_MESSAGE = 'This team no longer exists.';

/** The statuses that say the same thing whatever the action (429 / 403). */
const sharedMessage = sharedApiErrorMessage;

export type TeamUpdateError = {
  /** `'name'` when the message belongs under the name field, `null` for a form-level one. */
  field: 'name' | null;
  message: string;
};

export function updateTeamErrorMessage(error: unknown): TeamUpdateError {
  const shared = sharedMessage(error);
  if (shared) return { field: null, message: shared };

  if (error instanceof ApiError) {
    // Unlike the 409 of POST /teams (which carries a `TeamCreateConflict.code`), this one is a
    // bare `{ error }`.
    if (error.status === 409) return { field: 'name', message: NAME_TAKEN_MESSAGE };
    if (error.status === 404) return { field: null, message: TEAM_GONE_MESSAGE };
    // Empty body, name out of range, non-https logoUrl. All three are caught client-side before
    // the request; this is the safety net, not the normal path.
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
    // Both are pre-empted by ImagePicker (2 MB cap + MIME filter); kept so a file that slips
    // through gets an explanation instead of a generic failure.
    if (error.status === 413) return 'This image is larger than 2 MB.';
    if (error.status === 400) return 'Use a JPEG, PNG or WebP image.';
    if (error.status === 404) return TEAM_GONE_MESSAGE;
    // Status 0 is upload.ts's own network/abort error, already phrased for a human.
    if (error.status === 0) return error.message;
  }

  return 'Could not upload the logo.';
}

// ------------------------------------------------------- invitations

const INVITATION_GONE_MESSAGE =
  'This invitation is no longer pending — it was answered or cancelled in the meantime.';

/**
 * The invitation the user is acting on is not `pending` any more (answered, cancelled, or gone
 * with its team).
 */
function isStaleInvitationError(error: unknown) {
  if (!(error instanceof ApiError)) return false;

  const code = errorPayloadCode(error.payload);
  return code === 'invitation_not_found' || code === 'not_pending';
}

/** Turns a `code -> message` table into a lookup keyed by a plain string. */
function messageTable(messages: Partial<Record<InvitationErrorCode, string>>) {
  return new Map(Object.entries(messages));
}

const inviteMessages = messageTable({
  // Says WHY the count differs from the number of faces on screen.
  roster_full: `This roster is full — its ${ROSTER_LIMIT} slots count members AND pending invitations. Cancel an invitation or remove a player first.`,
  already_invited: 'This player already has a pending invitation from this team.',
  already_member: 'This player is already on the roster.',
  already_in_team_on_ladder: 'This player already has a team on this ladder.',
  already_in_team: 'This player already has a team on this ladder.',
  // NEUTRAL on purpose: the backend answers `user_not_found` both for an account that does not
  // exist and for one that has BLOCKED the captain (indistinguishable by design, exactly like
  // POST /friends).
  user_not_found: 'This player cannot be invited right now.',
  team_not_found: TEAM_GONE_MESSAGE,
});

const cancelInvitationMessages = messageTable({
  // One code covers "already answered", "already cancelled" and "belongs to another team": from
  // here they are the same fact — there is nothing left to cancel.
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
    const code = errorPayloadCode(error.payload);
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
    const code = errorPayloadCode(error.payload);
    const message = code === undefined ? undefined : cancelInvitationMessages.get(code);
    if (message) return message;
  }

  return 'Could not cancel this invitation.';
}

/**
 * Invited player side, shared by accept and decline: their refusals overlap, and the two codes
 * they do not share (`roster_full`, `already_in_team`, only reachable on accept) simply never
 * fire on decline.
 */
export function respondToInvitationErrorMessage(error: unknown) {
  // `not_your_invitation` is a 403, so it lands here as NOT_ALLOWED_MESSAGE.
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    const code = errorPayloadCode(error.payload);
    const message = code === undefined ? undefined : respondMessages.get(code);
    if (message) return message;
  }

  return 'Could not answer this invitation.';
}

// --------------------------------------------- deletions blocked by a live match (409)

// Typed against the codegen, so renaming the code backend-side breaks the build here instead of
// silently degrading the screen to its generic fallback (invariant #8).
const MEMBER_ENGAGED_CODE: RemoveMemberConflictCode = 'engaged_in_match';
const TEAM_ENGAGED_CODE: DissolveTeamConflictCode = 'team_engaged_in_match';

/** Which of the two actions `DELETE /teams/{id}/members/{userId}` is serving. */
export type RemoveMemberIntent = 'kick' | 'leave';

// Each carries its REMEDY (finish or cancel the match).
const ENGAGED_MESSAGES: Record<RemoveMemberIntent, string> = {
  kick: 'You cannot remove this player while they are in an ongoing match — finish it or cancel it first.',
  leave: 'You cannot leave while you are in an ongoing match — finish it or cancel it first.',
};

export function removeTeamMemberErrorMessage(error: unknown, intent: RemoveMemberIntent) {
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Tested on the `code`, not on the bare 409: this route may well grow a second conflict
    // later, and that one would then wrongly inherit this wording.
    if (errorPayloadCode(error.payload) === MEMBER_ENGAGED_CODE) return ENGAGED_MESSAGES[intent];
    // The route's only 400: the captain trying to remove themselves. Unreachable through the UI
    // (a captain gets "Dissolve", never "Leave"), mapped for the stale-page case.
    if (error.status === 400) return 'The captain cannot leave — dissolve the team instead.';
    if (error.status === 404) return TEAM_GONE_MESSAGE;
  }

  return 'Could not remove this player.';
}

export function dissolveTeamErrorMessage(error: unknown) {
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // A side of this team is still engaged in a `pending` / `in_progress` /
    // `awaiting_confirmation` / `disputed` match: dissolving would leave that side without a
    // team (`match_sides.team_id` is `set null`).
    if (errorPayloadCode(error.payload) === TEAM_ENGAGED_CODE) {
      // "open OR ongoing", and the difference is not cosmetic: this route refuses on
      // ENGAGING_STATUSES (an unaccepted `pending` slot included), where member removal refuses
      // on LOCKING_STATUSES only (a `pending` slot is cancelled instead).
      return 'You cannot dissolve this team while it has an open or ongoing match — cancel it or finish it first.';
    }
    if (error.status === 404) return TEAM_GONE_MESSAGE;
  }

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

/** Uploads a logo file to MinIO. */
export function useUploadTeamLogo(teamId: string, onProgress?: (percent: number) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) =>
      uploadFile<UploadLogoResponse>(`/teams/${teamId}/logo`, file, { field: 'logo', onProgress }),
    onSuccess: () => refreshTeam(queryClient, teamId),
  });
}

/** Captain only: invites a player. `userId` comes from GET /search?type=user. */
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
 * back.
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
    // The invitation was answered while the tab sat open: showing the failure over a chip that
    // should already be gone is half a fix — the list has to catch up too.
    onError: (error) =>
      isStaleInvitationError(error) ? refreshTeam(queryClient, teamId) : undefined,
  });
}

/** Invited player only: accepts, and becomes a member. */
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
 * Invited player only: declines, which frees the team's slot and notifies its captain. Nothing
 * else about me changes — no membership, no team of mine — so a single key.
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
 * Removes one member. Serves BOTH the captain's kick and a member's own departure (`userId ===
 * me`) — it is the same route, and it is idempotent server-side.
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
 * the cleanup ORDER is load-bearing, which is why the hook owns it: leave the page first
 * (awaited, so it's really unmounted), then drop the dead cache entry, then refresh the /teams
 * grid. the team is gone, so invalidateQueries(['team', id]) would refetch a 404, and
 * removeQueries alone isn't enough either — a query with a mounted observer gets rebuilt and
 * refetched, same 404. leaveTeamPage is passed in so the order can't be got wrong at the call site.
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
