import { ApiError, apiFetch, errorPayloadCode, sharedApiErrorMessage } from '@/lib/api';
import { uploadFile } from '@/lib/upload';

import type { components, paths } from '@/lib/api-types.gen';
import type { AuthUser } from '@/types/auth';

// Write side of /profile.

type ChangePasswordBody =
  paths['/users/me/password']['patch']['requestBody']['content']['application/json'];
type ChangePasswordResponse =
  paths['/users/me/password']['patch']['responses'][200]['content']['application/json'];

export const WRONG_PASSWORD_MESSAGE = 'Your current password is incorrect.';

/** True when a 400 carries the Zod issue list rather than a plain `{ error }`. */
function isValidationError(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return false;
  if (!('errors' in payload)) return false;

  return Array.isArray((payload as Record<'errors', unknown>).errors);
}

export function changePasswordErrorMessage(error: unknown) {
  // 429 (5/min on this route) and 403.
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // On THIS route a 401 means "wrong current password", not "expired session" — see the
    // `skipAuthRefresh` note in `changePassword` below.
    if (error.status === 401) return WRONG_PASSWORD_MESSAGE;

    if (error.status === 400) {
      // Caught client-side by the Zod resolver first; this is the safety net.
      if (isValidationError(error.payload)) {
        return 'Use at least 8 characters, with an uppercase letter, a lowercase letter, a digit and a special character.';
      }
      // OAuth-only account. Unreachable through the UI — `PasswordChange` hides the whole
      // section for those accounts — so this only fires on a stale page.
      return 'This account signs in with Google and has no password to change.';
    }
  }

  return 'Could not update your password.';
}

/**
 * Changes the password. currentPassword is checked against the stored hash server-side.
 *
 * skipAuthRefresh is load-bearing. the backend answers 401 on a wrong currentPassword, and
 * lib/api.ts reads every 401 as "token expired" — it refreshes and REPLAYS the request. without
 * the flag one typo sends the request twice (burning the 5/min quota in 3 tries) and logs the
 * user out whenever the refresh cookie is stale.
 * trade-off: a genuinely expired token is reported as a wrong password. reloading fixes it,
 * which beats being signed out for a typo.
 */
export function changePassword(body: ChangePasswordBody) {
  return apiFetch<ChangePasswordResponse>('/users/me/password', {
    method: 'PATCH',
    body,
    skipAuthRefresh: true,
  });
}

// --------------------------------------------------------------------------- profile

type UpdateProfileBody = paths['/users/me']['patch']['requestBody']['content']['application/json'];
type UpdateProfileResponse =
  paths['/users/me']['patch']['responses'][200]['content']['application/json'];

export function updateProfileErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && error.status === 400) {
    // A field is out of range. Caught client-side by the Zod resolver first; net only.
    if (isValidationError(error.payload)) return 'Check the highlighted fields and try again.';
    // `no fields to update`: an empty body. Unreachable — the form always sends `bio`.
    return 'Nothing to update.';
  }

  return 'Could not save your profile.';
}

export async function updateProfile(body: UpdateProfileBody) {
  const { user } = await apiFetch<UpdateProfileResponse>('/users/me', { method: 'PATCH', body });

  return user ? toAuthUser(user) : null;
}

// ------------------------------------------------------------------------------- 2FA

type TwoFactorSetupResponse =
  paths['/auth/2fa/setup']['post']['responses'][200]['content']['application/json'];
type EnableTwoFactorBody =
  paths['/auth/2fa/enable']['post']['requestBody']['content']['application/json'];
type EnableTwoFactorResponse =
  paths['/auth/2fa/enable']['post']['responses'][200]['content']['application/json'];
type DisableTwoFactorBody =
  paths['/auth/2fa/disable']['post']['requestBody']['content']['application/json'];
type DisableTwoFactorResponse =
  paths['/auth/2fa/disable']['post']['responses'][200]['content']['application/json'];

/** Shared by enable and disable: their refusals are the same set. */
function twoFactorErrorMessage(error: unknown, fallback: string) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError && error.status === 400) {
    if (isValidationError(error.payload)) return 'Enter the 6-digit code from your app.';
    return 'That code is not valid. Codes expire every 30 seconds — try the next one.';
  }

  return fallback;
}

export function enableTwoFactorErrorMessage(error: unknown) {
  return twoFactorErrorMessage(error, 'Could not turn on two-factor authentication.');
}

export function disableTwoFactorErrorMessage(error: unknown) {
  return twoFactorErrorMessage(error, 'Could not turn off two-factor authentication.');
}

export function startTwoFactorSetupErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  // The route's only 400 is "2FA already enabled" — a stale tab, since the section shows
  // "Disable 2FA" as soon as it is on.
  if (error instanceof ApiError && error.status === 400) {
    return 'Two-factor authentication is already on for this account.';
  }

  return 'Could not start the two-factor setup.';
}

/**
 * Generates a TOTP secret and its QR code. Does NOT turn 2FA on — `enableTwoFactor` does, once
 * the user proves the secret reached their app by typing a code it produced.
 */
export function startTwoFactorSetup() {
  return apiFetch<TwoFactorSetupResponse>('/auth/2fa/setup', { method: 'POST' });
}

export function enableTwoFactor(body: EnableTwoFactorBody) {
  return apiFetch<EnableTwoFactorResponse>('/auth/2fa/enable', { method: 'POST', body });
}

export function disableTwoFactor(body: DisableTwoFactorBody) {
  return apiFetch<DisableTwoFactorResponse>('/auth/2fa/disable', { method: 'POST', body });
}

// ---------------------------------------------------------------------------- avatar

type UploadAvatarResponse =
  paths['/users/me/avatar']['post']['responses'][200]['content']['application/json'];
type RemoveAvatarResponse =
  paths['/users/me/avatar']['delete']['responses'][200]['content']['application/json'];

/** Bridges the CONTRACT's `User` to the store's `AuthUser`. */
function toAuthUser(user: components['schemas']['User']): AuthUser {
  return {
    ...user,
    displayName: user.displayName ?? null,
    bio: user.bio ?? null,
    avatarUrl: user.avatarUrl ?? null,
    oauthProvider: user.oauthProvider ?? null,
    oauthId: user.oauthId ?? null,
  };
}

export function uploadAvatarErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Both are pre-empted by ImagePicker (MIME filter + 2 MB cap); kept so a file that slips
    // through gets an explanation instead of a generic failure.
    if (error.status === 413) return 'This image is larger than 2 MB.';
    if (error.status === 400) return 'Use a JPEG, PNG or WebP image.';
    // Status 0 is upload.ts's own network/abort error, already phrased for a human.
    if (error.status === 0) return error.message;
  }

  return 'Could not upload your avatar.';
}

export function removeAvatarErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  return 'Could not remove your avatar.';
}

/** Sends the new avatar. */
export async function uploadAvatar(file: File, onProgress?: (percent: number) => void) {
  const { user } = await uploadFile<UploadAvatarResponse>('/users/me/avatar', file, {
    field: 'file',
    onProgress,
  });

  return user ? toAuthUser(user) : null;
}

/** Deletes the avatar and its MinIO object. Idempotent server-side: no avatar is still a 200. */
export async function removeAvatar() {
  const { user } = await apiFetch<RemoveAvatarResponse>('/users/me/avatar', { method: 'DELETE' });

  return user ? toAuthUser(user) : null;
}

// ------------------------------------------------------------------ account deletion

type DeleteAccountBody = paths['/users/me']['delete']['requestBody']['content']['application/json'];
type DeleteAccountResponse =
  paths['/users/me']['delete']['responses'][200]['content']['application/json'];
type DeleteAccountConflictCode = components['schemas']['AccountDeletionError']['code'];

/**
 * The two refusals of `DELETE /users/me`, each with ITS OWN remedy — which is the whole reason
 * the backend gives them distinct codes instead of one 409.
 */
const DELETE_CONFLICT_MESSAGES: Record<DeleteAccountConflictCode, string> = {
  engaged_in_match:
    'You are still fielded in an ongoing match — play it or cancel it before deleting your account.',
  captain_of_team:
    'You are the captain of a team — dissolve it first, otherwise deleting your account would delete the team and its ranking for the whole roster.',
};

function deleteConflictMessage(payload: unknown) {
  const code = errorPayloadCode(payload);
  if (code === undefined || !(code in DELETE_CONFLICT_MESSAGES)) return undefined;

  return DELETE_CONFLICT_MESSAGES[code as DeleteAccountConflictCode];
}

/** What the account forced the dialog to ask for — see the 401 below. */
export type DeleteAccountAsked = { password: boolean; totpCode: boolean };

export function deleteAccountErrorMessage(error: unknown, asked: DeleteAccountAsked) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Tested on the `code`, never on the bare 409: the two refusals send the user to two
    // different screens, and the route may well grow a third conflict later.
    if (error.status === 409) {
      return deleteConflictMessage(error.payload) ?? 'Your account cannot be deleted right now.';
    }

    // ONE STATUS, TWO CAUSES, AND THE RESPONSE CANNOT TELL THEM APART: the route checks the
    // password first, then the TOTP code, and answers 401 with the same bare `{ error }` for
    // both.
    if (error.status === 401) {
      if (asked.password && asked.totpCode) return 'That password or that code is incorrect.';
      if (asked.totpCode) return 'That code is not valid. Codes expire every 30 seconds.';
      return WRONG_PASSWORD_MESSAGE;
    }

    if (error.status === 400) {
      // Malformed `totpCode`. Caught client-side by the Zod resolver first; safety net.
      if (isValidationError(error.payload)) return 'Enter the 6-digit code from your app.';
      // `password required` / `totp code required`: the dialog asks for exactly what the
      // account carries, so this only fires on a page left open while 2FA was turned on.
      return 'Reload the page and confirm again.';
    }

    // The account is already gone — a second tab did it.
    if (error.status === 404) return 'This account no longer exists.';
  }

  return 'Could not delete your account.';
}

/** Deletes the account for good. The server clears the refresh cookie itself. */
export function deleteAccount(body: DeleteAccountBody) {
  return apiFetch<DeleteAccountResponse>('/users/me', {
    method: 'DELETE',
    body,
    skipAuthRefresh: true,
  });
}
