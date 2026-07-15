import { z } from 'zod';

export const registerSchema = z.object({
  pseudo: z
    .string()
    .min(3, 'Nickname must be at least 3 characters long.')
    .max(30, 'Nickname cannot exceed 30 characters.'),
  email: z.email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long.')
    .regex(/[A-Z]/, 'Add at least one uppercase letter.')
    .regex(/[a-z]/, 'Add at least one lowercase letter.')
    .regex(/\d/, 'Add at least one number.')
    .regex(/[^A-Za-z0-9]/, 'Add at least one special character.'),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
