import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../db/index.js';
import {
  disputesTable,
  disputeEvidenceTable,
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  teamsTable,
  teamMembersTable,
  usersTable,
} from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { minioClient, EVIDENCE_BUCKET, presignEvidenceUrl } from '../storage/minio.js';
import { EVIDENCE_MIME } from './users.js';
import { completeMatchWithElo } from '../utils/rankings.js';
import {
  notify,
  pushNotifications,
  getMatchParticipantIds,
  type CreatedNotification,
} from '../utils/notifications.js';
import { randomUUID } from 'node:crypto';
import { rlMax } from '../utils/rate-limit.js';

const idParamSchema = z.object({ id: z.uuid() });
const resolveBodySchema = z.object({
  resolution: z.enum(['side_0_wins', 'side_1_wins', 'cancelled']),
  notes: z.string().trim().max(1000).optional(),
});

export const disputesRoutes: FastifyPluginAsync = async (server) => {
  // GET /disputes — la FILE D'ARBITRAGE, admin only. Sans elle, un admin devrait déjà connaître
  // l'UUID d'une dispute pour agir : il n'y aurait aucun moyen de DÉCOUVRIR les litiges en
  // attente. Tri par ancienneté (la plus vieille en tête) = ordre de traitement.
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const me = request.user.sub;
      const [user] = await db
        .select({ isAdmin: usersTable.isAdmin })
        .from(usersTable)
        .where(eq(usersTable.id, me));
      if (!user?.isAdmin) return reply.code(403).send({ error: 'admin only' });

      const rows = await db
        .select({
          id: disputesTable.id,
          matchId: disputesTable.matchId,
          ladderId: matchesTable.ladderId,
          scheduledAt: matchesTable.scheduledAt,
          createdAt: disputesTable.createdAt,
        })
        .from(disputesTable)
        .innerJoin(matchesTable, eq(matchesTable.id, disputesTable.matchId))
        .where(eq(disputesTable.status, 'open'))
        .orderBy(disputesTable.createdAt); // asc = la plus ancienne d'abord

      // Nombre de preuves par dispute en UNE requête (pas de N+1) → l'admin voit d'un coup
      // d'œil quels litiges ont déjà des pièces.
      const ids = rows.map((r) => r.id);
      const counts = ids.length
        ? await db
            .select({
              disputeId: disputeEvidenceTable.disputeId,
              n: sql<number>`count(*)::int`,
            })
            .from(disputeEvidenceTable)
            .where(inArray(disputeEvidenceTable.disputeId, ids))
            .groupBy(disputeEvidenceTable.disputeId)
        : [];
      const countById = new Map(counts.map((c) => [c.disputeId, c.n]));

      return {
        disputes: rows.map((r) => ({ ...r, evidenceCount: countById.get(r.id) ?? 0 })),
      };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.post(
    '/:id/evidence',
    {
      onRequest: [server.authenticate],
      // 30/min : un camp peut légitimement déposer plusieurs captures + messages dans un fil ;
      // 10/min était trop serré. Reste un garde-fou anti-spam.
      config: { rateLimit: { max: rlMax(30), timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      // `key` est hissé hors du try : si l'objet MinIO a été uploadé mais qu'un échec survient
      // ensuite (insert qui jette), le bloc catch le supprime → aucun orphelin.
      let key: string | undefined;
      try {
        const { id } = idParamSchema.parse(request.params);
        const me = request.user.sub;
        if (!request.isMultipart())
          return reply.code(400).send({ error: 'expected multipart/form-data' });

        // 1. La dispute existe.
        const [dispute] = await db.select().from(disputesTable).where(eq(disputesTable.id, id));
        if (!dispute) return reply.code(404).send({ error: 'dispute not found' });

        // 2. Garde de camp AVANT de révéler l'état open/resolved. Sinon un inconnu sonderait
        //    l'état d'une dispute (409 = résolue vs 403 = pas à moi). Je dois être capitaine
        //    (2v2+) OU le joueur (1v1) d'un des deux sides.
        const sides = await db
          .select({ id: matchSidesTable.id, teamId: matchSidesTable.teamId })
          .from(matchSidesTable)
          .where(eq(matchSidesTable.matchId, dispute.matchId));

        let mySideId: string | undefined;
        for (const side of sides) {
          if (side.teamId) {
            // side d'équipe → seul le capitaine agit (il représente son équipe)
            const [team] = await db
              .select({ captainId: teamsTable.captainId })
              .from(teamsTable)
              .where(eq(teamsTable.id, side.teamId));
            if (team && team.captainId === me) {
              mySideId = side.id;
              break;
            }
          } else {
            // side 1v1 (team_id NULL) → le joueur aligné agit
            const [participant] = await db
              .select({ id: matchParticipantsTable.id })
              .from(matchParticipantsTable)
              .where(
                and(
                  eq(matchParticipantsTable.matchSideId, side.id),
                  eq(matchParticipantsTable.userId, me),
                ),
              );
            if (participant) {
              mySideId = side.id;
              break;
            }
          }
        }
        if (!mySideId)
          return reply.code(403).send({ error: 'not a captain or player of this match' });

        // 3. Seulement maintenant (l'appelant est bien un camp) on révèle l'état : la dispute
        //    doit être encore ouverte.
        if (dispute.status !== 'open')
          return reply.code(409).send({ error: 'dispute is already resolved' });

        // 4. Lire ET valider TOUT l'upload EN MÉMOIRE avant le moindre putObject → aucun objet
        //    orphelin si le message manque ou le type de fichier est mauvais.
        let fileBuffer: Buffer | undefined;
        let mime: string | undefined;
        let message: string | undefined;

        // Bornes STRICTES : une preuve = EXACTEMENT 1 image + 1 message. Sans `files`/`parts`,
        // `fileSize` ne borne QUE chaque fichier → un capitaine authentifié pourrait envoyer des
        // centaines de fichiers de ~5 Mo dans une seule requête (1 seul hit de rate-limit,
        // plusieurs Go lus en Buffer l'un après l'autre) → épuisement mémoire/CPU/bande passante.
        // On plafonne donc l'ensemble. Un dépassement jette FST_FILES/FIELDS/PARTS_LIMIT, mappés
        // en 400 dans le catch (sinon ils remonteraient en 500).
        const parts = request.parts({
          limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
        });
        for await (const part of parts) {
          if (part.type === 'file') {
            if (part.fieldname !== 'evidence')
              return reply.code(400).send({ error: 'unexpected file field' });
            if (!(part.mimetype in EVIDENCE_MIME))
              return reply.code(400).send({ error: 'unsupported file type' });
            mime = part.mimetype;
            // toBuffer() respecte la limite 5 Mo → jette FST_REQ_FILE_TOO_LARGE si dépassée.
            fileBuffer = await part.toBuffer();
          } else if (part.type === 'field' && part.fieldname === 'message') {
            message = String(part.value).trim();
          }
        }

        if (!fileBuffer || !mime) return reply.code(400).send({ error: 'no file uploaded' });
        if (!message) return reply.code(400).send({ error: 'message required' });

        // 5. Upload dans le bucket PRIVÉ. On stocke la CLÉ d'objet (pas une URL) : l'URL de
        //    lecture sera présignée à la volée dans GET /disputes/:id, après la garde.
        const ext = EVIDENCE_MIME[mime as keyof typeof EVIDENCE_MIME];
        key = `${randomUUID()}.${ext}`;
        await minioClient.putObject(EVIDENCE_BUCKET, key, fileBuffer, fileBuffer.length, {
          'Content-Type': mime,
        });

        // 6. Insert SOUS VERROU + re-check `open` : ferme la course avec un resolve/job qui
        //    pourrait clore la dispute pendant l'upload. Même clé de verrou (matchId) que
        //    resolve et les jobs. Si la dispute a été close entre-temps → 409 + on retire l'objet.
        const result = await db.transaction(
          async (
            tx,
          ): Promise<
            { ok: true; evidence: typeof disputeEvidenceTable.$inferSelect } | { ok: false }
          > => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${dispute.matchId}))`);
            const [d] = await tx
              .select({ status: disputesTable.status })
              .from(disputesTable)
              .where(eq(disputesTable.id, id));
            if (!d || d.status !== 'open') return { ok: false };
            const [evidence] = await tx
              .insert(disputeEvidenceTable)
              .values({
                disputeId: dispute.id,
                submittedByUserId: me,
                matchSideId: mySideId,
                evidenceUrl: key!,
                description: message,
              })
              .returning();
            return { ok: true, evidence: evidence! };
          },
        );

        if (!result.ok) {
          await minioClient.removeObject(EVIDENCE_BUCKET, key).catch(() => {});
          key = undefined; // déjà nettoyé → ne pas re-supprimer dans le catch
          return reply.code(409).send({ error: 'dispute is already resolved' });
        }

        key = undefined; // succès → l'objet appartient à une ligne, plus un orphelin potentiel
        // On NE renvoie PAS `evidenceUrl` (qui contient la CLÉ d'objet privée, pas une URL
        // exploitable) : le client recharge le fil via GET /:id pour obtenir des URL présignées.
        const e = result.evidence;
        return reply.code(201).send({
          evidence: {
            id: e.id,
            disputeId: e.disputeId,
            matchSideId: e.matchSideId,
            submittedByUserId: e.submittedByUserId,
            message: e.description,
            submittedAt: e.submittedAt,
          },
        });
      } catch (error) {
        // Un échec APRÈS l'upload (insert qui jette, etc.) laisserait un objet orphelin : on le
        // supprime en best-effort. `key` est undefined tant qu'aucun upload n'a eu lieu.
        if (key) await minioClient.removeObject(EVIDENCE_BUCKET, key).catch(() => {});
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: string }).code
            : undefined;
        // Un seul fichier au-dessus de 5 Mo → 413.
        if (code === 'FST_REQ_FILE_TOO_LARGE')
          return reply.code(413).send({ error: 'File too large' });
        // Trop de fichiers / champs / parties → requête malformée (on attend 1 image + 1 message).
        if (code === 'FST_FILES_LIMIT' || code === 'FST_FIELDS_LIMIT' || code === 'FST_PARTS_LIMIT')
          return reply.code(400).send({ error: 'expected exactly one image and one message' });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  // GET /disputes/:id — l'état de la dispute, CE QUE CHAQUE CAMP A DÉCLARÉ (sides + identités +
  // submittedWinnerSideId) et le fil de preuves. C'est ce détail qui rend l'arbitrage possible :
  // sans lui, l'admin ne saurait pas qui est le side 0/1 ni ce que chacun a annoncé.
  // Lecture ouverte à tout participant du match (banc compris, MÊME garde que GET /matches/:id)
  // OU à un admin.
  server.get('/:id', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const { id } = idParamSchema.parse(request.params);
      const me = request.user.sub;

      // 1. La dispute existe.
      const [dispute] = await db.select().from(disputesTable).where(eq(disputesTable.id, id));
      if (!dispute) return reply.code(404).send({ error: 'dispute not found' });

      // 2. Les sides du match (id + index + team + ce que le camp a déclaré vainqueur).
      const sides = await db
        .select({
          id: matchSidesTable.id,
          sideIndex: matchSidesTable.sideIndex,
          teamId: matchSidesTable.teamId,
          submittedWinnerSideId: matchSidesTable.submittedWinnerSideId,
        })
        .from(matchSidesTable)
        .where(eq(matchSidesTable.matchId, dispute.matchId));
      const sideIds = sides.map((s) => s.id);
      const sideTeamIds = sides.map((s) => s.teamId).filter((t): t is string => t !== null);

      // 3. Garde de lecture : admin, OU participant aligné, OU membre d'une team engagée (banc).
      const [user] = await db
        .select({ isAdmin: usersTable.isAdmin })
        .from(usersTable)
        .where(eq(usersTable.id, me));
      let allowed = user?.isAdmin ?? false;

      const participants = sideIds.length
        ? await db
            .select({
              matchSideId: matchParticipantsTable.matchSideId,
              userId: matchParticipantsTable.userId,
            })
            .from(matchParticipantsTable)
            .where(inArray(matchParticipantsTable.matchSideId, sideIds))
        : [];
      if (!allowed) allowed = participants.some((p) => p.userId === me);
      if (!allowed && sideTeamIds.length) {
        const [teamMember] = await db
          .select({ id: teamMembersTable.id })
          .from(teamMembersTable)
          .where(and(eq(teamMembersTable.userId, me), inArray(teamMembersTable.teamId, sideTeamIds)));
        allowed = !!teamMember;
      }
      if (!allowed) return reply.code(403).send({ error: 'not a participant of this match' });

      // 4. Enrichissement des sides — DEUX requêtes pour tout le monde (pas de N+1), projection
      //    EXPLICITE sur users (jamais de select() nu → fuite email/passwordHash).
      const userIds = participants.map((p) => p.userId);
      const teams = sideTeamIds.length
        ? await db
            .select({
              id: teamsTable.id,
              name: teamsTable.name,
              logoUrl: teamsTable.logoUrl,
              captainId: teamsTable.captainId,
            })
            .from(teamsTable)
            .where(inArray(teamsTable.id, sideTeamIds))
        : [];
      const players = userIds.length
        ? await db
            .select({
              id: usersTable.id,
              pseudo: usersTable.pseudo,
              displayName: usersTable.displayName,
              avatarUrl: usersTable.avatarUrl,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, userIds))
        : [];
      const teamById = new Map(teams.map((t) => [t.id, t]));
      const playerById = new Map(players.map((p) => [p.id, p]));

      const shapedSides = sides
        .sort((a, b) => a.sideIndex - b.sideIndex)
        .map((s) => ({
          id: s.id,
          sideIndex: s.sideIndex,
          submittedWinnerSideId: s.submittedWinnerSideId, // ce que CE camp a déclaré vainqueur
          team: s.teamId ? (teamById.get(s.teamId) ?? null) : null,
          players: participants
            .filter((p) => p.matchSideId === s.id)
            .map((p) => playerById.get(p.userId))
            .filter((p): p is NonNullable<typeof p> => p !== undefined),
        }));

      // 5. Le fil de preuves, trié chronologiquement.
      const evidence = await db
        .select({
          id: disputeEvidenceTable.id,
          matchSideId: disputeEvidenceTable.matchSideId,
          evidenceKey: disputeEvidenceTable.evidenceUrl,
          message: disputeEvidenceTable.description,
          submittedAt: disputeEvidenceTable.submittedAt,
          submittedByUserId: disputeEvidenceTable.submittedByUserId,
        })
        .from(disputeEvidenceTable)
        .where(eq(disputeEvidenceTable.disputeId, id))
        .orderBy(disputeEvidenceTable.submittedAt);

      // Les auteurs en UNE requête (pas de N+1), projection explicite.
      const authorIds = [
        ...new Set(evidence.map((e) => e.submittedByUserId).filter((x): x is string => x !== null)),
      ];
      const authors = authorIds.length
        ? await db
            .select({
              id: usersTable.id,
              pseudo: usersTable.pseudo,
              displayName: usersTable.displayName,
              avatarUrl: usersTable.avatarUrl,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, authorIds))
        : [];
      const authorById = new Map(authors.map((a) => [a.id, a]));

      // Chaque preuve reçoit une URL PRÉSIGNÉE courte durée (bucket privé) — générée seulement
      // ici, après la garde. Personne sans cet accès ne peut lire l'objet.
      const evidenceOut = await Promise.all(
        evidence.map(async (e) => ({
          id: e.id,
          matchSideId: e.matchSideId,
          evidenceUrl: await presignEvidenceUrl(e.evidenceKey),
          message: e.message,
          submittedAt: e.submittedAt,
          author: e.submittedByUserId ? (authorById.get(e.submittedByUserId) ?? null) : null,
        })),
      );

      return {
        dispute: {
          id: dispute.id,
          matchId: dispute.matchId,
          status: dispute.status,
          resolution: dispute.resolution,
          resolutionNotes: dispute.resolutionNotes,
          resolvedAt: dispute.resolvedAt,
        },
        sides: shapedSides,
        evidence: evidenceOut,
      };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // POST /disputes/:id/resolve — arbitrage admin. C'est LA sortie de l'état `disputed` :
  // l'admin tranche (side 0/1 gagne -> completed + ELO ; cancelled -> annulé, ELO inchangé),
  // la dispute passe `resolved` et les deux camps sont libérés (§5.2).
  server.post('/:id/resolve', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const { id } = idParamSchema.parse(request.params);
      const { resolution, notes } = resolveBodySchema.parse(request.body);
      const me = request.user.sub;

      // Garde : admin uniquement.
      const [user] = await db
        .select({ isAdmin: usersTable.isAdmin })
        .from(usersTable)
        .where(eq(usersTable.id, me));
      if (!user?.isAdmin) return reply.code(403).send({ error: 'admin only' });

      // Pré-check hors transaction (échec rapide) — l'autorité est le re-check sous verrou.
      const [dispute] = await db.select().from(disputesTable).where(eq(disputesTable.id, id));
      if (!dispute) return reply.code(404).send({ error: 'dispute not found' });
      if (dispute.status !== 'open')
        return reply.code(409).send({ error: 'dispute is already resolved' });

      const result = await db.transaction(
        async (
          tx,
        ): Promise<
          | { ok: true; notifs: CreatedNotification[] }
          | { ok: false; code: number; error: string }
        > => {
          // Même verrou consultatif que la route /result et les jobs (clé = matchId) → aucune
          // course avec une auto-confirmation, un autre arbitrage ou le job 24 h.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${dispute.matchId}))`);

          // Re-check SOUS VERROU : la dispute a pu être résolue entre le pré-check et le verrou.
          const [d] = await tx
            .select({ status: disputesTable.status })
            .from(disputesTable)
            .where(eq(disputesTable.id, id));
          if (!d || d.status !== 'open')
            return { ok: false, code: 409, error: 'dispute is already resolved' };
          const [m] = await tx
            .select({ status: matchesTable.status, ladderId: matchesTable.ladderId })
            .from(matchesTable)
            .where(eq(matchesTable.id, dispute.matchId));
          if (!m) return { ok: false, code: 500, error: 'Internal error' };
          if (m.status !== 'disputed')
            return { ok: false, code: 409, error: 'match is no longer disputed' };

          if (resolution === 'cancelled') {
            // Annulation neutre : aucun ELO, le match sort de `disputed` -> les fenêtres se libèrent.
            await tx
              .update(matchesTable)
              .set({ status: 'cancelled' })
              .where(eq(matchesTable.id, dispute.matchId));
          } else {
            // L'admin désigne un vainqueur -> completed + ELO via le helper partagé (comme B6).
            const wantedIndex = resolution === 'side_0_wins' ? 0 : 1;
            const [winnerSide] = await tx
              .select({ id: matchSidesTable.id })
              .from(matchSidesTable)
              .where(
                and(
                  eq(matchSidesTable.matchId, dispute.matchId),
                  eq(matchSidesTable.sideIndex, wantedIndex),
                ),
              );
            if (!winnerSide) return { ok: false, code: 500, error: 'Internal error' };
            // L'admin tranche un vainqueur, PAS un score : `null` littéral et explicite ici,
            // pas une valeur par défaut cachée dans le helper (B14).
            await completeMatchWithElo(tx, dispute.matchId, m.ladderId, winnerSide.id, null, null);
          }

          await tx
            .update(disputesTable)
            .set({
              status: 'resolved',
              resolution,
              resolvedByUserId: me,
              resolutionNotes: notes ?? null,
              resolvedAt: new Date(),
            })
            .where(eq(disputesTable.id, id));

          // B9 — « la dispute a été tranchée » : les joueurs alignés des DEUX camps.
          // L'acteur (l'admin) est exclu — cas limite : un admin qui arbitrerait son
          // propre match ne se notifie pas lui-même. Insert dans la tx, push après commit.
          const recipients = (await getMatchParticipantIds(tx, dispute.matchId)).filter(
            (u) => u !== me,
          );
          const notifs = await notify(tx, recipients, 'dispute_resolved', {
            matchId: dispute.matchId,
            ladderId: m.ladderId,
            disputeId: id,
            resolution,
          });

          return { ok: true, notifs };
        },
      );

      if (!result.ok) return reply.code(result.code).send({ error: result.error });
      pushNotifications(result.notifs);
      return reply.code(200).send({ status: 'resolved', resolution });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
};
