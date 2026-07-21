import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().pipe(z.email('Enter a valid email address.')),
  password: z
    .string()
    .min(1, 'Enter your password.')
    .max(72, 'Use no more than 72 characters.'),
});

export const twoFactorSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type TwoFactorFormValues = z.infer<typeof twoFactorSchema>;
