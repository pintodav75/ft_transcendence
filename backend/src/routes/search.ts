import type { FastifyPluginAsync } from 'fastify';
import z from 'zod';
import { db } from '../db/index.js';
import { usersTable, blocksTable, teamsTable } from '../db/schema.js';
import { sql, eq, or, and, notExists } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';

const querySearchSchema = z.object({
  q: z.string().trim().min(2).max(50),
  // FILTRE : restreint la recherche à un seul type. Absent -> les deux (défaut d'origine).
  type: z.enum(['user', 'team']).optional(),
  // PAGINATION : `coerce` obligatoire — une querystring arrive TOUJOURS en chaîne
  // ("10"), jamais en nombre. Les défauts reproduisent le comportement d'avant.
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  // TRI : sens du classement alphabétique. Le critère, lui, n'est PAS négociable — c'est le
  // nom (`sortKey`), seule colonne que les deux sources ont en commun. Le défaut `asc`
  // reproduit le comportement d'avant, donc aucun appelant existant ne change de résultat.
  order: z.enum(['asc', 'desc']).default('asc'),
});

// Union discriminée : le champ `type` permet au consommateur (le front) de distinguer
// les deux formes sans deviner — `if (r.type === 'user')` rétrécit le type côté TS.
type SearchResult =
  | {
      type: 'user';
      id: string;
      pseudo: string;
      displayName: string | null;
      avatarUrl: string | null;
    }
  | {
      type: 'team';
      id: string;
      name: string;
      logoUrl: string | null;
      ladderId: string;
    };

// Forme COMMUNE aux deux sources. C'est elle qui rend l'UNION possible — donc le tri
// et la pagination GLOBAUX (review : avant, chaque source était triée et paginée dans
// son coin, ce qui pouvait rendre 2 × limit résultats et faisait passer TOUS les users
// avant TOUTES les teams). Les colonnes doivent sortir dans le MÊME ORDRE et avec des
// types compatibles dans les deux branches du UNION.
type SearchRow = {
  kind: 'user' | 'team';
  id: string;
  sortKey: string;
  label: string; // pseudo (user) ou name (team)
  displayName: string | null; // toujours null côté team
  imageUrl: string | null; // avatarUrl (user) ou logoUrl (team)
  ladderId: string | null; // toujours null côté user
};

// `%` et `_` sont des jokers SQL, `\` le caractère d'échappement : on les neutralise
// pour que `q` soit traité comme du texte littéral. Seul le `%` qu'on ajoute nous-même
// à la fin du motif joue le rôle de « commence par ».
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const searchRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const { q, type, limit, offset, order } = querySearchSchema.parse(request.query);
      // ⚠️ La mise en minuscules est faite par POSTGRES des DEUX côtés, jamais par JS.
      // `toLowerCase()` en JS et `lower()` en SQL ne donnent pas le même résultat sur
      // tout l'Unicode (review : JS transforme 'İ' en 'i' + point combinant, Postgres
      // en simple 'i' -> le pseudo 'İpek' devenait introuvable). Une seule implémentation
      // des deux côtés de la comparaison = aucune divergence possible.
      const pattern = `${escapeLike(q)}%`;
      const me = request.user.sub;

      // Sans `type`, on interroge les deux sources ; avec, une seule.
      const wantUsers = type !== 'team';
      const wantTeams = type !== 'user';

      const usersSource = db
        .select({
          kind: sql<'user' | 'team'>`'user'::text`.as('kind'),
          id: sql<string>`${usersTable.id}`.as('id'),
          sortKey: sql<string>`lower(${usersTable.pseudo})`.as('sort_key'),
          label: sql<string>`${usersTable.pseudo}`.as('label'),
          displayName: sql<string | null>`${usersTable.displayName}`.as('display_name'),
          imageUrl: sql<string | null>`${usersTable.avatarUrl}`.as('image_url'),
          ladderId: sql<string | null>`null::uuid`.as('ladder_id'),
        })
        .from(usersTable)
        .where(
          and(
            sql`lower(${usersTable.pseudo}) like lower(${pattern})`,
            // Blocages exclus dans les DEUX sens. En `NOT EXISTS` corrélé plutôt qu'en
            // pré-requête : Postgres s'arrête à la première ligne trouvée et rien n'est
            // rapatrié dans Node (review : la pré-requête chargeait toutes mes relations
            // de blocage, sans borne).
            notExists(
              db
                .select({ one: sql`1` })
                .from(blocksTable)
                .where(
                  or(
                    and(eq(blocksTable.blockerId, me), eq(blocksTable.blockedId, usersTable.id)),
                    and(eq(blocksTable.blockedId, me), eq(blocksTable.blockerId, usersTable.id)),
                  ),
                ),
            ),
          ),
        );

      const teamsSource = db
        .select({
          kind: sql<'user' | 'team'>`'team'::text`.as('kind'),
          id: sql<string>`${teamsTable.id}`.as('id'),
          sortKey: sql<string>`lower(${teamsTable.name})`.as('sort_key'),
          label: sql<string>`${teamsTable.name}`.as('label'),
          displayName: sql<string | null>`null::text`.as('display_name'),
          imageUrl: sql<string | null>`${teamsTable.logoUrl}`.as('image_url'),
          ladderId: sql<string | null>`${teamsTable.ladderId}`.as('ladder_id'),
        })
        .from(teamsTable)
        .where(sql`lower(${teamsTable.name}) like lower(${pattern})`);

      // Tri sur les noms de colonnes de SORTIE (seule forme acceptée par un ORDER BY
      // qui porte sur un UNION). `kind` puis `id` départagent les ex æquo : sans cet
      // ordre TOTAL, deux lignes de même nom pourraient permuter entre deux appels et
      // la pagination par offset sauterait ou dupliquerait des résultats.
      //
      // 🚨 DEUX BRANCHES LITTÉRALES, PAS UNE INTERPOLATION. Un `sql\`sort_key ${dir}\``
      // marcherait, mais une direction de tri ne peut PAS être un paramètre lié : elle
      // finit forcément concaténée dans le texte SQL. Écrire les deux ORDER BY en toutes
      // lettres rend l'injection structurellement impossible, sans rien devoir à la
      // validation Zod en amont.
      //
      // ⚠️ Seul `sort_key` s'inverse : les départageurs restent `asc` dans les deux sens.
      // Ils ne servent qu'à rendre l'ordre TOTAL (donc la pagination stable) ; les inverser
      // aussi serait tout aussi valable et n'apporterait rien de visible.
      const orderBy =
        order === 'desc'
          ? sql`sort_key desc, kind asc, id asc`
          : sql`sort_key asc, kind asc, id asc`;
      // On demande une ligne de plus que la page : sa seule présence dit « il reste
      // quelque chose après », sans avoir à faire un COUNT global.
      const fetchSize = limit + 1;

      let rows: SearchRow[];
      if (wantUsers && wantTeams) {
        rows = await unionAll(usersSource, teamsSource)
          .orderBy(orderBy)
          .limit(fetchSize)
          .offset(offset);
      } else if (wantUsers) {
        rows = await usersSource.orderBy(orderBy).limit(fetchSize).offset(offset);
      } else {
        rows = await teamsSource.orderBy(orderBy).limit(fetchSize).offset(offset);
      }

      const hasMore = rows.length > limit;
      const results: SearchResult[] = rows.slice(0, limit).map((row) =>
        row.kind === 'user'
          ? {
              type: 'user' as const,
              id: row.id,
              pseudo: row.label,
              displayName: row.displayName,
              avatarUrl: row.imageUrl,
            }
          : {
              type: 'team' as const,
              id: row.id,
              name: row.label,
              logoUrl: row.imageUrl,
              // `teams.ladder_id` est NOT NULL : le `| null` du type ne vient que de
              // la branche user du UNION (`null::uuid`), jamais des données.
              ladderId: row.ladderId as string,
            },
      );

      return reply.code(200).send({ results, hasMore });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
};
