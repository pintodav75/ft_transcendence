import { db } from '../db/index.js';
import { notificationsTable, matchSidesTable, matchParticipantsTable, usersTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { sendToUser } from '../routes/chat.js';
import {
  notificationPayloadSchemas,
  type NotificationType,
  type NotificationPayload,
} from './notification-schemas.js';

// Les notifications marchent sur deux couches : la table notifications est la source de verite
// (elle survit a la deconnexion et alimente la cloche), le push WebSocket n'est qu'un bonus
// par dessus. Quelqu'un hors ligne recuperera tout a son prochain GET /notifications.
//
// La regle a ne pas casser : notify() ecrit DANS la transaction metier, mais ne pousse rien.
// Le push se fait apres le commit avec pushNotifications(). Sinon on annoncerait un evenement
// qu'un rollback peut encore effacer.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type { NotificationType };
export type CreatedNotification = typeof notificationsTable.$inferSelect;

// Une notification par destinataire, dans la transaction qu'on nous passe. On rend les lignes
// creees pour que l'appelant les donne a pushNotifications() une fois le commit passe.
// On valide avec .parse et pas .safeParse : un payload malforme doit faire echouer la
// transaction, pas s'ecrire tronque dans son coin.
export async function notify<T extends NotificationType>(
  tx: Tx,
  userIds: string[],
  type: T,
  data: NotificationPayload<T>,
): Promise<CreatedNotification[]> {
  const validated: Record<string, unknown> = notificationPayloadSchemas[type].parse(data);
  // Un capitaine peut se retrouver dans deux listes de destinataires collees bout a bout,
  // on dedoublonne pour ne pas lui envoyer deux fois la meme chose.
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  return tx
    .insert(notificationsTable)
    .values(unique.map((userId) => ({ userId, type, data: validated })))
    .returning();
}

// A appeler apres le commit, jamais dedans. Un destinataire hors ligne est ignore, et une
// erreur d'envoi ne doit surtout pas faire echouer la requete qui a declenche la notif.
export function pushNotifications(notifications: CreatedNotification[]): void {
  for (const n of notifications) {
    try {
      sendToUser(
        n.userId,
        JSON.stringify({
          type: 'notification',
          notification: {
            id: n.id,
            type: n.type,
            data: n.data,
            readAt: n.readAt,
            createdAt: n.createdAt,
          },
        }),
      );
    } catch {
      // tant pis pour ce socket, la notif est en base de toute facon
    }
  }
}

// Les joueurs alignes d'un match, les deux camps confondus. C'est a eux qu'on envoie les
// notifs d'equipe : match_participants ne contient que la compo, le banc n'est pas dedans.
export async function getMatchParticipantIds(
  executor: Executor,
  matchId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ userId: matchParticipantsTable.userId })
    .from(matchParticipantsTable)
    .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
    .where(eq(matchSidesTable.matchId, matchId));
  return rows.map((r) => r.userId);
}

// Tous les admins, pour dispute_needs_admin : l'arbitre est prevenu, il n'a pas a surveiller.
export async function getAdminIds(executor: Executor): Promise<string[]> {
  const rows = await executor
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, true));
  return rows.map((r) => r.id);
}
