import { z } from 'zod';
import { notificationsTable } from '../db/schema.js';

/**
 * Schémas de payload par type de notification (B9) — extraits dans un fichier À PART,
 * sans import de `db/index.js` (qui exige `DATABASE_URL` au chargement du module), pour
 * rester un helper PUR testable sans DB ni transaction (comme elo.ts/leaderboard.ts).
 */

export type NotificationType = (typeof notificationsTable.$inferSelect)['type'];

const uuidField = z.uuid();

/**
 * Un schéma par type de notification — le payload AUTORISÉ pour ce type, rien d'autre.
 * `z.strictObject` rejette aussi tout champ EN TROP (ex. un `email` glissé par erreur) :
 * c'est ça qui rend "display-safe" GARANTI À L'ÉCRITURE et pas juste documenté en
 * commentaire — un appelant qui se trompe de champ voit `notify()` jeter, pas écrire.
 */
export const notificationPayloadSchemas = {
  match_accepted: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
    scheduledAt: z.iso.datetime(),
  }),
  result_submitted: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
  }),
  result_confirmed: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
    winnerSideId: uuidField,
  }),
  dispute_opened: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
    disputeId: uuidField,
  }),
  dispute_resolved: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
    disputeId: uuidField,
    resolution: z.enum(['side_0_wins', 'side_1_wins', 'cancelled']),
  }),
  dispute_auto_cancelled: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
    disputeId: uuidField,
  }),
  match_ghost_cancelled: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
  }),
  dispute_needs_admin: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
    disputeId: uuidField,
  }),
} as const satisfies Record<NotificationType, z.ZodType>;

export type NotificationPayload<T extends NotificationType> = z.infer<
  (typeof notificationPayloadSchemas)[T]
>;
