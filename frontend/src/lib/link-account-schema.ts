import { z } from 'zod';

// Bounds aligned on the backend (`POST /users/me/external-accounts`), which validates
// `z.string().trim().min(1).max(30)`.
//
// Without the client-side cap a 31-character id travels to the server only to come back 400 —
// a red line in the Chrome console, which is a project-rejection criterion.
//
// `.trim()` BEFORE `.min(1)`: three spaces is empty, not valid. The server trims too, so
// sending a padded id would create a link whose stored id is not the one that was typed.
export const linkAccountSchema = z.object({
  externalId: z
    .string()
    .trim()
    .min(1, 'Enter your account ID.')
    .max(30, 'Use no more than 30 characters.'),
});

export type LinkAccountFormValues = z.infer<typeof linkAccountSchema>;
