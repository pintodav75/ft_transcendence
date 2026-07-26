import { z } from 'zod';

// Miroir front de POST /teams (backend/src/routes/teams.ts) : mêmes bornes que
// `createTeamSchema` côté serveur, qui reste la source de vérité — on valide ici
// pour un retour instantané, pas pour remplacer la validation back.
export const NAME_MAX_LENGTH = 50;
export const LOGO_URL_MAX_LENGTH = 2048;

export const createTeamSchema = z.object({
  // Piloté par LadderSelect (boutons, pas un <input>) : la seule règle qui
  // compte côté client est "un ladder a été choisi".
  ladderId: z.string().min(1, 'Pick a ladder.'),
  name: z
    .string()
    .trim()
    .min(1, 'Enter a team name.')
    .max(NAME_MAX_LENGTH, `Use no more than ${NAME_MAX_LENGTH} characters.`),
  // Champ optionnel : une chaîne vide reste une chaîne vide ici (le composant
  // décide de ne pas envoyer la clé au serveur), on ne transforme pas en
  // undefined pour garder le typage RHF simple (defaultValues: '').
  // Le `http://` est bloqué ICI, avant tout aller-retour réseau : la page est
  // servie en HTTPS, une image chargée en clair serait du contenu mixte.
  logoUrl: z
    .string()
    .trim()
    .refine((value) => value === '' || value.startsWith('https://'), {
      message: 'Use an https:// address — http:// would load mixed content on this page.',
    })
    .refine((value) => value.length <= LOGO_URL_MAX_LENGTH, {
      message: `Use no more than ${LOGO_URL_MAX_LENGTH} characters.`,
    }),
});

export type CreateTeamFormValues = z.infer<typeof createTeamSchema>;
