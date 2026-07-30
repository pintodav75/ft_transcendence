import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import {
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  laddersTable,
  gamesTable,
  teamsTable,
  teamMembersTable,
  gameMapsTable,
  userExternalAccountsTable,
  usersTable,
  disputesTable,
  formatEnum,
} from '../db/schema.js';
import {
  eq,
  and,
  ne,
  or,
  gt,
  lt,
  gte,
  inArray,
  notInArray,
  sql,
  asc,
  desc,
  type SQL,
} from 'drizzle-orm';
import z from 'zod';
// Même type TS que le `competitor` de GET /ladders/:id/rankings : l'adversaire d'une ligne
// d'historique est polymorphe (joueur en 1v1, équipe en 2v2+) et le front n'a donc qu'un
// seul discriminant `type` à gérer des deux côtés.
// ⚠️ Les deux SCHÉMAS OpenAPI, eux, ne sont pas encore identiques : les rankings ne
// déclarent que `[type, id, pseudo]` / `[type, id, name]` en `required`, ici on déclare les
// 4/3 champs (ce que le handler émet vraiment). Un type généré d'ici est donc assignable
// vers celui des rankings, pas l'inverse. À unifier par un `$ref` partagé le jour où un
// composant front consomme les deux — c'est le YAML des rankings qui est sous-spécifié.
import type { Competitor } from '../utils/leaderboard.js';
import { completeMatchWithElo } from '../utils/rankings.js';
import { WINS_REQUIRED } from '../utils/elo.js';
import {
  notify,
  pushNotifications,
  getAdminIds,
  type CreatedNotification,
} from '../utils/notifications.js';
import { ENGAGING_STATUSES, LOCKING_STATUSES } from '../utils/match-status.js';

// ⚠️ `LOCKING_STATUSES` et `ENGAGING_STATUSES` vivent dans `utils/match-status.ts` depuis
// BX-DEL : `routes/users.ts` doit refuser une suppression de compte sur exactement les mêmes
// matchs que ceux qui bloquent un créneau ici.

// Les slots ne peuvent tomber que sur un quart fixe : :00, :15, :30, :45.
const SLOT_GRID_MINUTES = 15;

// Il faut au moins ce délai avant l'heure du match — pour créer ET pour accepter.
// Un slot qui passe sous cette barre est périmé : plus personne ne peut l'accepter.
const MIN_LEAD_MINUTES = 15;

// Anti-spam : rien n'empêcherait une team d'ouvrir 50 slots pour saturer le tableau.
const MAX_OPEN_SLOTS = 5;

type Ladder = typeof laddersTable.$inferSelect;
type Game = typeof gamesTable.$inferSelect;

// ===== Règles de temps et de format, en UN seul exemplaire =====
//
// 🔑 Ces trois helpers ne sont pas de la cosmétique. Depuis [B-MM], `GET /matches` rend un
// verdict `canAccept` qui doit annoncer EXACTEMENT ce que `POST /matches/:id/accept` fera.
// Deux vérités qui divergent, c'est un bouton offert par l'UI puis refusé par l'API : une
// ligne rouge dans la console Chrome, donc un motif de rejet du projet. Les règles
// partagées vivent donc ici, et les deux chemins les LISENT au lieu de les recopier.

/**
 * L'instant à partir duquel un créneau est encore acceptable.
 *
 * Un slot `pending` sous MIN_LEAD_MINUTES de son PROPRE coup d'envoi est périmé : plus
 * personne ne peut l'accepter. `cancelExpiredSlots` finira par le passer à `cancelled`,
 * mais il tourne périodiquement — entre deux passages c'est cette borne qui fait foi.
 */
function acceptableFrom(): Date {
  return new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000);
}

/**
 * La fenêtre qu'un match occupe : `]scheduledAt − lockout, scheduledAt + lockout[`.
 *
 * ⚠️ Les bornes s'emploient en inégalités STRICTES (invariant repo #3) : deux matchs qui
 * se TOUCHENT (21h–22h puis 22h–23h) ne se chevauchent pas — l'enchaînement dos à dos est
 * le cas d'usage n°1 (« je planifie ma soirée »). Écrire `>=`/`<=` casserait la feature.
 */
function overlapWindow(scheduledAt: Date, lockoutMinutes: number): { start: Date; end: Date } {
  const lockoutMs = lockoutMinutes * 60 * 1000;
  return {
    start: new Date(scheduledAt.getTime() - lockoutMs),
    end: new Date(scheduledAt.getTime() + lockoutMs),
  };
}

/** Nombre de joueurs qu'un format impose d'aligner (`'5v5'` → 5). */
function formatSize(format: Ladder['format']): number {
  return parseInt(format, 10);
}

// `db` ou le `tx` d'une transaction : les deux exposent la même API de requête.
// Indispensable — les checks de disponibilité DOIVENT pouvoir tourner à l'intérieur
// d'une transaction (sinon ils lisent un instantané pris avant le verrou).
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * §5.2 — ce camp a-t-il déjà un match dont la FENÊTRE chevauche celle-ci ?
 *
 * Chaque match occupe [scheduled_at, scheduled_at + lockout_minutes]. Plutôt que de
 * comparer des intervalles, on retourne la question : un match me gêne si SON heure
 * tombe strictement dans ]mon_heure − lockout, mon_heure + lockout[.
 * Les deux bornes sont calculées EN JS → deux simples comparaisons colonne/valeur,
 * aucun SQL brut, et l'index (status, scheduled_at) est utilisé.
 *
 * ⚠️ INÉGALITÉS STRICTES (gt/lt, jamais gte/lte) : deux matchs qui se TOUCHENT
 * (21h–22h puis 22h–23h) ne se chevauchent PAS → l'enchaînement dos à dos est autorisé.
 * C'est le cas d'usage n°1 du ticket (« je planifie ma soirée »). Écrire gte/lte
 * casserait la feature.
 *
 * Remplace hasOpenSlot() + isLockedOut() : une seule question, posée à la création
 * ET à l'accept.
 *
 * ⚠️ PORTÉE : le « camp » est PAR LADDER, pas par personne (décision du 14/07).
 *   • 2v2+ → la TEAM (elle n'appartient qu'à un seul ladder)
 *   • 1v1  → le couple (JOUEUR, LADDER) — d'où le filtre eq(ladderId) dans la branche solo
 * Conséquence ASSUMÉE : un joueur peut avoir un match d'échecs ET un match Rocket League
 * à 21h. Un joueur aligné dans deux teams sur deux ladders peut être engagé deux fois.
 * CE N'EST PAS UN BUG — ne « corrigez » pas en retirant le filtre ladder.
 * Raison : la plateforme n'observe pas les parties ; l'absence se règle par dispute →
 * forfait ; et c'est une responsabilité humaine (le capitaine engage sa team en connaissance
 * de cause — si son joueur ne vient pas, c'est SA team qui perd). Cf. docs/schema.md §5.2.
 *
 * ⚠️ `statuses` DIFFÈRE selon l'appelant, et c'est essentiel :
 *   • CRÉATION → ENGAGING_STATUSES (pending + actifs). Je ne peux pas PROPOSER deux
 *     créneaux qui se chevauchent : si les deux slots étaient acceptés, je jouerais
 *     deux matchs à la fois.
 *   • ACCEPT   → LOCKING_STATUSES (actifs SEULEMENT). Mes slots `pending` qui
 *     chevauchent ne doivent PAS me bloquer : ce ne sont que des propositions, et
 *     l'option A (plus bas dans la transaction) va justement les RETIRER quand je
 *     m'engage pour de bon. Les compter ici reviendrait à me refuser un match à cause
 *     d'une offre que je m'apprête à annuler.
 *     La course « on accepte mon slot pendant que j'accepte le sien » reste couverte :
 *     le verrou sérialise, et la relecture sous verrou voit le match devenu ACTIF.
 */
async function hasConflictingMatch(
  executor: Executor,
  ladder: Ladder,
  teamId: string | null,
  userId: string,
  scheduledAt: Date,
  statuses: readonly ('pending' | 'in_progress' | 'awaiting_confirmation' | 'disputed')[],
  excludeMatchId?: string,
): Promise<boolean> {
  const { start: windowStart, end: windowEnd } = overlapWindow(scheduledAt, ladder.lockoutMinutes);

  // Un slot `pending` dont l'heure approche à moins de MIN_LEAD_MINUTES est PÉRIMÉ :
  // plus personne ne peut l'accepter, il ne doit donc plus bloquer son propre créateur.
  const stillAcceptable = acceptableFrom();

  const conditions = [
    inArray(matchesTable.status, [...statuses]),
    gt(matchesTable.scheduledAt, windowStart),
    lt(matchesTable.scheduledAt, windowEnd),
    // « soit ce n'est pas un slot ouvert (donc un match actif : il compte toujours),
    //   soit c'est un slot ouvert encore acceptable »
    or(ne(matchesTable.status, 'pending'), gte(matchesTable.scheduledAt, stillAcceptable)),
  ];
  // À l'accept, le match qu'on accepte est DÉJÀ en base à cette heure exacte :
  // sans cette exclusion, il se déclarerait en conflit avec lui-même.
  if (excludeMatchId) conditions.push(ne(matchesTable.id, excludeMatchId));

  if (teamId) {
    // Une team n'appartient qu'à un seul ladder → pas besoin de filtrer dessus.
    const [conflict] = await executor
      .select({ id: matchesTable.id })
      .from(matchSidesTable)
      .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
      .where(and(eq(matchSidesTable.teamId, teamId), ...conditions));
    return !!conflict;
  }

  const [conflict] = await executor
    .select({ id: matchesTable.id })
    .from(matchParticipantsTable)
    .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
    .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
    .where(
      and(
        eq(matchParticipantsTable.userId, userId),
        eq(matchesTable.ladderId, ladder.id),
        ...conditions,
      ),
    );
  return !!conflict;
}

/**
 * Combien de slots ENCORE OUVERTS (et non périmés) ce camp a-t-il sur ce ladder ?
 *
 * Sert au plafond anti-spam. Les slots périmés ne comptent pas : ils sont morts, ils
 * n'ont pas à consommer un des 5 emplacements de leur créateur.
 */
async function countOpenSlots(
  executor: Executor,
  ladder: Ladder,
  teamId: string | null,
  userId: string,
): Promise<number> {
  const stillAcceptable = acceptableFrom();
  const conditions = [
    eq(matchesTable.status, 'pending' as const),
    gte(matchesTable.scheduledAt, stillAcceptable),
  ];

  if (teamId) {
    const rows = await executor
      .select({ id: matchesTable.id })
      .from(matchSidesTable)
      .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
      .where(and(eq(matchSidesTable.teamId, teamId), ...conditions));
    return rows.length;
  }

  const rows = await executor
    .select({ id: matchesTable.id })
    .from(matchParticipantsTable)
    .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
    .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
    .where(
      and(
        eq(matchParticipantsTable.userId, userId),
        eq(matchesTable.ladderId, ladder.id),
        ...conditions,
      ),
    );
  return rows.length;
}

/** Identité d'un camp sur un ladder : la team en 2v2+, le couple joueur+ladder en 1v1. */
function competitorKey(ladder: Ladder, teamId: string | null, userId: string): string {
  return teamId ? `team:${teamId}` : `user:${userId}:${ladder.id}`;
}

/**
 * Sérialise les engagements des camps concernés, dans un ORDRE DÉTERMINISTE.
 *
 * Deux problèmes, une seule solution.
 *
 * 1) Sans verrou du tout : deux accepts simultanés du même camp sur DEUX matchs
 *    différents passent tous les deux (chacun lit le lockout avant que l'autre
 *    n'ait commité, et l'update conditionnel ne les sérialise pas — lignes
 *    distinctes) → deux matchs actifs → §5.2 contourné.
 *
 * 2) Sans ORDRE : alice accepte le slot de bob pendant que bob accepte celui
 *    d'alice. Chaque transaction ne verrouillait que SON accepteur → clés
 *    différentes, aucune sérialisation. Puis chacune verrouille la ligne du match
 *    qu'elle démarre et réclame celle de l'autre (l'annulation croisée des slots
 *    ouverts) → T1 tient B et veut A, T2 tient A et veut B → **INTERBLOCAGE**.
 *    Postgres en tue une : 500 sur un conflit métier parfaitement normal.
 *
 * Le tri règle (2) : les deux transactions demandent les MÊMES verrous dans le
 * MÊME ordre, donc l'une attend l'autre au lieu de se mordre la queue. C'est le
 * remède canonique au deadlock — l'acquisition ordonnée des ressources.
 *
 * Les verrous sont *transactionnels* : Postgres les relâche seul au COMMIT/ROLLBACK.
 * Une collision de hachage ne ferait que sérialiser deux camps sans lien — inoffensif.
 */
async function lockCompetitors(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  keys: string[],
): Promise<void> {
  // Set = dédoublonne (un camp ne se verrouille pas deux fois) ; sort = l'ordre commun.
  for (const key of [...new Set(keys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

// Verdict du helper : soit le côté est valide et on sait à quoi il ressemble,
// soit il est refusé et on sait quoi répondre. Le helper n'a pas accès à `reply` :
// il rend un verdict, c'est la route qui le traduit en réponse HTTP.
type SideValidation =
  | { ok: true; sideTeamId: string | null; participantIds: string[] }
  // unlinkedPlayers : optionnel, rempli seulement quand l'échec vient du §5.1 en team.
  // Le front sait alors QUI surligner, au lieu de deviner parmi les 5 sélectionnés.
  | { ok: false; code: number; error: string; unlinkedPlayers?: string[] };

/**
 * Valide qu'un joueur peut engager un côté sur ce ladder, et décrit ce côté.
 *
 * Appelé DEUX fois : à la création du slot (side 0) et à l'acceptation (side 1).
 * C'est tout l'intérêt : les deux camps d'un match sont validés à l'identique.
 *
 * ⚠️ Il ne dit RIEN du créneau. « Suis-je libre à cette heure ? » est une autre
 * question — c'est hasConflictingMatch(), appelé par les routes. validateSide valide
 * le CÔTÉ (qui joue), pas l'HORAIRE (quand).
 */
async function validateSide(
  ladder: Ladder,
  game: Game,
  me: string,
  lineup: string[] | undefined,
): Promise<SideValidation> {
  // ---- SOLO (1v1) : le joueur EST le côté, pas de team, pas de lineup ----
  if (ladder.format === '1v1') {
    // §5.1 — j'ai un compte lié pour le provider du jeu
    const [linked] = await db
      .select({ userId: userExternalAccountsTable.userId })
      .from(userExternalAccountsTable)
      .where(
        and(
          eq(userExternalAccountsTable.userId, me),
          eq(userExternalAccountsTable.provider, game.requiredProvider),
        ),
      );
    if (!linked)
      return {
        ok: false,
        code: 400,
        error: `you must have a linked ${game.requiredProvider} account`,
      };

    return { ok: true, sideTeamId: null, participantIds: [me] };
  }

  // ---- TEAM (2v2+) : le capitaine engage sa team avec une lineup ----
  if (!lineup) return { ok: false, code: 400, error: 'lineup is required for team matches' };

  // ma team sur ce ladder + garde capitaine
  const [membership] = await db
    .select()
    .from(teamMembersTable)
    .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
    .where(and(eq(teamMembersTable.userId, me), eq(teamMembersTable.ladderId, ladder.id)));
  if (!membership) return { ok: false, code: 400, error: 'you have no team on this ladder' };

  const team = membership.teams;
  if (team.captainId !== me)
    return { ok: false, code: 403, error: 'only the captain can engage the team' };

  // lineup = exactement format_size joueurs
  const size = formatSize(ladder.format);
  if (lineup.length !== size)
    return { ok: false, code: 400, error: `lineup must contain exactly ${size} players` };

  // lineup ⊆ roster
  const members = await db
    .select({ userId: teamMembersTable.userId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, team.id));
  const memberIds = new Set(members.map((m) => m.userId));
  if (!lineup.every((id) => memberIds.has(id)))
    return { ok: false, code: 400, error: 'every selected player must be on the team' };

  // §5.1 — chaque joueur de la lineup a un compte lié
  const linked = await db
    .select({ userId: userExternalAccountsTable.userId })
    .from(userExternalAccountsTable)
    .where(
      and(
        inArray(userExternalAccountsTable.userId, lineup),
        eq(userExternalAccountsTable.provider, game.requiredProvider),
      ),
    );
  const linkedIds = new Set(linked.map((l) => l.userId));
  const unlinkedPlayers = lineup.filter((id) => !linkedIds.has(id));
  if (unlinkedPlayers.length)
    return {
      ok: false,
      code: 400,
      error: `every selected player must have a linked ${game.requiredProvider} account`,
      unlinkedPlayers,
    };

  return { ok: true, sideTeamId: team.id, participantIds: lineup };
}

const createMatchSchema = z.object({
  ladderId: z.uuid(),
  scheduledAt: z.coerce
    .date()
    .refine(
      (date) =>
        date.getUTCMinutes() % SLOT_GRID_MINUTES === 0 &&
        date.getUTCSeconds() === 0 &&
        date.getUTCMilliseconds() === 0,
      { message: `scheduledAt must be on a ${SLOT_GRID_MINUTES}-minute slot (:00, :15, :30, :45)` },
    )
    .refine((date) => date.getTime() - Date.now() >= MIN_LEAD_MINUTES * 60 * 1000, {
      message: `scheduledAt must be at least ${MIN_LEAD_MINUTES} minutes from now`,
    }),
  // lineup : requise pour les ladders d'équipe (2v2+), ignorée en 1v1 (solo = le créateur)
  lineup: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'lineup must not contain duplicate players',
    })
    .optional(),
});

const acceptMatchSchema = createMatchSchema.pick({ lineup: true });

/**
 * [B-MM] Pourquoi je ne peux PAS accepter ce créneau. **Enum FERMÉ** : le front en fait des
 * libellés, une 6ᵉ valeur inattendue afficherait un vide silencieux.
 *
 * 🔑 L'ordre d'évaluation reproduit celui de `POST /matches/:id/accept` — d'abord le CÔTÉ
 * (`validateSide` : qui joue), puis le CRÉNEAU (`hasConflictingMatch` : quand) :
 *   • 1v1  → `account_not_linked` puis `schedule_conflict`
 *   • 2v2+ → `no_team`, `not_captain`, `roster_too_small`, `roster_not_linked` puis
 *     `schedule_conflict`
 * Un seul code est rendu : le PREMIER qui tombe, celui que l'API opposerait réellement.
 *
 * ⚠️ Pas de code pour « c'est mon propre créneau » : ces slots restent **exclus** de la
 * liste (comportement d'origine), ils n'ont donc jamais de verdict à rendre.
 *
 * 🔑 **`roster_too_small` et `roster_not_linked` sont DEUX codes et pas un** (ajout après
 * review). Les fusionner rendait `canAccept` juste mais la CAUSE fausse : une équipe d'un
 * seul membre au Steam lié s'entendait dire « vos joueurs doivent lier leur compte » alors
 * qu'il lui manquait 4 joueurs, et l'accept répondait, lui, `lineup must contain exactly 5
 * players`. La page front fait porter à la raison le lien qui la résout : « inviter des
 * joueurs » et « faire lier les comptes » sont deux remèdes différents, donc deux liens
 * différents. Le libellé neutre aurait supprimé le symptôme, pas la cause.
 */
const SLOT_REFUSAL_REASONS = [
  // 1v1 · §5.1 — je n'ai pas de compte lié pour le provider du jeu.
  'account_not_linked',
  // 2v2+ — je n'ai aucune équipe sur ce ladder.
  'no_team',
  // 2v2+ — j'ai une équipe mais je n'en suis pas capitaine : seul lui l'engage.
  'not_captain',
  // 2v2+ — mon roster compte moins de `format_size` joueurs : je ne peux même pas
  // constituer une lineup de la bonne TAILLE. Le remède est de recruter.
  'roster_too_small',
  // 2v2+ · §5.1 — le roster est assez grand, mais moins de `format_size` de ses membres
  // ont le compte lié qu'exige le jeu. Le remède est de faire lier les comptes.
  'roster_not_linked',
  // §5.2 — j'ai déjà un match ACTIF dont la fenêtre chevauche celle du créneau.
  'schedule_conflict',
] as const;
type SlotRefusalReason = (typeof SLOT_REFUSAL_REASONS)[number];

// Le `limit` borne la liste RENDUE (donc après le filtre `acceptable`), pas le balayage.
const DEFAULT_SLOT_LIMIT = 50;
const MAX_SLOT_LIMIT = 100;

/**
 * Un paramètre présent mais VIDE vaut « absent ».
 *
 * 🔑 Sans ça, un front qui construit son URL depuis l'état d'un filtre non renseigné
 * (`?gameId=${filtre}`) envoie `?gameId=` et reçoit un **400** — donc une ligne rouge dans
 * la console Chrome, qui est un **motif de rejet du projet**. C'est le cas d'usage NORMAL
 * d'une page de filtres, pas un abus d'appelant : il ne doit pas coûter une erreur.
 *
 * ⚠️ Ne relâche RIEN d'autre : une valeur réellement invalide (`?acceptable=1`,
 * `?limit=abc`, `?ladderId=nope`) continue de sortir en 400. Seule la chaîne vide,
 * indistinguable d'un paramètre omis côté navigateur, est neutralisée.
 */
const blankAsAbsent = (v: unknown): unknown => (v === '' ? undefined : v);

/**
 * [B-MM] `GET /matches` — **tous** les filtres sont optionnels.
 *
 * ⚠️ `ladderId` n'est plus requis : sans lui la route balaie TOUS les ladders. C'est le
 * mode d'emploi de la page « Matchmaking » — on choisit un créneau avant de choisir un
 * ladder. Avec lui, le comportement d'origine est strictement inchangé, 404 compris.
 */
const openSlotsQuerySchema = z.object({
  ladderId: z.preprocess(blankAsAbsent, z.uuid().optional()),
  // Slug TEXTE (`cs2`, `val`…), pas un uuid : `games.id` est un `text` choisi à la main.
  // Filtre PUR, comme `GET /ladders?gameId=` : un slug inconnu rend une liste vide et non
  // un 404 — il désigne un critère de tri, pas la ressource adressée par la requête.
  gameId: z.preprocess(blankAsAbsent, z.string().min(1).max(50).optional()),
  // Dérivé du schéma : ajouter un format en base sans le proposer ici casserait la
  // compilation, au lieu de laisser passer un filtre silencieusement mort.
  format: z.preprocess(blankAsAbsent, z.enum(formatEnum.enumValues).optional()),
  // ⚠️ JAMAIS `z.coerce.boolean()` ici : en JS toute chaîne non vide est vraie, donc
  // `?acceptable=false` filtrerait comme `true`. L'enum rend un 400 sur tout le reste.
  acceptable: z.preprocess(
    blankAsAbsent,
    z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  ),
  limit: z.preprocess(
    blankAsAbsent,
    z.coerce.number().int().min(1).max(MAX_SLOT_LIMIT).default(DEFAULT_SLOT_LIMIT),
  ),
});
// GET /matches/me : filtre facultatif par ladder. `optional()` et non `default()` — absent
// signifie « tous les ladders », et une valeur présente mais malformée doit sortir en 400.
const myMatchesQuerySchema = z.object({ ladderId: z.uuid().optional() });
const idParamSchema = z.object({ id: z.uuid() });
// Bo3 (décision produit, WINS_REQUIRED = 2) : les scores soumis sont RELATIFS AU
// SOUMETTEUR (« moi / lui »), délibérément pas indexés sur sideIndex — la comparaison
// croisée avec l'autre soumission (voir plus bas) devient triviale.
const resultBodySchema = z.object({
  winnerSideId: z.uuid(),
  scoreSelf: z.number().int().min(0).max(WINS_REQUIRED),
  scoreOpponent: z.number().int().min(0).max(WINS_REQUIRED),
});

export const matchesRoutes: FastifyPluginAsync = async (server) => {
  // POST /matches — ouvrir un slot (team pour 2v2+, solo pour 1v1).
  server.post('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      const data = createMatchSchema.parse(request.body);
      const me = request.user.sub;

      const [ladder] = await db
        .select()
        .from(laddersTable)
        .where(eq(laddersTable.id, data.ladderId));
      if (!ladder) return reply.code(404).send({ error: 'ladder not found' });
      const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, ladder.gameId));
      if (!game) return reply.code(404).send({ error: 'game not found' });

      // Validation du côté créateur : §5.1 compte lié, lineup, capitaine, §5.2 lockout.
      // Le MÊME helper servira à l'accept → les deux camps validés à l'identique.
      const side = await validateSide(ladder, game, me, data.lineup);
      if (!side.ok) {
        // on transmet unlinkedPlayers seulement s'il est là (échec §5.1 en team)
        const body: { error: string; unlinkedPlayers?: string[] } = { error: side.error };
        if (side.unlinkedPlayers) body.unlinkedPlayers = side.unlinkedPlayers;
        return reply.code(side.code).send(body);
      }
      const { sideTeamId, participantIds } = side;

      // §5.2 — suis-je déjà pris à cette heure ? Un slot ouvert m'engage autant qu'un
      // match actif : les deux occupent le créneau. (Ce check ne valide pas le CÔTÉ,
      // il valide le CRÉNEAU → il ne peut pas vivre dans validateSide.)
      // ⚠️ Chemin RAPIDE : la vérification qui fait autorité est refaite dans la
      // transaction, sous verrou (sinon 2 POST simultanés passent tous les deux — TOCTOU).
      if (
        await hasConflictingMatch(db, ladder, sideTeamId, me, data.scheduledAt, ENGAGING_STATUSES)
      )
        return reply.code(409).send({
          error: sideTeamId
            ? 'your team already has a match around that time'
            : 'you already have a match around that time',
        });

      // Plafond anti-spam (chemin rapide, revérifié sous verrou).
      if ((await countOpenSlots(db, ladder, sideTeamId, me)) >= MAX_OPEN_SLOTS)
        return reply
          .code(409)
          .send({ error: `you cannot have more than ${MAX_OPEN_SLOTS} open slots on a ladder` });

      // tirage de 3 maps distinctes si le jeu a un pool, sinon []
      const drawn = await db
        .select({ name: gameMapsTable.name })
        .from(gameMapsTable)
        .where(eq(gameMapsTable.gameId, ladder.gameId))
        .orderBy(sql`random()`)
        .limit(3);
      const maps = drawn.map((m) => m.name);

      const created = await db.transaction(async (tx) => {
        // VERROU sur le créateur : deux POST simultanés du même camp se sérialisent ici.
        // Sans lui, les deux passent le check ci-dessus (aucun n'a encore commité) et
        // créent chacun un slot → 2 slots ouverts, invariant « un seul » violé.
        // Un seul camp est en jeu ici (on ouvre, on n'affronte encore personne).
        await lockCompetitors(tx, [competitorKey(ladder, sideTeamId, me)]);

        // Relectures SOUS le verrou — ce sont CELLES-CI qui font autorité. Un POST ou un
        // accept concurrent a pu m'engager sur ce créneau entre-temps.
        if (
          await hasConflictingMatch(tx, ladder, sideTeamId, me, data.scheduledAt, ENGAGING_STATUSES)
        )
          return { raced: 'conflict' } as const;
        if ((await countOpenSlots(tx, ladder, sideTeamId, me)) >= MAX_OPEN_SLOTS)
          return { raced: 'too_many' } as const;

        const [createdMatch] = await tx
          .insert(matchesTable)
          .values({ ladderId: data.ladderId, scheduledAt: data.scheduledAt, maps })
          .returning();
        if (!createdMatch) throw new Error('match insert returned no row');
        const [createdSide] = await tx
          .insert(matchSidesTable)
          .values({ matchId: createdMatch.id, sideIndex: 0, teamId: sideTeamId })
          .returning();
        if (!createdSide) throw new Error('match side insert returned no row');
        await tx
          .insert(matchParticipantsTable)
          .values(participantIds.map((userId) => ({ matchSideId: createdSide.id, userId })));
        return { raced: null, match: createdMatch } as const;
      });

      if (created.raced === 'conflict')
        return reply.code(409).send({
          error: sideTeamId
            ? 'your team already has a match around that time'
            : 'you already have a match around that time',
        });
      if (created.raced === 'too_many')
        return reply
          .code(409)
          .send({ error: `you cannot have more than ${MAX_OPEN_SLOTS} open slots on a ladder` });

      return reply.code(201).send({ match: created.match });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // GET /matches — les créneaux ouverts, sur UN ladder (`?ladderId=`) ou sur TOUS (B-MM).
  //
  // Anonymat CONSERVÉ (décision B5b) : ni la team créatrice, ni les maps. On accepte un
  // créneau sans savoir qui l'a ouvert — c'est ce qui empêche de choisir ses adversaires
  // et protège l'intégrité de l'Elo.
  //
  // 🔑 NOMBRE DE REQUÊTES CONSTANT (7 au pire, 1 dans le cas vide), quel que soit le
  // nombre de créneaux ET de ladders. Le verdict `canAccept` est par-ladder et par-camp :
  // il est calculé EN LOT, en amont, jamais dans la boucle de mise en forme.
  server.get('/', { onRequest: [server.authenticate] }, async (request, reply) => {
    try {
      // Zod APRÈS `authenticate` (invariant repo #5) : anonyme → 401, malformé → 400.
      const query = openSlotsQuerySchema.parse(request.query);
      const me = request.user.sub;

      // ── 1. Les ladders du périmètre, avec l'identité de leur jeu ────────────────────
      // UNE requête jointe : `ladderName` et `gameName` sortent d'ici. Jamais un
      // aller-retour par créneau, jamais un par ladder.
      // ⚠️ `ladderId` PREND LA MAIN sur les autres filtres, et ce n'est pas un détail :
      // il DÉSIGNE une ressource, donc lui seul peut motiver un 404. Si on le mélangeait
      // aux filtres secondaires dans le même `where`, alors
      // `?ladderId=<chess>&format=5v5` ne rendrait aucune ligne et sortirait en
      // « ladder not found » — un MENSONGE : ce ladder existe, il ne satisfait
      // simplement pas les autres critères. La bonne réponse est 200 + liste vide.
      // ⚠️ Volontairement REDONDANT quand `ladderId` est absent : le `where` ci-dessous a
      // déjà appliqué ces deux filtres en SQL, ce prédicat est alors un no-op. On le garde
      // parce qu'il est le SEUL à s'appliquer dans l'autre branche — le factoriser
      // demanderait de faire dépendre le `where` du prédicat, pour zéro gain.
      const secondary = (l: { gameId: string; format: Ladder['format'] }): boolean =>
        (!query.gameId || l.gameId === query.gameId) && (!query.format || l.format === query.format);

      const ladderConditions: SQL[] = [];
      if (query.gameId) ladderConditions.push(eq(laddersTable.gameId, query.gameId));
      if (query.format) ladderConditions.push(eq(laddersTable.format, query.format));

      const ladderRows = await db
        .select({
          id: laddersTable.id,
          name: laddersTable.name,
          format: laddersTable.format,
          lockoutMinutes: laddersTable.lockoutMinutes,
          gameId: gamesTable.id,
          gameName: gamesTable.name,
          requiredProvider: gamesTable.requiredProvider,
        })
        .from(laddersTable)
        .innerJoin(gamesTable, eq(gamesTable.id, laddersTable.gameId))
        .where(
          query.ladderId
            ? eq(laddersTable.id, query.ladderId)
            : ladderConditions.length
              ? and(...ladderConditions)
              : undefined,
        );

      // Bien formé mais inconnu → 404 (contrat d'origine, gardé par `test_matches_create.py`).
      // Les autres filtres ne désignent rien → au pire une liste vide, jamais un 404. Même
      // arbitrage que `GET /ladders?gameId=`.
      if (query.ladderId && !ladderRows.length)
        return reply.code(404).send({ error: 'ladder not found' });

      // Les filtres secondaires s'appliquent ici quand `ladderId` a pris la main : ils
      // restreignent alors une liste d'AU PLUS une ligne — il n'y a rien à y optimiser.
      // Sans `ladderId`, le `where` les a déjà appliqués et ce filtre est un no-op.
      const scopedLadders = ladderRows.filter(secondary);
      if (!scopedLadders.length) return reply.code(200).send({ slots: [] });

      const ladderById = new Map(scopedLadders.map((l) => [l.id, l]));

      // ── 2. Mes équipes (au plus UNE par ladder : `team_members_user_ladder_unique`) ──
      const myTeams = await db
        .select({
          teamId: teamsTable.id,
          ladderId: teamsTable.ladderId,
          captainId: teamsTable.captainId,
        })
        .from(teamMembersTable)
        .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
        .where(eq(teamMembersTable.userId, me));
      const myTeamByLadder = new Map(myTeams.map((t) => [t.ladderId, t]));
      const myTeamIds = myTeams.map((t) => t.teamId);

      // ── 3. Mes engagements, DEUX sources, lues une fois pour toutes ─────────────────
      // Elles servent DEUX fois : à exclure mes propres créneaux, et à détecter le
      // chevauchement de fenêtres (§5.2). D'où la lecture en lot : une requête par
      // créneau serait le vrai piège de ce ticket.
      //
      // 🔑 Le découpage reproduit à la lettre celui de `hasConflictingMatch` ET la garde
      // d'auto-acceptation de `POST /matches/:id/accept` : en 2v2+ l'identité du camp est
      // l'ÉQUIPE (`match_sides.team_id`), en 1v1 c'est le couple (JOUEUR, LADDER)
      // (`match_participants` + filtre ladder).
      // ⚠️ D'où le `format = '1v1'` sur la source « participant », qui n'est PAS un
      // raccourci : un joueur qui a quitté l'équipe X garde sa ligne dans la compo d'un
      // slot encore ouvert de X, alors que l'accept l'autoriserait à le prendre au nom de
      // son équipe Y (la garde compare la team du slot à MA team ACTUELLE). Sans ce
      // filtre, ce créneau disparaîtrait de sa liste sans qu'aucune règle ne le demande.
      const asPlayer = await db
        .select({
          matchId: matchesTable.id,
          ladderId: matchesTable.ladderId,
          status: matchesTable.status,
          scheduledAt: matchesTable.scheduledAt,
        })
        .from(matchParticipantsTable)
        .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
        .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
        .innerJoin(laddersTable, eq(laddersTable.id, matchesTable.ladderId))
        .where(
          and(
            eq(matchParticipantsTable.userId, me),
            eq(laddersTable.format, '1v1'),
            inArray(matchesTable.status, [...ENGAGING_STATUSES]),
          ),
        );

      const asTeam = myTeamIds.length
        ? await db
            .select({
              matchId: matchesTable.id,
              teamId: matchSidesTable.teamId,
              status: matchesTable.status,
              scheduledAt: matchesTable.scheduledAt,
            })
            .from(matchSidesTable)
            .innerJoin(matchesTable, eq(matchesTable.id, matchSidesTable.matchId))
            .where(
              and(
                inArray(matchSidesTable.teamId, myTeamIds),
                inArray(matchesTable.status, [...ENGAGING_STATUSES]),
              ),
            )
        : [];

      // ── 4. Les créneaux ────────────────────────────────────────────────────────────
      const excludedIds = [...new Set([...asPlayer, ...asTeam].map((r) => r.matchId))];
      const slotConditions = [
        inArray(
          matchesTable.ladderId,
          scopedLadders.map((l) => l.id),
        ),
        eq(matchesTable.status, 'pending' as const),
        // Masquer les créneaux PÉRIMÉS : sous MIN_LEAD_MINUTES du coup d'envoi, plus
        // personne ne peut les accepter — ils n'ont plus rien à faire sur le tableau.
        gte(matchesTable.scheduledAt, acceptableFrom()),
      ];
      // ⚠️ La garde n'est pas cosmétique : `notInArray(x, [])` produit du SQL invalide.
      if (excludedIds.length) slotConditions.push(notInArray(matchesTable.id, excludedIds));

      const rows = await db
        .select({
          id: matchesTable.id,
          ladderId: matchesTable.ladderId,
          scheduledAt: matchesTable.scheduledAt,
        })
        .from(matchesTable)
        .where(and(...slotConditions))
        // ⚠️ `createdAt` DÉPARTAGE, il n'est pas décoratif : `scheduledAt` est contraint à
        // la grille des quarts d'heure, donc les ex æquo sont FRÉQUENTS. Sans second
        // critère l'ordre des égalités n'est garanti par rien — un simple UPDATE de statut
        // déplace le tuple dans le heap et peut permuter deux lignes entre deux appels
        // (leçon B-SOLO). L'ancienne version ne triait pas du tout.
        .orderBy(asc(matchesTable.scheduledAt), asc(matchesTable.createdAt));

      // Rien à montrer : on sort AVANT les 2 requêtes de verdict, qui n'auraient rien à
      // qualifier. Le cas « aucun créneau » coûte alors **5** requêtes (4 si l'appelant
      // n'a aucune équipe : `asTeam` n'est pas émise), contre 7 au plafond.
      if (!rows.length) return reply.code(200).send({ slots: [] });

      // ── 5. Le verdict, calculé PAR LADDER (jamais par créneau) ─────────────────────
      // Seuls les ladders réellement représentés dans la page sont interrogés.
      const presentLadders = [...new Set(rows.map((r) => r.ladderId))]
        .map((id) => ladderById.get(id))
        .filter((l): l is NonNullable<typeof l> => !!l);

      // §5.1 côté SOLO : mes providers liés. Une requête, quel que soit le nombre de jeux.
      const soloProviders = presentLadders.some((l) => l.format === '1v1')
        ? await db
            .select({ provider: userExternalAccountsTable.provider })
            .from(userExternalAccountsTable)
            .where(eq(userExternalAccountsTable.userId, me))
        : [];
      const myProviders = new Set(soloProviders.map((r) => r.provider));

      // §5.1 côté ÉQUIPE : pour chacune de mes équipes, la TAILLE du roster et combien de
      // ses membres ont le compte lié qu'exige le jeu de SON ladder. UNE requête agrégée
      // pour toutes mes équipes — pas une par équipe, encore moins une par créneau.
      //
      // 🔑 **LEFT JOIN, et deux compteurs distincts** (correction de review) : un INNER
      // JOIN ne remontait que les membres LIÉS, il était donc incapable de distinguer
      // « 1 membre, lié » de « 5 membres, 1 lié » — les deux rendaient `linked = 1` et la
      // même raison. `count(*)` compte les lignes du roster ; `count(<colonne jointe>)`
      // ignore les NULL, donc compte les seuls membres liés. Deux causes, deux remèdes,
      // aucune requête de plus.
      // 🔑 Pas de `distinct` : `user_external_accounts_user_provider_unique` interdit qu'un
      // joueur porte deux lignes pour le même provider, la jointure ne peut pas dupliquer.
      // On ne compte que les équipes que je CAPITAINE : ailleurs le verdict s'arrête avant
      // (`no_team` / `not_captain`) et le roster n'a aucune influence.
      const captainTeamIds = presentLadders
        .filter((l) => l.format !== '1v1')
        .map((l) => myTeamByLadder.get(l.id))
        .filter((t): t is NonNullable<typeof t> => !!t && t.captainId === me)
        .map((t) => t.teamId);

      const rosterRows = captainTeamIds.length
        ? await db
            .select({
              teamId: teamMembersTable.teamId,
              members: sql<number>`count(*)::int`,
              linked: sql<number>`count(${userExternalAccountsTable.userId})::int`,
            })
            .from(teamMembersTable)
            .innerJoin(teamsTable, eq(teamsTable.id, teamMembersTable.teamId))
            .innerJoin(laddersTable, eq(laddersTable.id, teamsTable.ladderId))
            .innerJoin(gamesTable, eq(gamesTable.id, laddersTable.gameId))
            .leftJoin(
              userExternalAccountsTable,
              and(
                eq(userExternalAccountsTable.userId, teamMembersTable.userId),
                eq(userExternalAccountsTable.provider, gamesTable.requiredProvider),
              ),
            )
            .where(inArray(teamMembersTable.teamId, captainTeamIds))
            .groupBy(teamMembersTable.teamId)
        : [];
      const rosterByTeam = new Map(rosterRows.map((r) => [r.teamId, r]));

      // Verdict du CÔTÉ (« qui joue »), figé une fois par ladder : il ne dépend pas de
      // l'heure. Seul le CRÉNEAU (« quand ») reste à trancher créneau par créneau.
      const sideVerdictByLadder = new Map<
        string,
        { reason: SlotRefusalReason | null; teamId: string | null }
      >();
      for (const ladder of presentLadders) {
        if (ladder.format === '1v1') {
          sideVerdictByLadder.set(ladder.id, {
            reason: myProviders.has(ladder.requiredProvider) ? null : 'account_not_linked',
            teamId: null,
          });
          continue;
        }
        const team = myTeamByLadder.get(ladder.id);
        if (!team) {
          sideVerdictByLadder.set(ladder.id, { reason: 'no_team', teamId: null });
          continue;
        }
        if (team.captainId !== me) {
          sideVerdictByLadder.set(ladder.id, { reason: 'not_captain', teamId: team.teamId });
          continue;
        }
        // Ordre calqué sur `validateSide` : elle refuse d'abord la TAILLE de la lineup
        // (`lineup must contain exactly N players`), et seulement ensuite les comptes non
        // liés. Un roster trop petit doit donc rendre `roster_too_small`, pas la raison
        // §5.1 — c'est ce que l'API opposerait vraiment.
        const roster = rosterByTeam.get(team.teamId);
        const size = formatSize(ladder.format);
        let reason: SlotRefusalReason | null = null;
        if ((roster?.members ?? 0) < size) reason = 'roster_too_small';
        else if ((roster?.linked ?? 0) < size) reason = 'roster_not_linked';
        sideVerdictByLadder.set(ladder.id, { reason, teamId: team.teamId });
      }

      // §5.2 — seuls les matchs ACTIFS verrouillent (LOCKING_STATUSES, comme à l'accept).
      // ⚠️ Mes propres slots `pending` qui chevauchent ne me bloquent PAS : l'accept les
      // annule (option A). Prendre ENGAGING_STATUSES ici annoncerait « conflit » sur un
      // créneau que l'API accepterait — exactement l'inverse du but de ce champ.
      const locking = new Set<string>(LOCKING_STATUSES);
      const myLockingSolo = asPlayer.filter((m) => locking.has(m.status));
      const myLockingTeam = asTeam.filter((m) => locking.has(m.status));

      const slots = [];
      for (const row of rows) {
        const ladder = ladderById.get(row.ladderId);
        const side = sideVerdictByLadder.get(row.ladderId);
        // Inatteignable (les créneaux sont filtrés sur ces mêmes ladders), mais une Map
        // rend `undefined` : on saute plutôt que d'affirmer par un `!`.
        if (!ladder || !side) continue;

        let reason: SlotRefusalReason | null = side.reason;
        if (!reason && row.scheduledAt) {
          const { start, end } = overlapWindow(row.scheduledAt, ladder.lockoutMinutes);
          // Inégalités STRICTES : cf. `overlapWindow`, le dos à dos reste autorisé.
          const overlaps = (at: Date | null): boolean =>
            !!at && at.getTime() > start.getTime() && at.getTime() < end.getTime();
          const busy =
            ladder.format === '1v1'
              ? myLockingSolo.some((m) => m.ladderId === ladder.id && overlaps(m.scheduledAt))
              : myLockingTeam.some((m) => m.teamId === side.teamId && overlaps(m.scheduledAt));
          if (busy) reason = 'schedule_conflict';
        }

        slots.push({
          id: row.id,
          // `ladderId` est AJOUTÉ (il n'était pas nécessaire tant que le client le
          // fournissait lui-même) : en balayage global c'est la seule façon de router vers
          // `/ladders/:id` et de savoir sur quel ladder on s'engage.
          ladderId: ladder.id,
          ladderName: ladder.name,
          gameId: ladder.gameId,
          gameName: ladder.gameName,
          format: ladder.format,
          scheduledAt: row.scheduledAt,
          canAccept: reason === null,
          reason,
        });
      }

      // Le filtre s'applique APRÈS le verdict, donc `limit` aussi : borner en SQL rendrait
      // moins de `limit` créneaux acceptables alors qu'il en reste d'autres, ce qui est un
      // faux « plus rien à jouer ». Le balayage reste borné par construction — seuls les
      // slots `pending` ET encore acceptables sont lus, et un camp ne peut en ouvrir que
      // MAX_OPEN_SLOTS. `acceptable=false` est le symétrique (« pourquoi ne puis-je pas ? »).
      const filtered =
        query.acceptable === undefined
          ? slots
          : slots.filter((s) => s.canAccept === query.acceptable);
      return reply.code(200).send({ slots: filtered.slice(0, query.limit) });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // GET /matches/:id — détail brut, réservé aux participants (membre d'une team engagée OU joueur solo).
  server.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const me = request.user.sub;
        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, id));
        if (!match) return reply.code(404).send({ error: 'match not found' });

        const sides = await db
          .select()
          .from(matchSidesTable)
          .where(eq(matchSidesTable.matchId, id));
        const sideIds = sides.map((s) => s.id);
        const participants = sideIds.length
          ? await db
              .select()
              .from(matchParticipantsTable)
              .where(inArray(matchParticipantsTable.matchSideId, sideIds))
          : [];

        // Tous les ids dont on aura besoin, collectés UNE fois : ils servent à la garde
        // ci-dessous ET aux deux requêtes d'enrichissement plus bas.
        const sideTeamIds = sides.map((s) => s.teamId).filter((t): t is string => t !== null);
        const userIds = participants.map((p) => p.userId);

        // garde : participant direct (solo) OU membre d'une team engagée (team)
        let allowed = participants.some((p) => p.userId === me);
        if (!allowed && sideTeamIds.length) {
          const [teamMember] = await db
            .select({ id: teamMembersTable.id })
            .from(teamMembersTable)
            .where(
              and(eq(teamMembersTable.userId, me), inArray(teamMembersTable.teamId, sideTeamIds)),
            );
          allowed = !!teamMember;
        }
        // Un tiers peut lire un match TERMINÉ (page match publique, FT-2) : la composition
        // nominative des deux camps devient publique une fois le match `completed`. Tout
        // autre statut (pending/in_progress/awaiting_confirmation/disputed/cancelled) reste
        // réservé aux participants.
        if (!allowed && match.status !== 'completed') {
          return reply.code(403).send({ error: 'not a participant of this match' });
        }

        // DEUX requêtes pour tout le monde, pas une par joueur (N+1) : on a déjà les ids.
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
        // Projection explicite : surtout PAS de select() nu, on enverrait email/passwordHash.
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

        // Identité du ladder ET de son jeu, en UNE requête jointe (jamais une par side) :
        // le front titre la page avec, et n'affiche la section « maps » que pour un jeu qui
        // en a un pool. `ladderId` reste exposé à côté — les appelants existants ne bougent pas.
        const [ladder] = await db
          .select({
            id: laddersTable.id,
            name: laddersTable.name,
            format: laddersTable.format,
            gameId: gamesTable.id,
            gameName: gamesTable.name,
          })
          .from(laddersTable)
          .innerJoin(gamesTable, eq(gamesTable.id, laddersTable.gameId))
          .where(eq(laddersTable.id, match.ladderId));
        // Impossible en pratique (`matches.ladder_id` est une FK `restrict`) : on préfère
        // un 500 explicite à un `ladder: null` que le front devrait gérer pour rien.
        if (!ladder) return reply.code(500).send({ error: 'Internal error' });

        // Index clé → valeur. `.get(id)` répond en temps constant → aucune requête
        // dans la boucle d'assemblage ci-dessous.
        const teamById = new Map(teams.map((t) => [t.id, t]));
        const playerById = new Map(players.map((p) => [p.id, p]));

        const shapedSides = sides
          .sort((a, b) => a.sideIndex - b.sideIndex)
          .map((s) => ({
            // id du side : c'est ce que le front renvoie comme `winnerSideId` à POST /result.
            id: s.id,
            sideIndex: s.sideIndex,
            // état de soumission (B6) : le front affiche « en attente de l'adversaire… »
            // et calcule le temps restant (submittedAt + 24 h) côté client.
            submittedAt: s.submittedAt,
            submittedWinnerSideId: s.submittedWinnerSideId,
            // Scores déclarés par CE camp, relatifs à lui-même (« moi / lui »). Sans eux le
            // front ne peut pas proposer « Confirmer » : confirmer, c'est renvoyer le MIROIR
            // exact de la soumission adverse (§5.4 — un score différent part en dispute).
            submittedScoreSelf: s.submittedScoreSelf,
            submittedScoreOpponent: s.submittedScoreOpponent,
            // Score final (manches gagnées, Bo3) et Elo de CE match — écrits seulement à la
            // clôture (`completed`), `null` avant. `score` reste `null` après un arbitrage
            // admin (il tranche un vainqueur, pas un score) ; `eloDelta`/`eloAfter` sont
            // écrits dans tous les cas où l'ELO s'applique.
            score: s.score,
            eloDelta: s.eloDelta,
            eloAfter: s.eloAfter,
            // solo : pas de team → null. Le front distingue les deux cas là-dessus.
            team: s.teamId ? (teamById.get(s.teamId) ?? null) : null,
            players: participants
              .filter((p) => p.matchSideId === s.id)
              .map((p) => playerById.get(p.userId))
              .filter((p): p is NonNullable<typeof p> => p !== undefined),
          }));

        // Quand le match est en dispute, exposer l'id de la dispute pour que le front
        // puisse naviguer vers GET /disputes/:id. null dans tous les autres états.
        let disputeId: string | null = null;
        if (match.status === 'disputed') {
          const [dispute] = await db
            .select({ id: disputesTable.id })
            .from(disputesTable)
            .where(eq(disputesTable.matchId, match.id));
          disputeId = dispute?.id ?? null;
        }

        return reply.code(200).send({
          match: {
            id: match.id,
            ladderId: match.ladderId,
            ladder,
            status: match.status,
            scheduledAt: match.scheduledAt,
            startedAt: match.startedAt,
            completedAt: match.completedAt,
            winnerSideId: match.winnerSideId,
            maps: match.maps,
            createdAt: match.createdAt,
            disputeId,
          },
          sides: shapedSides,
        });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const me = request.user.sub;
        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, id));
        if (!match) return reply.code(404).send({ error: 'match not found' });

        // ⚠️ L'AUTORISATION D'ABORD, le statut ensuite.
        // Répondre 200 (déjà annulé) ou 409 (déjà démarré) avant de vérifier qui appelle
        // donnerait à n'importe quel inconnu un ORACLE sur l'état d'un match : 404 =
        // n'existe pas, 200 = annulé, 409 = en cours. Ça contournerait le 403 qui protège
        // justement l'anonymat des slots dans GET /matches/:id.
        const [side0] = await db
          .select()
          .from(matchSidesTable)
          .where(and(eq(matchSidesTable.matchId, id), eq(matchSidesTable.sideIndex, 0)));
        if (!side0) return reply.code(500).send({ error: 'internal error' });
        if (side0.teamId !== null) {
          const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, side0.teamId));
          if (!team) return reply.code(500).send({ error: 'internal error' });
          if (team.captainId !== me)
            return reply.code(403).send({ error: 'Only team captain can cancel a pending game' });
        } else {
          const [participant] = await db
            .select()
            .from(matchParticipantsTable)
            .where(
              and(
                eq(matchParticipantsTable.matchSideId, side0.id),
                eq(matchParticipantsTable.userId, me),
              ),
            );
          if (!participant)
            return reply.code(403).send({ error: 'only the creator can cancel this match' });
        }

        // Le créateur est identifié : on peut maintenant parler de l'état du match.
        if (match.status === 'cancelled') return reply.code(200).send({ ok: true });
        if (match.status !== 'pending')
          return reply.code(409).send({ error: 'match already in progress or completed' });

        const [cancelled] = await db
          .update(matchesTable)
          .set({ status: 'cancelled' })
          .where(and(eq(matchesTable.id, id), eq(matchesTable.status, 'pending')))
          .returning();
        if (!cancelled) return reply.code(409).send({ error: 'match is no longer pending' });

        return reply.code(200).send({ ok: true });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  server.post<{ Params: { id: string } }>(
    '/:id/accept',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const { lineup } = acceptMatchSchema.parse(request.body ?? {});
        const me = request.user.sub;
        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, id));
        if (!match) return reply.code(404).send({ error: 'match not found' });
        if (match.status !== 'pending')
          return reply.code(409).send({ error: "match isn't pending" });

        // EXPIRATION — un slot n'est plus acceptable à moins de MIN_LEAD_MINUTES de son
        // heure. Le job d'expiration tourne à la minute : il existe donc une fenêtre où le
        // slot est déjà mort mais encore `pending` en base. Cette garde la ferme.
        // (Le `!match.scheduledAt` ne devrait jamais arriver — Zod l'impose à la création —
        //  mais la colonne est nullable, donc TypeScript exige qu'on le traite.)
        if (
          !match.scheduledAt ||
          match.scheduledAt.getTime() - Date.now() < MIN_LEAD_MINUTES * 60 * 1000
        )
          return reply.code(409).send({
            error: `slot is no longer acceptable (less than ${MIN_LEAD_MINUTES} min before kickoff)`,
          });

        // L'heure du match, capturée dans une const : le narrowing de `match.scheduledAt`
        // (Date | null → Date) ne survit pas à l'intérieur du callback de la transaction.
        const kickoff = match.scheduledAt;

        const [ladder] = await db
          .select()
          .from(laddersTable)
          .where(eq(laddersTable.id, match.ladderId));
        if (!ladder) return reply.code(404).send({ error: 'ladder not found' });
        const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, ladder.gameId));
        if (!game) return reply.code(404).send({ error: 'game not found' });
        const side = await validateSide(ladder, game, me, lineup);
        if (!side.ok) {
          // on transmet unlinkedPlayers seulement s'il est là (échec §5.1 en team)
          const body: { error: string; unlinkedPlayers?: string[] } = { error: side.error };
          if (side.unlinkedPlayers) body.unlinkedPlayers = side.unlinkedPlayers;
          return reply.code(side.code).send(body);
        }

        // Le side 0 = le côté du créateur. Il nous sert à refuser l'auto-acceptation.
        const [side0] = await db
          .select()
          .from(matchSidesTable)
          .where(and(eq(matchSidesTable.matchId, id), eq(matchSidesTable.sideIndex, 0)));
        if (!side0) return reply.code(500).send({ error: 'internal error' });

        // Les joueurs du side 0 : servent à la garde solo ci-dessous ET à l'option A.
        const side0Participants = await db
          .select({ userId: matchParticipantsTable.userId })
          .from(matchParticipantsTable)
          .where(eq(matchParticipantsTable.matchSideId, side0.id));

        if (side.sideTeamId !== null) {
          // Team : l'identité du côté EST la team. unique(user_id, ladder_id) garantit
          // qu'un joueur n'a qu'une team par ladder → cette seule comparaison suffit.
          if (side0.teamId === side.sideTeamId)
            return reply.code(400).send({ error: 'you cannot accept your own slot' });
        } else {
          // Solo : les deux sides ont team_id = NULL → comparer les teamId ne détecterait
          // rien (null === null). L'identité du côté, ici, c'est le JOUEUR.
          if (side0Participants.some((p) => p.userId === me))
            return reply.code(400).send({ error: 'you cannot accept your own slot' });
        }

        // §5.2 — l'ACCEPTEUR est-il libre sur ce créneau ? (chemin rapide ; la vérif qui
        // fait autorité est refaite sous verrou dans la transaction). On EXCLUT le match
        // lui-même : il est déjà en base à cette heure exacte, il se déclarerait en
        // conflit avec lui-même.
        if (
          await hasConflictingMatch(db, ladder, side.sideTeamId, me, kickoff, LOCKING_STATUSES, id)
        )
          return reply.code(409).send({
            error: side.sideTeamId
              ? 'your team already has a match around that time'
              : 'you already have a match around that time',
          });

        // Les DEUX camps du match, identifiés avant la transaction.
        // Il faut verrouiller les deux (pas seulement l'accepteur) : la transaction va
        // toucher les slots ouverts des deux côtés (option A, plus bas). Verrouiller un
        // seul camp laissait passer l'acceptation croisée → interblocage Postgres.
        const creatorUserId = side0Participants[0]?.userId;
        const lockKeys = [competitorKey(ladder, side.sideTeamId, me)];
        if (side0.teamId) lockKeys.push(competitorKey(ladder, side0.teamId, me));
        else if (creatorUserId) lockKeys.push(competitorKey(ladder, null, creatorUserId));

        // La fenêtre occupée par le match qu'on accepte. Sert à l'option A ci-dessous :
        // seuls les slots qui CHEVAUCHENT cette fenêtre doivent tomber.
        const { start: windowStart, end: windowEnd } = overlapWindow(
          kickoff,
          ladder.lockoutMinutes,
        );

        const accepted = await db.transaction(async (tx) => {
          // 0. VERROUS des deux camps, pris dans un ORDRE DÉTERMINISTE (tri des clés).
          //    L'ordre est ce qui empêche l'interblocage : deux accepts croisés (alice
          //    prend le slot de bob pendant que bob prend celui d'alice) demandent les
          //    MÊMES clés — triées, elles sont réclamées dans le même ordre, donc l'une
          //    attend l'autre au lieu de se bloquer mutuellement.
          await lockCompetitors(tx, lockKeys);

          // 1. §5.2 REVÉRIFIÉ sous le verrou — c'est CETTE lecture qui fait autorité.
          //    Le chemin rapide date d'avant le verrou : il a pu voir « libre » alors
          //    qu'un accept concurrent était en train d'occuper le créneau.
          if (
            await hasConflictingMatch(
              tx,
              ladder,
              side.sideTeamId,
              me,
              kickoff,
              LOCKING_STATUSES,
              id,
            )
          )
            return { raced: 'conflict' } as const;

          // 2. Update CONDITIONNEL : seul un match encore `pending` bascule. Si deux
          //    équipes acceptent LE MÊME match, la 2e ne touche aucune ligne → 409.
          //    started_at = maintenant : historique de l'acceptation seulement.
          //    Aucune règle ne le lit — la dispo §5.2 est pilotée par scheduled_at.
          const [updated] = await tx
            .update(matchesTable)
            .set({ status: 'in_progress', startedAt: new Date() })
            .where(and(eq(matchesTable.id, id), eq(matchesTable.status, 'pending')))
            .returning();
          if (!updated) return { raced: 'taken' } as const;

          // 3. Le side 1 (l'accepteur) + ses joueurs.
          const [createdSide] = await tx
            .insert(matchSidesTable)
            .values({ matchId: id, sideIndex: 1, teamId: side.sideTeamId })
            .returning();
          if (!createdSide) throw new Error('match side insert returned no row');
          await tx
            .insert(matchParticipantsTable)
            .values(side.participantIds.map((userId) => ({ matchSideId: createdSide.id, userId })));

          // B9 — « ton défi a été accepté » : les joueurs ALIGNÉS du camp créateur (side 0).
          // L'accepteur (l'acteur) n'y est jamais — la garde anti-auto-accept l'exclut du
          // side 0. Insert DANS la tx (un rollback ne doit pas notifier) ; push après commit.
          const notifs = await notify(
            tx,
            side0Participants.map((p) => p.userId),
            'match_accepted',
            { matchId: id, ladderId: match.ladderId, scheduledAt: kickoff.toISOString() },
          );

          // 4. Les deux camps sont maintenant ENGAGÉS sur ce CRÉNEAU : leurs slots ouverts
          //    qui CHEVAUCHENT cette fenêtre doivent tomber. Sinon une 3e équipe en
          //    accepterait un → deux matchs qui se recouvrent, §5.2 contourné.
          //
          //    ⚠️ On n'annule QUE ceux qui chevauchent — surtout PAS tous les slots ouverts.
          //    Une team qui a planifié 21h / 23h / 01h et se fait accepter celui de 21h doit
          //    GARDER ceux de 23h et 01h : ils ne se recouvrent pas. C'est tout l'objet de B5d.
          const overlapsWindow = [
            gt(matchesTable.scheduledAt, windowStart),
            lt(matchesTable.scheduledAt, windowEnd),
          ];

          if (side.sideTeamId !== null && side0.teamId !== null) {
            // Team : on annule par TEAM. Indispensable — annuler par joueur raterait
            // un slot ouvert avec une lineup disjointe de celle qu'on vient d'engager.
            const theirSlots = tx
              .select({ id: matchSidesTable.matchId })
              .from(matchSidesTable)
              .where(inArray(matchSidesTable.teamId, [side0.teamId, side.sideTeamId]));
            await tx
              .update(matchesTable)
              .set({ status: 'cancelled' })
              .where(
                and(
                  eq(matchesTable.status, 'pending'),
                  ne(matchesTable.id, id),
                  inArray(matchesTable.id, theirSlots),
                  ...overlapsWindow,
                ),
              );
          } else {
            // Solo : on annule par JOUEUR, et seulement sur CE ladder — mes slots ouverts
            // sur d'autres ladders ne me concernent pas.
            const userIds = [me, ...side0Participants.map((p) => p.userId)];
            const theirSlots = tx
              .select({ id: matchSidesTable.matchId })
              .from(matchParticipantsTable)
              .innerJoin(
                matchSidesTable,
                eq(matchSidesTable.id, matchParticipantsTable.matchSideId),
              )
              .where(inArray(matchParticipantsTable.userId, userIds));
            await tx
              .update(matchesTable)
              .set({ status: 'cancelled' })
              .where(
                and(
                  eq(matchesTable.status, 'pending'),
                  ne(matchesTable.id, id),
                  eq(matchesTable.ladderId, match.ladderId),
                  inArray(matchesTable.id, theirSlots),
                  ...overlapsWindow,
                ),
              );
          }

          return { raced: null, match: updated, notifs } as const;
        });

        // Deux courses distinctes, deux messages : « on m'a doublé sur CE match »
        // (update conditionnel) vs « je viens de m'engager ailleurs » (verrou §5.2).
        if (accepted.raced === 'taken')
          return reply.code(409).send({ error: 'match is no longer pending' });
        if (accepted.raced === 'conflict')
          return reply.code(409).send({
            error: side.sideTeamId
              ? 'your team already has a match around that time'
              : 'you already have a match around that time',
          });

        // Push WS APRÈS le commit — best-effort, ne peut pas faire échouer l'accept.
        pushNotifications(accepted.notifs);
        return reply.code(200).send({ match: accepted.match });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  // GET /matches/me — MES matchs, au gabarit de l'historique d'équipe (B-SOLO). 100 % lecture,
  // aucune transaction, aucun verrou. Nombre de requêtes CONSTANT (9 au pire) quel que soit le
  // nombre de matchs : une requête par table puis des `Map` d'index en mémoire — JAMAIS d'await
  // dans une boucle de `map`. Jumeau volontaire de `GET /teams/:id/matches` (`routes/teams.ts`).
  //
  // ⚠️ Rien n'est masqué ici (maps comprises) : ce sont MES matchs, contrairement à
  // `GET /matches?ladderId=` qui anonymise les créneaux ouverts d'inconnus.
  server.get<{ Querystring: { ladderId?: string } }>(
    '/me',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const me = request.user.sub;
        // Zod APRÈS `authenticate` (invariant repo) : anonyme → 401, malformé → 400.
        const { ladderId } = myMatchesQuerySchema.parse(request.query);

        // Deux sources, et on garde le SIDE de chacune (pas seulement le `matchId`) : sans
        // « mon camp » on ne sait dériver ni le score, ni le delta d'Elo, ni win/loss, ni
        // l'adversaire — c'est exactement l'information que l'ancienne version jetait.
        //   A. le side où je suis PARTICIPANT → mes solos + les matchs où j'étais ALIGNÉ ;
        //   B. le side d'une de MES ÉQUIPES   → y compris quand j'étais sur le BANC (un
        //      remplaçant n'a aucune ligne dans `match_participants` : sans cette seconde
        //      source il ne verrait pas les matchs de son équipe).
        const asPlayer = await db
          .select({ matchId: matchSidesTable.matchId, sideId: matchSidesTable.id })
          .from(matchParticipantsTable)
          .innerJoin(matchSidesTable, eq(matchSidesTable.id, matchParticipantsTable.matchSideId))
          .where(eq(matchParticipantsTable.userId, me));

        const myTeams = await db
          .select({ teamId: teamMembersTable.teamId })
          .from(teamMembersTable)
          .where(eq(teamMembersTable.userId, me));
        const teamIds = myTeams.map((t) => t.teamId);

        const asTeam = teamIds.length
          ? await db
              .select({ matchId: matchSidesTable.matchId, sideId: matchSidesTable.id })
              .from(matchSidesTable)
              .where(inArray(matchSidesTable.teamId, teamIds))
          : [];

        // Dédoublonnage ET choix du camp en une passe : B est posé d'abord, A écrase donc B.
        // Le side « participant » l'emporte parce qu'il dit où j'ai RÉELLEMENT joué, pas de
        // quelle équipe je porte le maillot aujourd'hui.
        // ⚠️ Ce n'est PAS un cas théorique : rien n'interdit de quitter une équipe engagée
        // (`DELETE /teams/:id/members/:userId` ne garde que le capitaine, contrairement à la
        // dissolution) puis de rejoindre l'équipe d'en face. Après un tel transfert, les deux
        // sources désignent des sides différents sur le même match, et `opponent` peut donc
        // être une de MES équipes actuelles — c'est voulu : j'ai bien joué contre elle.
        const mySideByMatch = new Map<string, string>();
        for (const row of asTeam) mySideByMatch.set(row.matchId, row.sideId);
        for (const row of asPlayer) mySideByMatch.set(row.matchId, row.sideId);
        const matchIds = [...mySideByMatch.keys()];
        if (!matchIds.length) return reply.code(200).send({ matches: [] });

        // `format` et `gameId` viennent d'une JOINTURE sur `ladders`, pas d'une requête de
        // plus. `winnerSideId` ne sert qu'à dériver `result` plus bas : jamais renvoyé brut.
        const matches = await db
          .select({
            id: matchesTable.id,
            ladderId: matchesTable.ladderId,
            gameId: laddersTable.gameId,
            format: laddersTable.format,
            status: matchesTable.status,
            scheduledAt: matchesTable.scheduledAt,
            startedAt: matchesTable.startedAt,
            completedAt: matchesTable.completedAt,
            maps: matchesTable.maps,
            winnerSideId: matchesTable.winnerSideId,
          })
          .from(matchesTable)
          .innerJoin(laddersTable, eq(laddersTable.id, matchesTable.ladderId))
          .where(
            ladderId
              ? and(inArray(matchesTable.id, matchIds), eq(matchesTable.ladderId, ladderId))
              : inArray(matchesTable.id, matchIds),
          )
          // `scheduledAt` est LA référence temporelle (invariant repo) et est NULLABLE en
          // base : Postgres remonte les NULL en tête d'un DESC sans `NULLS LAST` explicite.
          // ⚠️ `createdAt` DÉPARTAGE, il n'est pas décoratif : `scheduledAt` est contraint à
          // la grille des quarts d'heure, donc deux matchs à la même heure sur deux ladders
          // différents sont FRÉQUENTS. Sans second critère l'ordre des ex æquo n'est garanti
          // par rien — un simple UPDATE de statut déplace le tuple dans le heap et peut
          // permuter deux lignes entre deux refetch.
          .orderBy(sql`${matchesTable.scheduledAt} desc nulls last`, desc(matchesTable.createdAt));
        // Le filtre `ladderId` peut tout écarter — on sort avant d'émettre 5 requêtes vides.
        if (!matches.length) return reply.code(200).send({ matches: [] });
        const visibleIds = matches.map((m) => m.id);

        // Tous les sides des matchs retenus (les miens ET ceux d'en face) en UNE requête.
        const allSides = await db
          .select()
          .from(matchSidesTable)
          .where(inArray(matchSidesTable.matchId, visibleIds));
        const sideById = new Map(allSides.map((s) => [s.id, s]));
        const sidesByMatch = new Map<string, (typeof allSides)[number][]>();
        for (const s of allSides) {
          const list = sidesByMatch.get(s.matchId) ?? [];
          list.push(s);
          sidesByMatch.set(s.matchId, list);
        }

        // 🚨 « Le side adverse n'a pas de team_id » ne signifie PAS « joueur solo ».
        // `match_sides.team_id` est en ON DELETE SET NULL : une équipe dont tous les matchs
        // sont terminés peut être dissoute, et son camp survit avec `team_id = NULL` sur un
        // 5v5 `completed`. C'est le FORMAT DU LADDER qui tranche, jamais la nullité — lire
        // le NULL comme « solo » renommerait le camp d'après un joueur et effacerait la
        // composition (bug introduit puis corrigé côté front pendant FT-4A).
        const oppSideByMatch = new Map<string, (typeof allSides)[number] | undefined>();
        const opponentTeamIds = new Set<string>();
        const soloOppSideIds: string[] = [];
        for (const m of matches) {
          const mySideId = mySideByMatch.get(m.id);
          const oppSide = (sidesByMatch.get(m.id) ?? []).find((s) => s.id !== mySideId);
          oppSideByMatch.set(m.id, oppSide);
          if (!oppSide) continue;
          if (m.format === '1v1') soloOppSideIds.push(oppSide.id);
          else if (oppSide.teamId) opponentTeamIds.add(oppSide.teamId);
          // 2v2+ sans team_id = équipe dissoute → `opponent: null`, comme le fait déjà
          // `GET /teams/:id/matches`. Pas de troisième variante : le front sait replier.
        }

        const opponentTeams = opponentTeamIds.size
          ? await db
              .select({ id: teamsTable.id, name: teamsTable.name, logoUrl: teamsTable.logoUrl })
              .from(teamsTable)
              .where(inArray(teamsTable.id, [...opponentTeamIds]))
          : [];
        const teamById = new Map(opponentTeams.map((t) => [t.id, t]));

        // Adversaire d'un 1v1 : l'unique participant du side d'en face. Deux requêtes au
        // total (participants puis users), jamais une par match.
        const soloParticipants = soloOppSideIds.length
          ? await db
              .select({
                matchSideId: matchParticipantsTable.matchSideId,
                userId: matchParticipantsTable.userId,
              })
              .from(matchParticipantsTable)
              .where(inArray(matchParticipantsTable.matchSideId, soloOppSideIds))
          : [];
        const oppUserIdBySide = new Map<string, string>();
        for (const p of soloParticipants)
          if (!oppUserIdBySide.has(p.matchSideId)) oppUserIdBySide.set(p.matchSideId, p.userId);
        const oppUserIds = [...new Set(oppUserIdBySide.values())];
        // Projection explicite : jamais de select() nu sur `users` (fuite email/passwordHash).
        const oppUsers = oppUserIds.length
          ? await db
              .select({
                id: usersTable.id,
                pseudo: usersTable.pseudo,
                displayName: usersTable.displayName,
                avatarUrl: usersTable.avatarUrl,
              })
              .from(usersTable)
              .where(inArray(usersTable.id, oppUserIds))
          : [];
        const userById = new Map(oppUsers.map((u) => [u.id, u]));

        // Litige : id + statut exposés SANS condition de statut de match — copier le
        // `if (status === 'disputed')` de GET /matches/:id ferait disparaître le badge
        // « litige » dès qu'un admin arbitre (le match repasse completed/cancelled, la
        // dispute reste `resolved`). `GET /disputes/:id` garde sa propre garde d'accès :
        // exposer l'id ici ne fuite rien.
        const disputes = await db
          .select({
            id: disputesTable.id,
            matchId: disputesTable.matchId,
            status: disputesTable.status,
          })
          .from(disputesTable)
          .where(inArray(disputesTable.matchId, visibleIds));
        const disputeByMatch = new Map(disputes.map((d) => [d.matchId, d]));

        const shaped = matches.map((m) => {
          const mySide = sideById.get(mySideByMatch.get(m.id) ?? '');
          const oppSide = oppSideByMatch.get(m.id);
          const dispute = disputeByMatch.get(m.id);

          let opponent: Competitor | null = null;
          if (oppSide) {
            if (m.format === '1v1') {
              const oppUser = userById.get(oppUserIdBySide.get(oppSide.id) ?? '');
              if (oppUser) opponent = { type: 'user', ...oppUser };
            } else if (oppSide.teamId) {
              const oppTeam = teamById.get(oppSide.teamId);
              if (oppTeam) opponent = { type: 'team', ...oppTeam };
            }
          }

          let result: 'win' | 'loss' | null = null;
          if (mySide && m.winnerSideId) result = m.winnerSideId === mySide.id ? 'win' : 'loss';

          return {
            id: m.id,
            ladderId: m.ladderId,
            gameId: m.gameId,
            format: m.format,
            status: m.status,
            scheduledAt: m.scheduledAt,
            startedAt: m.startedAt,
            completedAt: m.completedAt,
            maps: m.maps,
            // `null` tant qu'aucun adversaire n'a accepté (le match n'a qu'un side) ET sur
            // un 2v2+ dont l'équipe adverse a été dissoute depuis.
            opponent,
            // Colonnes `match_sides.score` des deux camps : `null` avant clôture ET après un
            // arbitrage admin (`POST /disputes/:id/resolve` tranche un vainqueur, pas un
            // score) — donc `null` possible sur un match pourtant `completed`.
            score: { self: mySide?.score ?? null, opponent: oppSide?.score ?? null },
            // Uniquement le mien : le delta de l'adversaire n'a aucun usage ici.
            eloDelta: mySide?.eloDelta ?? null,
            result,
            disputeId: dispute?.id ?? null,
            disputeStatus: dispute?.status ?? null,
          };
        });

        return reply.code(200).send({ matches: shaped });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
  // ===== B6 — Soumission de résultat & confirmation =====
  server.post<{ Params: { id: string } }>(
    '/:id/result',
    { onRequest: [server.authenticate] },
    async (request, reply) => {
      try {
        const { id } = idParamSchema.parse(request.params);
        const { winnerSideId, scoreSelf, scoreOpponent } = resultBodySchema.parse(request.body);
        const me = request.user.sub;

        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, id));
        if (!match) return reply.code(404).send({ error: 'match not found' });
        const sides = await db
          .select()
          .from(matchSidesTable)
          .where(eq(matchSidesTable.matchId, id));
        // On identifie le side de CELUI QUI SOUMET (capitaine en 2v2+, joueur en 1v1).
        // L'autorisation passe AVANT les gardes de statut : répondre 409/400 à un
        // non-participant lui donnerait un oracle sur l'état du match (même logique que
        // DELETE /:id). D'où le 403 d'abord, le reste ensuite.
        let mySide = null;
        for (const side of sides) {
          let owned = false;
          if (side.teamId !== null) {
            const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, side.teamId));
            owned = team?.captainId === me;
          } else {
            const [participant] = await db
              .select()
              .from(matchParticipantsTable)
              .where(
                and(
                  eq(matchParticipantsTable.matchSideId, side.id),
                  eq(matchParticipantsTable.userId, me),
                ),
              );
            owned = !!participant;
          }
          if (owned) {
            mySide = side;
            break;
          }
        }
        if (!mySide) return reply.code(403).send({ error: 'not a participant of this match' });
        if (match.status !== 'in_progress' && match.status !== 'awaiting_confirmation')
          return reply.code(409).send({ error: 'match is not awaiting a result' });
        // Le vainqueur déclaré doit être l'un des DEUX sides de CE match. Sans ce garde,
        // un uuid quelconque partirait en base sur submitted_winner_side_id (FK vers
        // match_sides.id) -> violation de contrainte -> 500 au lieu d'un 400 propre.
        if (!sides.some((s) => s.id === winnerSideId))
          return reply.code(400).send({ error: 'winnerSideId is not a side of this match' });
        // Bo3 : exactement un des deux scores doit valoir WINS_REQUIRED (victoire) — jamais
        // les deux (deux vainqueurs), jamais aucun (nul ou série inachevée).
        const selfReachedWins = scoreSelf === WINS_REQUIRED;
        const opponentReachedWins = scoreOpponent === WINS_REQUIRED;
        if (selfReachedWins === opponentReachedWins)
          return reply.code(400).send({
            error: `score must be a completed best-of series (exactly one side reaching ${WINS_REQUIRED} wins)`,
          });
        // Le camp à WINS_REQUIRED doit être celui déclaré vainqueur — sinon un score
        // incohérent avec winnerSideId partirait en base (ex : je déclare l'adversaire
        // vainqueur mais je m'attribue le score gagnant).
        const winnerIsMe = winnerSideId === mySide.id;
        if (winnerIsMe !== selfReachedWins)
          return reply.code(400).send({ error: 'winnerSideId is inconsistent with the submitted score' });
        if (!match.scheduledAt) return reply.code(500).send({ error: 'Internal error' });
        if (new Date() < match.scheduledAt)
          return reply.code(400).send({ error: 'match not started yet' });
        // Remappage « moi / lui » -> « vainqueur / perdant » pour le helper d'écriture. Les
        // gardes ci-dessus garantissent déjà la cohérence (winnerIsMe <=> selfReachedWins).
        const winnerScore = winnerIsMe ? scoreSelf : scoreOpponent;
        const loserScore = winnerIsMe ? scoreOpponent : scoreSelf;

        // Toutes les écritures sous verrou + re-lecture : deux camps qui soumettent en
        // même temps courent sur la même ligne match (TOCTOU, piège #14). Le verrou
        // sérialise, la re-lecture ci-dessous fait autorité (pas la lecture d'avant tx).
        const result = await db.transaction(
          async (
            tx,
          ): Promise<
            | { ok: true; status: string; notifs: CreatedNotification[] }
            | { ok: false; code: number; error: string }
          > => {
            await lockCompetitors(tx, [id]);
            const [currentMatch] = await tx
              .select({ status: matchesTable.status })
              .from(matchesTable)
              .where(eq(matchesTable.id, id));
            if (!currentMatch) return { ok: false, code: 500, error: 'Internal error' };
            if (
              currentMatch.status !== 'in_progress' &&
              currentMatch.status !== 'awaiting_confirmation'
            )
              // Course : le job ou une autre requête a complété/annulé le match entre le 1er
              // check (hors tx) et le verrou. C'est un CONFLIT (409), pas une erreur interne.
              return { ok: false, code: 409, error: 'match is no longer awaiting a result' };
            // Re-soumission = ÉCRASEMENT (choix assumé) : un camp peut corriger son verdict
            // tant que le match n'est pas résolu ; submitted_at est remis à maintenant, ce qui
            // relance sa propre fenêtre de 24 h. Le job d'auto-confirmation relit cette valeur
            // sous verrou, il ne peut donc pas valider un ancien vainqueur (cf. jobs/index.ts).
            await tx
              .update(matchSidesTable)
              .set({
                submittedAt: new Date(),
                submittedWinnerSideId: winnerSideId,
                submittedScoreSelf: scoreSelf,
                submittedScoreOpponent: scoreOpponent,
              })
              .where(eq(matchSidesTable.id, mySide.id));
            // L'AUTRE side est le point de bascule premier/deuxième soumetteur :
            //   - il n'a pas soumis (submittedAt null) -> je suis le 1er -> awaiting_confirmation
            //   - il a soumis                          -> je suis le 2e  -> on compare les vainqueurs
            // On regarde l'AUTRE side (pas le statut du match) pour ne pas confondre
            // « quelqu'un a soumis » avec « l'autre a soumis » (cas de ma re-soumission).
            const [otherSide] = await tx
              .select({
                id: matchSidesTable.id,
                submittedAt: matchSidesTable.submittedAt,
                submittedWinnerSideId: matchSidesTable.submittedWinnerSideId,
                submittedScoreSelf: matchSidesTable.submittedScoreSelf,
                submittedScoreOpponent: matchSidesTable.submittedScoreOpponent,
              })
              .from(matchSidesTable)
              .where(and(eq(matchSidesTable.matchId, id), ne(matchSidesTable.id, mySide.id)));
            if (!otherSide) return { ok: false, code: 500, error: 'Internal error' };

            // B9 — destinataires : les joueurs alignés, JAMAIS l'acteur (`me`). En équipe,
            // les coéquipiers de l'acteur restent notifiés (seul l'auteur du clic est exclu).
            // Une seule requête pour les deux sides — le filtrage se fait en mémoire.
            const participants = await tx
              .select({
                matchSideId: matchParticipantsTable.matchSideId,
                userId: matchParticipantsTable.userId,
              })
              .from(matchParticipantsTable)
              .where(
                inArray(
                  matchParticipantsTable.matchSideId,
                  sides.map((s) => s.id),
                ),
              );
            const bothSidesButMe = participants.map((p) => p.userId).filter((u) => u !== me);

            if (otherSide.submittedAt === null) {
              await tx
                .update(matchesTable)
                .set({ status: 'awaiting_confirmation' })
                .where(and(eq(matchesTable.id, id), eq(matchesTable.status, 'in_progress')));
              // Notifier UNIQUEMENT sur la VRAIE première soumission (transition
              // in_progress -> awaiting_confirmation), pas sur une re-soumission du même
              // camp pendant qu'il attend toujours l'autre : `otherSide.submittedAt===null`
              // reste vrai à CHAQUE re-soumission tant que l'adversaire n'a pas répondu,
              // ce qui spammait l'adversaire d'une notif par clic. `currentMatch.status` a
              // été lu SOUS VERROU avant toute écriture de cette transaction : il ne vaut
              // 'in_progress' que la toute première fois — une re-soumission le trouve déjà
              // à 'awaiting_confirmation' (posé par le 1er appel) et n'entre pas ici.
              // SEUL l'autre camp est prévenu (« l'adversaire a soumis un score, tu as
              // 24 h ») — mes coéquipiers n'ont rien à confirmer, eux.
              const notifs =
                currentMatch.status === 'in_progress'
                  ? await notify(
                      tx,
                      participants
                        .filter((p) => p.matchSideId === otherSide.id)
                        .map((p) => p.userId),
                      'result_submitted',
                      { matchId: id, ladderId: match.ladderId },
                    )
                  : [];
              return { ok: true, status: 'awaiting_confirmation', notifs };
            } else {
              // ACCORD : même vainqueur ET score croisé cohérent — l'autre camp doit
              // m'attribuer le score que je m'attribue, et réciproquement. Même vainqueur
              // mais score différent (2-0 vs 2-1) = DÉSACCORD -> litige, pas un vainqueur
              // arbitraire en base.
              const agree =
                otherSide.submittedWinnerSideId === winnerSideId &&
                otherSide.submittedScoreSelf === scoreOpponent &&
                otherSide.submittedScoreOpponent === scoreSelf;
              if (agree) {
                // Match clos + ELO, dans la MÊME transaction. Helper partagé avec le job
                // d'auto-confirmation (B6) et l'arbitrage admin (B7) — la logique de clôture
                // + ELO vit à un seul endroit.
                await completeMatchWithElo(tx, id, match.ladderId, winnerSideId, winnerScore, loserScore);
                const notifs = await notify(tx, bothSidesButMe, 'result_confirmed', {
                  matchId: id,
                  ladderId: match.ladderId,
                  winnerSideId,
                });
                return { ok: true, status: 'completed', notifs };
              } else {
                // DÉSACCORD : vainqueur différent OU même vainqueur mais score différent
                // (2-0 vs 2-1) -> le match part en litige, on ouvre une dispute et B7
                // (arbitrage admin / timeout 24 h) prend le relais. Aucun ELO ici.
                await tx
                  .update(matchesTable)
                  .set({ status: 'disputed' })
                  .where(eq(matchesTable.id, id));
                const [dispute] = await tx
                  .insert(disputesTable)
                  .values({ matchId: id })
                  .returning({ id: disputesTable.id });
                if (!dispute) return { ok: false, code: 500, error: 'Internal error' };
                // Deux fan-outs : les joueurs (« litige ouvert ») + TOUS les admins (« un
                // litige attend ton arbitrage » — c'est ce qui rend B7 push, pas pull).
                // Un admin qui serait aussi l'acteur n'est pas notifié (règle : jamais l'acteur).
                const admins = (await getAdminIds(tx)).filter((u) => u !== me);
                const notifs = [
                  ...(await notify(tx, bothSidesButMe, 'dispute_opened', {
                    matchId: id,
                    ladderId: match.ladderId,
                    disputeId: dispute.id,
                  })),
                  ...(await notify(tx, admins, 'dispute_needs_admin', {
                    matchId: id,
                    ladderId: match.ladderId,
                    disputeId: dispute.id,
                  })),
                ];
                return { ok: true, status: 'disputed', notifs };
              }
            }
          },
        );
        if (!result.ok) return reply.code(result.code).send({ error: result.error });
        // Push WS APRÈS le commit — un rollback ne notifie jamais.
        pushNotifications(result.notifs);
        return reply.code(200).send({ status: result.status });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ errors: error.issues });
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
