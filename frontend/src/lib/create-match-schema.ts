import { z } from 'zod';

// Miroir front de POST /matches (backend/src/routes/matches.ts), qui reste la source de vérité.

/** Les deux champs que les DEUX formulaires partagent : le créneau. */
const slotFields = {
  day: z.string().min(1, 'Pick a day.'),
  time: z.string().min(1, 'Pick a kick-off time.'),
};

/** @param lineupSize `parseInt(team.format, 10)` — 2, 3 ou 5. */
export function createMatchSchema(lineupSize: number) {
  return z.object({
    ...slotFields,
    lineup: z
      .array(z.uuid())
      .length(lineupSize, `Field exactly ${lineupSize} players.`),
  });
}

/** Le même créneau, SANS lineup — ladders 1v1. */
export const soloSlotSchema = z.object(slotFields);

export type CreateMatchFormValues = z.infer<ReturnType<typeof createMatchSchema>>;
export type SoloSlotFormValues = z.infer<typeof soloSlotSchema>;
