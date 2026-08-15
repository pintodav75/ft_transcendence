import { z } from 'zod';

/**
 * What DELETE /users/me demands depends on the account, not the form: password if it has one,
 * totpCode if 2FA is on, neither for an OAuth-only account without 2FA. Hence a factory and
 * not a constant schema.
 *
 * test hasPassword, NEVER oauthProvider: signing in with Google on an account that already
 * existed by email links the provider without dropping the hash, so that account has both.
 * both fields always exist in the form, the caller sends only the ones it asked for.
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
      // Same 6-digit rule as the backend's `deleteSchema`.
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
