import { z } from 'zod';

// Bornes alignées sur le backend (PATCH /users/me). `displayName` est REQUIS ici, et c'est un
// choix, pas un oubli.
export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a nickname — it cannot be empty.')
    .max(50, 'Use no more than 50 characters.'),
  bio: z.string().trim().max(280, 'Use no more than 280 characters.'),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
