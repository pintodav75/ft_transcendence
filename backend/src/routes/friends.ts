import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../db/index.js';
import { usersTable, friendshipsTable } from '../db/schema.js';
import { eq, and, or } from 'drizzle-orm';
import { isBlocked } from '../utils/blocks.js';
import { notify, pushNotifications } from '../utils/notifications.js';
const friendsSchema = z.object({
  addresseeId: z.uuid(),
});
const idParamSchema = z.object({ id: z.uuid() });
// Défaut `received` : préserve exactement le comportement + la forme historiques
// pour les appelants existants (non-régression). `sent` liste mes demandes envoyées.
const requestsQuerySchema = z.object({
  direction: z.enum(['sent', 'received']).default('received'),
});

export const friendsRoutes: FastifyPluginAsync = async (server) => {
  server.post('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const requesterId = request.user.sub;
      const { addresseeId } = friendsSchema.parse(request.body);
      if (requesterId === addresseeId)
        return reply.code(400).send({ error: "can't friend yourself" });
      const [addresseeUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, addresseeId));
      if (!addresseeUser) return reply.code(404).send({ error: 'user not found' });
      // Mon pseudo : le token ne porte que mon id, or les notifications l'embarquent
      // pour que le front affiche « X t'a envoyé une demande » sans requête de plus.
      const [requesterUser] = await db
        .select({ pseudo: usersTable.pseudo })
        .from(usersTable)
        .where(eq(usersTable.id, requesterId));
      if (!requesterUser) return reply.code(401).send({ error: 'Unauthorized' });
      if (await isBlocked(requesterId, addresseeId)) {
        return reply.code(404).send({ error: 'user not found' });
      }
      const [existing] = await db
        .select()
        .from(friendshipsTable)
        .where(
          or(
            and(
              eq(friendshipsTable.requesterId, requesterId),
              eq(friendshipsTable.addresseeId, addresseeId),
            ),
            and(
              eq(friendshipsTable.requesterId, addresseeId),
              eq(friendshipsTable.addresseeId, requesterId),
            ),
          ),
        );
      if (!existing) {
        // B9 — la notif est INSÉRÉE DANS la transaction métier (atomique avec la
        // demande d'ami) ; le push WS se fait APRÈS le commit. Un rollback ne doit
        // jamais notifier un événement qui n'a pas eu lieu.
        const { created, notifs } = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(friendshipsTable)
            .values({ requesterId, addresseeId })
            .returning();
          if (!created) throw new Error('friendship insert returned no row');
          const notifs = await notify(tx, [addresseeId], 'friend_request_received', {
            friendshipId: created.id,
            fromUserId: requesterId,
            fromPseudo: requesterUser.pseudo,
          });
          return { created, notifs };
        });
        pushNotifications(notifs);
        return reply.code(201).send({ friendship: created });
      } else if (existing.status === 'accepted')
        return reply.code(400).send({ error: 'already friends' });
      else if (existing.status === 'pending' && existing.requesterId === addresseeId) {
        // AUTO-ACCEPT : l'autre m'avait déjà envoyé une demande, la mienne en retour
        // vaut acceptation. C'est donc LUI (le demandeur d'origine) qu'on prévient —
        // jamais l'acteur, c'est-à-dire moi (règle B9).
        const { updated, notifs } = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(friendshipsTable)
            .set({ status: 'accepted' })
            .where(eq(friendshipsTable.id, existing.id))
            .returning();
          if (!updated) throw new Error('friendship update returned no row');
          const notifs = await notify(tx, [addresseeId], 'friend_request_accepted', {
            friendshipId: updated.id,
            byUserId: requesterId,
            byPseudo: requesterUser.pseudo,
          });
          return { updated, notifs };
        });
        pushNotifications(notifs);
        return reply.code(200).send({ friendship: updated });
      } else if (existing.status === 'pending' && existing.requesterId === requesterId)
        return reply.code(400).send({ error: 'already requested' });
    } catch (error) {
      if (error instanceof z.ZodError) reply.code(400).send({ errors: error.issues });
      else return reply.code(500).send({ error: 'internal error' });
    }
  });
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const asRequester = await db
        .select()
        .from(friendshipsTable)
        .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.addresseeId))
        .where(
          and(eq(friendshipsTable.requesterId, userId), eq(friendshipsTable.status, 'accepted')),
        );
      const asAddressee = await db
        .select()
        .from(friendshipsTable)
        .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.requesterId))
        .where(
          and(eq(friendshipsTable.addresseeId, userId), eq(friendshipsTable.status, 'accepted')),
        );
      const allRows = [...asRequester, ...asAddressee];
      const friends = allRows.map((row) => ({
        // `id` est l'id de l'AMI (c'est lui qu'on bloque, dont on ouvre le profil et à qui
        // on écrit) ; `friendshipId` est l'id de la RELATION, le seul que `DELETE /friends/:id`
        // accepte. Sans lui, retirer un ami depuis cette liste était littéralement impossible
        // — aucune autre route ne fait la correspondance (trouvé en préparant [FS-1]).
        id: row.users.id,
        friendshipId: row.friendships.id,
        pseudo: row.users.pseudo,
        displayName: row.users.displayName,
        avatarUrl: row.users.avatarUrl,
        since: row.friendships.updatedAt,
      }));
      return reply.code(200).send({ friends });
    } catch (err) {
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.get('/requests', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user.sub;
      const { direction } = requestsQuerySchema.parse(request.query);
      if (direction === 'sent') {
        // Envoyées : je suis le requester, on joint l'ADDRESSEE (le destinataire).
        // Forme en miroir de l'existant, mais clé `to:` au lieu de `from:`.
        const res = await db
          .select()
          .from(friendshipsTable)
          .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.addresseeId))
          .where(
            and(eq(friendshipsTable.requesterId, userId), eq(friendshipsTable.status, 'pending')),
          );
        const requests = res.map((row) => ({
          id: row.friendships.id,
          sentAt: row.friendships.createdAt,
          to: {
            id: row.users.id,
            pseudo: row.users.pseudo,
            displayName: row.users.displayName,
            avatarUrl: row.users.avatarUrl,
          },
        }));
        return reply.code(200).send({ requests });
      }
      // received (défaut) — comportement + forme historiques, inchangés.
      const res = await db
        .select()
        .from(friendshipsTable)
        .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.requesterId))
        .where(
          and(eq(friendshipsTable.addresseeId, userId), eq(friendshipsTable.status, 'pending')),
        );
      const requests = res.map((row) => ({
        id: row.friendships.id,
        sentAt: row.friendships.createdAt,
        from: {
          id: row.users.id,
          pseudo: row.users.pseudo,
          displayName: row.users.displayName,
          avatarUrl: row.users.avatarUrl,
        },
      }));
      return reply.code(200).send({ requests });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      reply.code(500).send({ error: 'Internal error' });
    }
  });
  server.post<{ Params: { id: string } }>(
    '/:id/accept',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const { id: friendshipId } = idParamSchema.parse(request.params);
        const [friendship] = await db
          .select()
          .from(friendshipsTable)
          .where(eq(friendshipsTable.id, friendshipId));
        if (!friendship) return reply.code(404).send({ error: 'friendship not found' });
        if (friendship.addresseeId !== userId)
          return reply.code(403).send({ error: 'not authorized' });
        if (friendship.status !== 'pending')
          return reply.code(400).send({ error: 'already friends' });
        // Mon pseudo pour le payload de la notif (le token ne porte que mon id).
        const [accepterUser] = await db
          .select({ pseudo: usersTable.pseudo })
          .from(usersTable)
          .where(eq(usersTable.id, userId));
        if (!accepterUser) return reply.code(401).send({ error: 'Unauthorized' });

        const { updated, notifs } = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(friendshipsTable)
            .set({ status: 'accepted' })
            .where(eq(friendshipsTable.id, friendshipId))
            .returning();
          if (!updated) throw new Error('friendship update returned no row');
          // On prévient le DEMANDEUR que sa demande est acceptée — pas l'acteur (moi).
          const notifs = await notify(tx, [friendship.requesterId], 'friend_request_accepted', {
            friendshipId: updated.id,
            byUserId: userId,
            byPseudo: accepterUser.pseudo,
          });
          return { updated, notifs };
        });
        pushNotifications(notifs);
        return reply.code(200).send({ friendship: updated });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.post<{ Params: { id: string } }>(
    '/:id/reject',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const { id: friendshipId } = idParamSchema.parse(request.params);
        const [friendship] = await db
          .select()
          .from(friendshipsTable)
          .where(eq(friendshipsTable.id, friendshipId));
        if (!friendship) return reply.code(404).send({ error: 'friendship not found' });
        if (friendship.addresseeId !== userId)
          return reply.code(403).send({ error: 'not authorized' });
        if (friendship.status !== 'pending')
          return reply.code(400).send({ error: 'already friends' });
        await db.delete(friendshipsTable).where(eq(friendshipsTable.id, friendshipId));
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user.sub;
        const { id: friendshipId } = idParamSchema.parse(request.params);
        const [friendship] = await db
          .select()
          .from(friendshipsTable)
          .where(eq(friendshipsTable.id, friendshipId));
        if (!friendship) return reply.code(404).send({ error: 'friendship not found' });
        if (friendship.requesterId !== userId && friendship.addresseeId !== userId)
          return reply.code(403).send({ error: 'not authorized' });
        // Deux suppressions légitimes par ce DELETE :
        //  - amitié acceptée -> unfriend (les deux parties le peuvent) — inchangé ;
        //  - demande pending dont JE suis le requester -> j'annule MA demande envoyée.
        // Une pending où je suis l'addressee ne passe PAS par ici : le refus est
        // POST /:id/reject. D'où le 400 final.
        const canDelete =
          friendship.status === 'accepted' ||
          (friendship.status === 'pending' && friendship.requesterId === userId);
        if (!canDelete)
          return reply.code(400).send({ error: 'no deletable friendship for this action' });
        await db.delete(friendshipsTable).where(eq(friendshipsTable.id, friendshipId));
        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
