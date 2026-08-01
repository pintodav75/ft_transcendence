import { z } from 'zod';

// Bornes alignées sur le backend (PATCH /users/me).
//
// 🔑 `displayName` est REQUIS ici, et c'est un choix, pas un oubli. La route accepte de
// l'omettre mais ne sait pas le remettre à null : un champ vidé était donc envoyé comme
// « absent », l'API répondait 200, et le pseudo restait en place — l'utilisateur croyait
// l'avoir effacé alors que rien n'avait bougé. Un refus explicite vaut mieux qu'un succès
// qui ment. Effacer vraiment son pseudo demanderait que l'API accepte `null`.
//
// `.trim()` AVANT `.min(1)` : une saisie de trois espaces est vide, pas valide.
export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a nickname — it cannot be empty.')
    .max(50, 'Use no more than 50 characters.'),
  bio: z.string().trim().max(280, 'Use no more than 280 characters.'),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
