import { z } from 'zod';

// Miroir front de POST /matches (backend/src/routes/matches.ts), qui reste la source de
// vérité. Ce schéma ne rejoue PAS les règles que l'écran rend impossibles à violer (quart
// fixe, délai de 15 min, compte lié) : le sélecteur n'offre que des quarts valides et grise
// les joueurs non liés. Il ne valide que ce qu'un formulaire peut réellement rater —
// « rien de choisi » et « pas le bon nombre de joueurs ».

/**
 * @param lineupSize `parseInt(team.format)` — 2, 3 ou 5. Une équipe n'existe jamais sur un
 * ladder 1v1 (`routes/teams.ts` refuse la création en 400), donc la lineup est TOUJOURS
 * requise ici : il n'y a pas de branche solo sur cette page.
 */
export function createMatchSchema(lineupSize: number) {
  return z.object({
    // Les deux sélecteurs portent des epoch ms stringifiés (`<select>` ne connaît que des
    // chaînes) ; la seule règle qu'un formulaire peut rater est « rien n'est choisi ».
    day: z.string().min(1, 'Pick a day.'),
    time: z.string().min(1, 'Pick a kick-off time.'),
    lineup: z
      .array(z.uuid())
      .length(lineupSize, `Field exactly ${lineupSize} players.`),
  });
}

export type CreateMatchFormValues = z.infer<ReturnType<typeof createMatchSchema>>;
