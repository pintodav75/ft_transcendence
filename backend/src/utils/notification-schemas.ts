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
  // Social — `friendshipId` permet au front d'accepter/refuser DEPUIS la notification ;
  // le pseudo est display-safe (info publique) et évite une requête de plus pour
  // afficher « X t'a envoyé une demande ». C'est un instantané : si le pseudo change
  // plus tard, la notif garde l'ancien — normal, elle raconte un fait passé.
  friend_request_received: z.strictObject({
    friendshipId: uuidField,
    fromUserId: uuidField,
    fromPseudo: z.string(),
  }),
  friend_request_accepted: z.strictObject({
    friendshipId: uuidField,
    byUserId: uuidField,
    byPseudo: z.string(),
  }),
  // Équipe (B11) — même forme pour les trois : de qui vient l'action (`by*`) et sur quelle
  // équipe. `teamName` est un INSTANTANÉ, indispensable pour `team_disbanded` : l'équipe
  // n'existe plus au moment où le destinataire lit sa notif, on ne pourra plus la relire.
  // `ladderId` survit à la dissolution et permet au front de renvoyer vers le ladder.
  team_member_added: z.strictObject({
    teamId: uuidField,
    teamName: z.string(),
    ladderId: uuidField,
    byUserId: uuidField,
    byPseudo: z.string(),
  }),
  team_member_removed: z.strictObject({
    teamId: uuidField,
    teamName: z.string(),
    ladderId: uuidField,
    byUserId: uuidField,
    byPseudo: z.string(),
  }),
  team_disbanded: z.strictObject({
    teamId: uuidField,
    teamName: z.string(),
    ladderId: uuidField,
    byUserId: uuidField,
    byPseudo: z.string(),
  }),
  // Invitations (B-INV) — même forme que les notifs d'équipe, + `invitationId` : le front
  // peut accepter/refuser DEPUIS la notification, sans relister les invitations (exactement
  // le rôle de `friendshipId` sur `friend_request_received`). `by*` = l'AUTRE partie :
  // le capitaine qui invite pour `received`, le joueur qui répond pour les deux réponses.
  team_invitation_received: z.strictObject({
    invitationId: uuidField,
    teamId: uuidField,
    teamName: z.string(),
    ladderId: uuidField,
    byUserId: uuidField,
    byPseudo: z.string(),
  }),
  team_invitation_accepted: z.strictObject({
    invitationId: uuidField,
    teamId: uuidField,
    teamName: z.string(),
    ladderId: uuidField,
    byUserId: uuidField,
    byPseudo: z.string(),
  }),
  team_invitation_declined: z.strictObject({
    invitationId: uuidField,
    teamId: uuidField,
    teamName: z.string(),
    ladderId: uuidField,
    byUserId: uuidField,
    byPseudo: z.string(),
  }),
  // "votre creneau est tombe parce que X n'est plus dans l'equipe".
  // Ici on nomme le joueur qui part et pas l'acteur, contrairement aux autres notifications :
  // sur une exclusion c'est le capitaine qui agit, et il recevrait sinon une notification qui
  // lui dit "annule par le capitaine".
  // L'heure peut etre absente, on prefere l'afficher vide plutot que d'inventer une date ou
  // de faire echouer l'annulation sur un champ decoratif.
  // Le nom d'equipe est une photo a l'instant T : elle peut etre renommee ou dissoute avant
  // que le destinataire n'ouvre sa cloche.
  match_cancelled_member_left: z.strictObject({
    matchId: uuidField,
    ladderId: uuidField,
    scheduledAt: z.iso.datetime().nullable(),
    teamId: uuidField,
    teamName: z.string(),
    playerId: uuidField,
    playerPseudo: z.string(),
  }),
} as const satisfies Record<NotificationType, z.ZodType>;

export type NotificationPayload<T extends NotificationType> = z.infer<
  (typeof notificationPayloadSchemas)[T]
>;
