import { z } from 'zod';

/**
 * Client echo of the backend password policy: >= 8 chars, one upper, one lower, one digit,
 * one special, max 72 bytes (bcrypt's ceiling, past it the extra chars are ignored).
 *
 * its own module rather than an export of register-schema.ts: sign-up and the profile settings
 * both use it, so it belongs to neither.
 * server is the authority — this just fails fast instead of after a round trip.
 */
export const passwordRule = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use no more than 72 characters.')
  .regex(/[A-Z]/, 'Add at least one uppercase letter.')
  .regex(/[a-z]/, 'Add at least one lowercase letter.')
  .regex(/\d/, 'Add at least one number.')
  .regex(/[^A-Za-z0-9]/, 'Add at least one special character.');
