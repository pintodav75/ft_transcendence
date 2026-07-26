import { z } from 'zod';

// Miroir front de POST /teams (backend/src/routes/teams.ts) : mêmes bornes que
// `createTeamSchema` côté serveur, qui reste la source de vérité — on valide ici
// pour un retour instantané, pas pour remplacer la validation back.
export const NAME_MAX_LENGTH = 50;

export const createTeamSchema = z.object({
  // Piloté par LadderSelect (boutons, pas un <input>) : la seule règle qui
  // compte côté client est "un ladder a été choisi".
  ladderId: z.string().min(1, 'Pick a ladder.'),
  name: z
    .string()
    .trim()
    .min(1, 'Enter a team name.')
    .max(NAME_MAX_LENGTH, `Use no more than ${NAME_MAX_LENGTH} characters.`),
});

export type CreateTeamFormValues = z.infer<typeof createTeamSchema>;
