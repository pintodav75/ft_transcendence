import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch } from '@/lib/api';
import { NAME_MAX_LENGTH } from '@/lib/create-team-schema';
import { uploadFile } from '@/lib/upload';

import type { QueryClient } from '@tanstack/react-query';
import type { paths } from '@/lib/api-types.gen';

// Write side of the team page. Its read side (`lib/team-detail.ts`) stays untouched:
// queries and mutations have opposite lifecycles (cached vs. one-shot) and mixing them
// in one module makes it impossible to see, at a glance, what invalidates what.

type UpdateTeamBody = paths['/teams/{id}']['patch']['requestBody']['content']['application/json'];
type UpdateTeamResponse =
  paths['/teams/{id}']['patch']['responses'][200]['content']['application/json'];
type UploadLogoResponse =
  paths['/teams/{id}/logo']['post']['responses'][200]['content']['application/json'];
type AddMemberResponse =
  paths['/teams/{id}/members']['post']['responses'][201]['content']['application/json'];
type RemoveMemberResponse =
  paths['/teams/{id}/members/{userId}']['delete']['responses'][200]['content']['application/json'];
type DissolveTeamResponse =
  paths['/teams/{id}']['delete']['responses'][200]['content']['application/json'];

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

export const RATE_LIMITED_MESSAGE = 'Too many requests — retry in a moment.';
export const NAME_TAKEN_MESSAGE = 'This name is already taken on this ladder.';
const NOT_ALLOWED_MESSAGE = 'You are not allowed to do this.';
const TEAM_GONE_MESSAGE = 'This team no longer exists.';

/**
 * Reads the `{ error }` of `components['schemas']['Error']` off an `ApiError.payload`,
 * which is an `unknown`. Narrowing rather than casting: a payload that does not have the
 * expected shape must fall back to our own wording, not print `undefined`.
 */
function serverErrorMessage(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return undefined;
  if (!('error' in payload)) return undefined;

  const { error } = payload as Record<'error', unknown>;
  return typeof error === 'string' ? error : undefined;
}

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

export function addTeamMemberErrorMessage(error: unknown) {
  const shared = sharedMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // One 409 covers three distinct refusals — roster full (10), already a member, already
    // in a team on this ladder — and the backend sends NO stable `code` to tell them apart.
    // Its wording is already plain English, so it is shown VERBATIM: matching on substrings
    // of a message that can be reworded without notice would silently rot into the fallback.
    if (error.status === 409) {
      return serverErrorMessage(error.payload) ?? 'This player cannot join this team.';
    }
    if (error.status === 404) return 'This player or this team no longer exists.';
    if (error.status === 400) return 'Pick a player from the search results.';
  }

  return 'Could not add this player.';
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

/** Captain only. `userId` comes from GET /search?type=user. */
export function useAddTeamMember(teamId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<AddMemberResponse>(`/teams/${teamId}/members`, {
        method: 'POST',
        body: { userId },
      }),
    onSuccess: () => refreshTeam(queryClient, teamId, { matches: true }),
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
