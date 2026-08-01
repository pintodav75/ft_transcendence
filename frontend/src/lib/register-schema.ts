import { z } from 'zod';

import { passwordRule } from '@/lib/password-rule';

export const registerSchema = z.object({
  pseudo: z
    .string()
    .trim()
    .min(3, 'Use at least 3 characters.')
    .max(30, 'Use no more than 30 characters.'),
  email: z.email('Enter a valid email address.'),
  password: passwordRule,
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
