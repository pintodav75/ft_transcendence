import { z } from 'zod';

import { passwordRule } from '@/lib/password-rule';

// `newPassword` follows the very same rule as sign-up — the backend refuses to weaken a
// password — so it reuses `passwordRule` instead of restating it.
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordRule,
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export type PasswordChangeFormValues = z.infer<typeof passwordChangeSchema>;
