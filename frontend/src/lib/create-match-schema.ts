import { z } from 'zod';

// Miroir front de POST /matches (backend/src/routes/matches.ts), qui reste la source de
// vérité. Ces schémas ne rejouent PAS les règles que l'écran rend impossibles à violer (quart
// fixe, délai de 15 min, compte lié) : le sélecteur n'offre que des quarts valides, grise les
// joueurs non liés, et le bouton d'ouverture n'existe pas sans compte lié en 1v1. Ils ne
// valident que ce qu'un formulaire peut réellement rater — « rien de choisi » et « pas le bon
// nombre de joueurs ».

/**
 * Les deux champs que les DEUX formulaires partagent : le créneau.
 *
 * Les sélecteurs portent des epoch ms stringifiés (`<select>` ne connaît que des chaînes) ;
 * la seule règle qu'un formulaire peut rater est « rien n'est choisi ».
 */
const slotFields = {
  day: z.string().min(1, 'Pick a day.'),
  time: z.string().min(1, 'Pick a kick-off time.'),
};

/**
 * @param lineupSize `parseInt(team.format, 10)` — 2, 3 ou 5. Une équipe n'existe jamais sur un
 * ladder 1v1 (`routes/teams.ts` refuse la création en 400), donc la lineup est TOUJOURS
 * requise ici : il n'y a pas de branche solo sur ce schéma, c'est `soloSlotSchema` qui la
 * porte.
 */
export function createMatchSchema(lineupSize: number) {
  return z.object({
    ...slotFields,
    lineup: z
      .array(z.uuid())
      .length(lineupSize, `Field exactly ${lineupSize} players.`),
  });
}

/**
 * Le même créneau, SANS lineup — ladders 1v1 ([F-SOLO]).
 *
 * ⚠️ Ce n'est délibérément PAS `createMatchSchema(0)`. `POST /matches` déclare `lineup` en
 * `array().min(1).optional()` : l'absence de clé est acceptée (et ignorée en 1v1), mais un
 * tableau VIDE est refusé en 400. Un champ contraint à `[]` enverrait donc littéralement la
 * seule valeur que le serveur rejette.
 */
export const soloSlotSchema = z.object(slotFields);

export type CreateMatchFormValues = z.infer<ReturnType<typeof createMatchSchema>>;
export type SoloSlotFormValues = z.infer<typeof soloSlotSchema>;
