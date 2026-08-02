import { z } from 'zod';

/**
 * What `DELETE /users/me` demands depends on the ACCOUNT, not on the form: `password` when the
 * account has one, `totpCode` when 2FA is on, and an OAuth-only account without 2FA confirms
 * with neither. Hence a factory rather than a constant schema.
 *
 * 🔑 The test for the password is `hasPassword`, NEVER `oauthProvider`: signing in with Google
 * from an account that already existed by email links the provider without dropping the hash,
 * and such an account must still be asked for it. Same rule as `PasswordChange`.
 *
 * Both fields exist in the form whatever the account, so the values type stays stable and the
 * caller sends only the ones it asked for.
 */
export type DeleteAccountNeeds = {
  hasPassword: boolean;
  totpEnabled: boolean;
};

export function makeDeleteAccountSchema({ hasPassword, totpEnabled }: DeleteAccountNeeds) {
  return z
    .object({
      password: z.string(),
      totpCode: z.string(),
    })
    .superRefine((values, ctx) => {
      if (hasPassword && values.password.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'Enter your password.' });
      }
      // Same 6-digit rule as the backend's `deleteSchema`. Trimmed: a code pasted from an
      // authenticator app often carries a trailing space, and the server would answer 400 —
      // a red line in the Chrome console, which is a project-rejection criterion.
      if (totpEnabled && !/^\d{6}$/.test(values.totpCode.trim())) {
        ctx.addIssue({
          code: 'custom',
          path: ['totpCode'],
          message: 'Enter the 6-digit code from your app.',
        });
      }
    });
}

export type DeleteAccountFormValues = z.infer<ReturnType<typeof makeDeleteAccountSchema>>;
