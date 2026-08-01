import { z } from 'zod';

import { passwordRule } from '@/lib/password-rule';

// `newPassword` follows the very same rule as sign-up — the backend refuses to weaken a
// password — so it reuses `passwordRule` instead of restating it. The two used to be copied
// word for word, messages included, which is how a rule ends up tightened on one side only.
//
// `currentPassword` is merely required client-side: only the server can say whether it is
// right, by comparing it to the stored hash.
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
