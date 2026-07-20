import { db } from '../db/index.js';
import { notificationsTable, matchSidesTable, matchParticipantsTable, usersTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { sendToUser } from '../routes/chat.js';
import {
  notificationPayloadSchemas,
  type NotificationType,
  type NotificationPayload,
} from './notification-schemas.js';

/**
 * B9 — le système de notifications, en DEUX couches :
 *   1. la table `notifications` = la source de vérité (survit à l'offline, alimente la
 *      cloche et le badge non-lu) ;
 *   2. le push WebSocket = du best-effort par-dessus (un destinataire hors ligne
 *      récupérera tout au prochain GET /notifications).
 *
 * ⚠️ LE PILIER ANTI-BUG : `notify()` INSÈRE dans la transaction métier (atomique avec
 * l'action qui déclenche la notif), mais NE POUSSE RIEN. Le push se fait APRÈS le commit,
 * via `pushNotifications()` sur les lignes retournées. Pousser depuis la transaction
 * notifierait un événement qui peut encore être ANNULÉ par un rollback.
 *
 * Les schémas de payload (par type, display-safe garanti à l'écriture) vivent dans
 * `notification-schemas.ts` — un fichier À PART, sans import de `db/index.js`, pour
 * rester testable en Vitest pur (sans DATABASE_URL). Voir tests/unit/notifications.test.ts.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type { NotificationType };
export type CreatedNotification = typeof notificationsTable.$inferSelect;

/**
 * Crée une notification par destinataire, DANS la transaction fournie.
 * Rend les lignes créées : l'appelant les passera à pushNotifications() après le commit.
 *
 * `data` est validé par le schéma du `type` AVANT l'insert (`.parse`, pas `.safeParse` —
 * un payload malformé doit faire échouer la transaction, pas s'écrire silencieusement
 * tronqué). Le générique `T` fait aussi que TypeScript refuse déjà à la compilation un
 * payload qui ne correspond pas au `type` donné — deux filets, compile-time et runtime.
 */
export async function notify<T extends NotificationType>(
  tx: Tx,
  userIds: string[],
  type: T,
  data: NotificationPayload<T>,
): Promise<CreatedNotification[]> {
  const validated: Record<string, unknown> = notificationPayloadSchemas[type].parse(data);
  // Dédoublonnage : un même user ne doit jamais recevoir deux fois la même notif
  // (ex. un capitaine présent dans deux listes de destinataires concaténées).
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  return tx
    .insert(notificationsTable)
    .values(unique.map((userId) => ({ userId, type, data: validated })))
    .returning();
}

/**
 * Push WebSocket best-effort — À APPELER APRÈS LE COMMIT, jamais dedans.
 * Un destinataire hors ligne est simplement ignoré (sendToUser ne fait rien sans socket) ;
 * une erreur d'envoi ne doit JAMAIS faire échouer la requête qui a déclenché la notif.
 */
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
      // best-effort : tant pis pour ce socket, la notif est en base
    }
  }
}

/**
 * Les joueurs ALIGNÉS d'un match (les deux sides confondus). C'est la liste de
 * destinataires des events d'équipe : `match_participants` = la lineup engagée,
 * le banc n'y figure pas (décision de la carte : banc exclu).
 */
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

/** Tous les admins — destinataires de `dispute_needs_admin` (l'arbitrage devient push, pas pull). */
export async function getAdminIds(executor: Executor): Promise<string[]> {
  const rows = await executor
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, true));
  return rows.map((r) => r.id);
}
