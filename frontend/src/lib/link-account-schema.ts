import { z } from 'zod';

// Bounds aligned on the backend (`POST /users/me/external-accounts`), which validates
// `z.string().trim().min(1).max(30)`.
export const linkAccountSchema = z.object({
  externalId: z
    .string()
    .trim()
    .min(1, 'Enter your account ID.')
    .max(30, 'Use no more than 30 characters.'),
});

export type LinkAccountFormValues = z.infer<typeof linkAccountSchema>;
