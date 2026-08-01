import { z } from 'zod';

/**
 * The one client-side echo of the backend's password policy: ≥ 8 characters, one uppercase,
 * one lowercase, one digit, one special character, and no more than 72 bytes (bcrypt's own
 * ceiling — beyond it the extra characters are silently ignored).
 *
 * It lives in a module of its OWN rather than being exported from `register-schema.ts`,
 * because a rule shared by sign-up and by the profile settings belongs to neither of them:
 * having `password-schema.ts` import a "register" module would point the dependency the
 * wrong way — the same mistake `sharedApiErrorMessage` was moved out of `team-mutations.ts`
 * to avoid (see `lib/api.ts`).
 *
 * ⚠️ The server is the authority. This copy exists so a weak password fails instantly and
 * readably instead of after a round trip, NOT to replace the check.
 */
export const passwordRule = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use no more than 72 characters.')
  .regex(/[A-Z]/, 'Add at least one uppercase letter.')
  .regex(/[a-z]/, 'Add at least one lowercase letter.')
  .regex(/\d/, 'Add at least one number.')
  .regex(/[^A-Za-z0-9]/, 'Add at least one special character.');
