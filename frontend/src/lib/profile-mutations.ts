import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { uploadFile } from '@/lib/upload';

import type { components, paths } from '@/lib/api-types.gen';
import type { AuthUser } from '@/types/auth';

// Write side of /profile. Same split as `lib/team-mutations.ts`: the calls and their error
// wording live together, away from the components, so a component never decides what a
// status code MEANS — it only decides where to show the sentence.
//
// Two rules inherited from that module:
//   - map by STATUS CODE (or by the payload's documented shape), never by the server's prose:
//     `{ error }` is display text the backend may reword at any time.
//   - type the bodies and responses FROM the generated contract, so a backend change is a
//     compile error here instead of an `undefined` at runtime.

type ChangePasswordBody =
  paths['/users/me/password']['patch']['requestBody']['content']['application/json'];
type ChangePasswordResponse =
  paths['/users/me/password']['patch']['responses'][200]['content']['application/json'];

export const WRONG_PASSWORD_MESSAGE = 'Your current password is incorrect.';

/**
 * True when a 400 carries the Zod issue list rather than a plain `{ error }`.
 *
 * `PATCH /users/me/password` answers 400 for TWO unrelated reasons, and the contract already
 * separates them by SHAPE: `ValidationError` (`{ errors: [...] }`) when `newPassword` breaks
 * the strength rule, `Error` (`{ error }`) when the account has no local password at all.
 * Testing the shape is what lets us tell them apart without ever reading the prose.
 */
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
    // ⚠️ On THIS route a 401 means "wrong current password", not "expired session" — see the
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
 * Changes the password. `currentPassword` is checked against the stored hash server-side.
 *
 * 🔑 `skipAuthRefresh` is LOAD-BEARING, not a micro-optimisation. The backend answers **401**
 * when `currentPassword` is wrong (`users.ts`), and `lib/api.ts` treats every 401 as "the
 * access token expired": it silently refreshes and REPLAYS the request, then clears the
 * session if the refresh itself fails. Without this flag, one typo would:
 *
 *   - send the request TWICE, so the route's 5/min quota is spent in 3 attempts instead of 5
 *     and the user meets a raw "Too Many Requests";
 *   - LOG THE USER OUT outright whenever the refresh cookie is missing or stale.
 *
 * The known trade-off of turning it off: if the access token really has expired, the 401 is
 * reported as a wrong password. The user recovers by reloading the page (the route guard
 * restores a fresh token). That is strictly better than being signed out for a typo.
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

/**
 * Shared by enable and disable: their refusals are the same set.
 *
 * ⚠️ KNOWN IMPRECISION, and it is the contract's, not ours. These routes answer a bare
 * `{ error }` for THREE unrelated 400s — "invalid code", "2FA already enabled" and "2FA not
 * set up yet" — with no stable `code` to tell them apart (unlike `TeamInvitationError`).
 * "Invalid code" is the only one reachable through a fresh screen; the other two need a
 * stale tab, where the section already shows the wrong state anyway. So the wording targets
 * the reachable case. Adding a `code` to these responses would be the clean fix, backend side.
 */
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
 * Generates a TOTP secret and its QR code. Does NOT turn 2FA on — `enableTwoFactor` does,
 * once the user proves the secret reached their app by typing a code it produced.
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

/**
 * Bridges the CONTRACT's `User` to the store's `AuthUser`.
 *
 * The two describe the same object but disagree on optionality: `openapi.yaml` only
 * requires `[id, pseudo, email, totpEnabled, isAdmin, createdAt, updatedAt]`, so the
 * generated type makes `displayName`, `bio`, `avatarUrl`, `oauthProvider` and `oauthId`
 * optional, where `types/auth.ts` declares them `T | null`. An absent key and a null key
 * mean the same thing here — "not set" — so they are collapsed onto `null`.
 *
 * Worth doing rather than typing the response by hand as `{ user: AuthUser }`: the fields
 * below are read FROM the generated contract, so a backend rename becomes a compile error
 * in this function instead of an `undefined` surfacing somewhere in the UI.
 */
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
    // Both are pre-empted by ImagePicker (MIME filter + 2 MB cap); kept so a file that
    // slips through gets an explanation instead of a generic failure.
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

/**
 * Sends the new avatar. Goes through `uploadFile` (XHR) rather than `apiFetch` (fetch) for
 * one reason: `fetch` exposes NO upload-progress event, so ImagePicker's progress bar would
 * have nothing to render — and that bar is one of the three front bullets of the File
 * upload module.
 *
 * ⚠️ The multipart field is `file`, which is what `openapi.yaml` declares (`required: [file]`).
 * The handler actually takes the first file part whatever its name, so `avatar` worked too —
 * but a silent divergence from the contract is exactly what stops being harmless the day
 * someone reads the spec instead of the code.
 */
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
