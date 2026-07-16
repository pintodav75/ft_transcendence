import { z } from 'zod';

export const registerSchema = z.object({
  pseudo: z
    .string()
    .trim()
    .min(3, 'Use at least 3 characters.')
    .max(30, 'Use no more than 30 characters.'),
  email: z.email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(72, 'Use no more than 72 characters.')
    .regex(/[A-Z]/, 'Add at least one uppercase letter.')
    .regex(/[a-z]/, 'Add at least one lowercase letter.')
    .regex(/\d/, 'Add at least one number.')
    .regex(/[^A-Za-z0-9]/, 'Add at least one special character.'),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
