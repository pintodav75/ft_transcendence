// Le seed de soutenance, celui qu'on lance devant le correcteur. Il remplit les 9 ladders
// des 5 jeux : equipes, joueurs classes, matchs joues et Elo etales, pour que le site soit
// vivant partout et pas seulement sur deux pages.
// Contrairement aux deux autres seeds il est autonome et repart d'une ardoise propre.
//
// Attention, il efface tout l'etat de jeu existant : matchs, equipes, classements, amities,
// messages, notifications et les comptes de fixture. Ne pas le lancer sur une base ou
// quelqu'un a du travail en cours.
//
// Usage : docker compose exec backend npm run seed:demo
import { db } from '../db/index.js';
import {
  usersTable,
  teamsTable,
  teamMembersTable,
  teamInvitationsTable,
  laddersTable,
  rankingsTable,
  userExternalAccountsTable,
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  disputesTable,
  gameMapsTable,
  friendshipsTable,
  messagesTable,
  blocksTable,
  notificationsTable,
} from '../db/schema.js';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import { completeMatchWithElo } from '../utils/rankings.js';
import { WINS_REQUIRED } from '../utils/elo.js';

// ---------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------

/**
 * Un seul mot de passe pour tous les comptes nommés. Il RESPECTE la politique du serveur
 * (≥ 8 caractères, majuscule, minuscule, chiffre, caractère spécial) : un `admin/admin` est
 * rejeté par l'API elle-même, ce n'est donc pas une option.
 */
const DEMO_PASSWORD = 'Demo1234!';

/** Domaine des comptes semés — c'est lui qui délimite la purge. */
const DOMAIN = 'demo.local';

/**
 * Les comptes CONNECTABLES. Tous les autres joueurs restent sans mot de passe : ils
 * peuplent les classements et les compositions, personne ne s'y connecte.
 *
 * 🚨 `admin` n'appartient à AUCUNE équipe, volontairement. Un arbitre qui est aussi partie
 * prenante du litige qu'il arbitre voit deux zones de saisie au lieu d'une, et l'écran
 * devient illisible en démonstration.
 */
const NAMED = [
  { pseudo: 'admin', displayName: 'Admin', isAdmin: true },
  { pseudo: 'correcteur', displayName: 'Correcteur', isAdmin: false },
  { pseudo: 'david', displayName: 'David', isAdmin: false },
  { pseudo: 'walid', displayName: 'Walid', isAdmin: false },
  { pseudo: 'william', displayName: 'William', isAdmin: false },
  { pseudo: 'adrien', displayName: 'Adrien', isAdmin: false },
] as const;

/**
 * Les figurants et les noms d'équipe sont COMBINÉS, pas écrits un par un.
 *
 * Pourquoi : le plus gros ladder (5v5, 16 équipes) consomme 80 joueurs DISTINCTS à lui
 * seul, et l'ensemble demande 124 noms d'équipe uniques. Une liste littérale de cette
 * taille est illisible et impossible à faire grandir sans se répéter — deux pools croisés
 * donnent 152 pseudos et 192 noms d'équipe pour vingt lignes.
 */
const HANDLE_HEADS = [
  'frost', 'night', 'void', 'ember', 'storm', 'iron', 'sky', 'ash', 'dawn', 'rift',
  'pulse', 'moss', 'glint', 'crest', 'vapor', 'coil', 'flint', 'murk', 'tide',
];
const HANDLE_TAILS = ['blade', 'runner', 'fox', 'wolf', 'hawk', 'byte', 'spark', 'drift'];

const TEAM_ADJECTIVES = [
  'Iron', 'Crimson', 'Solar', 'Silent', 'Azure', 'Golden', 'Frost', 'Neon',
  'Hollow', 'Quantum', 'Velvet', 'Midnight', 'Obsidian', 'Lucid', 'Cobalt', 'Kinetic',
];
const TEAM_NOUNS = [
  'Wolves', 'Tide', 'Flare', 'Echo', 'Reign', 'Ravens',
  'Legion', 'Drift', 'Crown', 'Leap', 'Thunder', 'Cartel',
];

/** Nombre de figurants — c'est LUI qui plafonne la taille des ladders 5v5. */
const FILLER_COUNT = 114;

/**
 * Les 7 ladders d'ÉQUIPE. `size` est la taille de composition imposée par le format :
 * elle décide combien de joueurs distincts chaque équipe consomme.
 *
 * ⚠️ `teams × size` doit rester ≤ au nombre de joueurs disponibles : un joueur ne peut
 * appartenir qu'à UNE équipe par ladder. À 16 équipes de 5, un ladder consomme 80 des
 * 119 joueurs éligibles — c'est la contrainte qui fixe le plafond.
 */
const TEAM_LADDERS = [
  { gameId: 'cs2', format: '5v5', teams: 16, size: 5 },
  { gameId: 'lol', format: '5v5', teams: 16, size: 5 },
  { gameId: 'val', format: '5v5', teams: 16, size: 5 },
  { gameId: 'cs2', format: '2v2', teams: 20, size: 2 },
  { gameId: 'val', format: '2v2', teams: 20, size: 2 },
  { gameId: 'rl', format: '2v2', teams: 20, size: 2 },
  { gameId: 'rl', format: '3v3', teams: 16, size: 3 },
] as const;

/** Les 2 ladders SOLO : le joueur EST le camp, `rankings.team_id` reste NULL. */
const SOLO_LADDERS = [
  { gameId: 'chess', format: '1v1', players: 60 },
  { gameId: 'rl', format: '1v1', players: 60 },
] as const;

// Qui est capitaine de quoi. Chacun tient trois equipes, sur trois ladders et trois formats
// differents, ce qui montre que le cycle n'est pas ecrit en dur pour le 5v5.
// Un joueur ne peut etre que dans une equipe par ladder, donc un pseudo n'apparait qu'une
// fois par ligne et ses trois equipes sont forcement sur trois ladders distincts.
// Les comptes nommes sont exclus du tirage des figurants, sinon ils etaient repeches comme
// capitaines ailleurs et le recapitulatif affiche en fin de seed devenait faux.
const FORCED_CAPTAINS: Record<string, string[]> = {
  'cs2:5v5': ['correcteur', 'david'],
  'lol:5v5': ['walid', 'david'],
  'val:5v5': ['william', 'walid'],
  'cs2:2v2': ['william', 'walid', 'adrien'],
  'val:2v2': ['correcteur', 'adrien'],
  'rl:2v2': ['david', 'adrien'],
  'rl:3v3': ['correcteur', 'william'],
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Même grille que `createMatchSchema` (:00, :15, :30, :45). */
const SLOT_GRID_MS = 15 * 60 * 1000;

/** Préfixe d'id des notifications semées — même convention que `seed-social`. */
const NOTIF_ID_PREFIX = 'eeee0000-0000-4000-8000-';
const notifId = (n: number) => `${NOTIF_ID_PREFIX}${String(n).padStart(12, '0')}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------------------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------------------

/**
 * Générateur pseudo-aléatoire DÉTERMINISTE (mulberry32). Deux exécutions du seed produisent
 * exactement les mêmes équipes : sans ça, impossible d'écrire une consigne de démonstration
 * (« ouvre l'équipe X ») qui reste vraie après une relance.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Croise deux pools puis mélange : `frostblade`, `nightrunner`… tous distincts. */
function cross(heads: readonly string[], tails: readonly string[], seed: number, join = ''): string[] {
  return shuffled(
    heads.flatMap((head) => tails.map((tail) => `${head}${join}${tail}`)),
    seed,
  );
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Tire 3 maps distinctes dans le pool du jeu — un jeu sans pool rend `[]`. */
async function drawMaps(gameId: string): Promise<string[]> {
  const drawn = await db
    .select({ name: gameMapsTable.name })
    .from(gameMapsTable)
    .where(eq(gameMapsTable.gameId, gameId))
    .orderBy(sql`random()`)
    .limit(3);
  return drawn.map((m) => m.name);
}

/**
 * Crée un match dans la forme exacte que produit le vrai cycle : side 0 = celui qui a ouvert
 * le créneau, side 1 = celui qui a accepté (absent tant que le créneau est `pending`), une
 * ligne `match_participants` par joueur aligné.
 *
 * ⚠️ `teamId: null` est la forme SOLO : sur un ladder 1v1 le joueur EST le camp.
 */
async function insertMatch(
  tx: Tx,
  opts: {
    ladderId: string;
    status: NonNullable<typeof matchesTable.$inferInsert.status>;
    scheduledAt: Date;
    startedAt?: Date;
    maps: string[];
    lineups: { teamId: string | null; players: string[] }[];
  },
): Promise<{ id: string; sideIds: string[] }> {
  const [match] = await tx
    .insert(matchesTable)
    .values({
      ladderId: opts.ladderId,
      status: opts.status,
      scheduledAt: opts.scheduledAt,
      startedAt: opts.startedAt ?? null,
      maps: opts.maps,
    })
    .returning({ id: matchesTable.id });
  if (!match) throw new Error('seed: match insert returned no row');

  const sideIds: string[] = [];
  for (const [sideIndex, lineup] of opts.lineups.entries()) {
    const [side] = await tx
      .insert(matchSidesTable)
      .values({ matchId: match.id, sideIndex, teamId: lineup.teamId })
      .returning({ id: matchSidesTable.id });
    if (!side) throw new Error('seed: match side insert returned no row');
    await tx
      .insert(matchParticipantsTable)
      .values(lineup.players.map((userId) => ({ matchSideId: side.id, userId })));
    sideIds.push(side.id);
  }
  return { id: match.id, sideIds };
}

/**
 * Écrit les deux soumissions CONCORDANTES puis clôture via `completeMatchWithElo` — le
 * helper que partagent déjà la route, le job d'auto-confirmation et l'arbitrage admin.
 * Recopier son calcul d'Elo ici en ferait une deuxième vérité.
 */
async function completeMatch(
  tx: Tx,
  match: { id: string; sideIds: string[] },
  ladderId: string,
  winnerIndex: 0 | 1,
  kickoff: Date,
): Promise<void> {
  const winnerSideId = match.sideIds[winnerIndex]!;
  const loserSideId = match.sideIds[winnerIndex === 0 ? 1 : 0]!;
  const submitted = new Date(kickoff.getTime() + 70 * 60 * 1000);
  const confirmed = new Date(kickoff.getTime() + 76 * 60 * 1000);

  await tx
    .update(matchSidesTable)
    .set({
      submittedAt: submitted,
      submittedWinnerSideId: winnerSideId,
      submittedScoreSelf: WINS_REQUIRED,
      submittedScoreOpponent: WINS_REQUIRED - 1,
    })
    .where(eq(matchSidesTable.id, winnerSideId));
  await tx
    .update(matchSidesTable)
    .set({
      submittedAt: confirmed,
      submittedWinnerSideId: winnerSideId,
      submittedScoreSelf: WINS_REQUIRED - 1,
      submittedScoreOpponent: WINS_REQUIRED,
    })
    .where(eq(matchSidesTable.id, loserSideId));

  await completeMatchWithElo(tx, match.id, ladderId, winnerSideId, WINS_REQUIRED, WINS_REQUIRED - 1);

  // `completeMatchWithElo` horodate à `now` : exact en production, faux pour une fixture
  // jouée il y a trois jours. Sans ce réalignement la fiche afficherait « terminé à
  // l'instant » sur un match daté de la semaine dernière.
  await tx
    .update(matchesTable)
    .set({ completedAt: confirmed })
    .where(eq(matchesTable.id, match.id));
}

// ---------------------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------------------

/** Les 114 pseudos de figurants, tirés du croisement des deux pools. */
const FILLERS = cross(HANDLE_HEADS, HANDLE_TAILS, 7).slice(0, FILLER_COUNT);
/** Les noms d'équipe, dans l'ordre où le seed les consomme. */
const TEAM_NAMES = cross(TEAM_ADJECTIVES, TEAM_NOUNS, 11, ' ');

async function main() {
  const now = Date.now();
  const base = new Date(Math.ceil(now / SLOT_GRID_MS) * SLOT_GRID_MS);
  /** Instant relatif au lancement du seed : tous les états se rafraîchissent à chaque relance. */
  const at = (hours: number) => new Date(base.getTime() + hours * HOUR_MS);

  // ------------------------------------------------------------------- 1. ardoise propre
  // Les matchs partent en premier : sides, participants et disputes les suivent en cascade.
  // Les équipes emportent leurs membres, leurs invitations et leurs lignes de classement.
  await db.delete(matchesTable);
  await db.delete(teamsTable);
  await db.delete(rankingsTable);
  await db.delete(friendshipsTable);
  await db.delete(messagesTable);
  await db.delete(blocksTable);
  await db.delete(notificationsTable);
  await db.delete(userExternalAccountsTable);
  // Comptes de fixture des trois seeds + résidus des campagnes d'audit. Un compte réel
  // (créé à la main, ou par le correcteur pendant la démonstration) n'est jamais touché.
  await db
    .delete(usersTable)
    .where(
      or(
        sql`${usersTable.email} LIKE '%@demo.local'`,
        sql`${usersTable.email} LIKE '%@dev.local'`,
        sql`${usersTable.pseudo} LIKE 'audit%'`,
      ),
    );

  // ------------------------------------------------------------------------- 2. ladders
  const allLadders = await db
    .select({
      id: laddersTable.id,
      gameId: laddersTable.gameId,
      format: laddersTable.format,
      name: laddersTable.name,
    })
    .from(laddersTable);
  const ladderOf = (gameId: string, format: string) => {
    const found = allLadders.find((l) => l.gameId === gameId && l.format === format);
    if (!found) throw new Error(`seed: ladder ${gameId} ${format} introuvable — migrations lancées ?`);
    return found;
  };

  // --------------------------------------------------------------------------- 3. joueurs
  const hash = await hashPassword(DEMO_PASSWORD);
  const namedRows = NAMED.map((u) => ({
    pseudo: u.pseudo,
    email: `${u.pseudo}@${DOMAIN}`,
    displayName: u.displayName,
    passwordHash: hash,
    isAdmin: u.isAdmin,
  }));
  // Les figurants n'ont PAS de mot de passe : ils remplissent classements et compositions,
  // personne ne s'y connecte. Moins de comptes ouverts sur un secret versionné.
  const fillerRows = FILLERS.map((pseudo) => ({
    pseudo,
    email: `${pseudo}@${DOMAIN}`,
    displayName: pseudo.charAt(0).toUpperCase() + pseudo.slice(1),
    passwordHash: null,
    isAdmin: false,
  }));

  await db.insert(usersTable).values([...namedRows, ...fillerRows]);

  const dbUsers = await db
    .select({ id: usersTable.id, pseudo: usersTable.pseudo })
    .from(usersTable)
    .where(sql`${usersTable.email} LIKE ${'%@' + DOMAIN}`);
  const idOf = new Map(dbUsers.map((u) => [u.pseudo, u.id]));
  const uid = (pseudo: string) => {
    const found = idOf.get(pseudo);
    if (!found) throw new Error(`seed: joueur ${pseudo} introuvable`);
    return found;
  };

  // ----------------------------------------------------------------- 4. comptes externes
  // Chaque joueur est rattaché aux 4 providers : sans le compte externe du jeu, `POST
  // /matches` REFUSE d'aligner le joueur, et la moitié des ladders serait injouable.
  // `verified: false` — aucune possession n'a été prouvée, le parcours de vérification
  // OAuth Steam/Riot n'existe pas. Le champ n'est affiché nulle part dans l'interface.
  const PROVIDERS = ['riot', 'steam', 'epic', 'chess_com'] as const;
  await db.insert(userExternalAccountsTable).values(
    dbUsers.flatMap((u) =>
      PROVIDERS.map((provider) => ({
        userId: u.id,
        provider,
        externalId: `demo-${provider}-${u.pseudo}`,
      })),
    ),
  );

  // ------------------------------------------------------------- 5. équipes et compositions
  /**
   * Le vivier du tirage aléatoire : les FIGURANTS seuls.
   *
   * 🚨 Les comptes nommés en sont exclus — l'admin parce qu'il ne rejoint aucune équipe, les
   * 5 autres parce que leurs équipes sont décidées par `FORCED_CAPTAINS` et rien d'autre.
   * Les laisser dans le vivier les faisait atterrir dans des équipes supplémentaires (et
   * parfois comme capitaines), ce qui contredisait le récapitulatif de fin de seed.
   */
  const namedPseudos = NAMED.map((u) => u.pseudo) as readonly string[];
  const playablePseudos = dbUsers.map((u) => u.pseudo).filter((p) => !namedPseudos.includes(p));

  let nameCursor = 0;
  const nextTeamName = () => {
    const name = TEAM_NAMES[nameCursor % TEAM_NAMES.length]!;
    nameCursor += 1;
    return name;
  };

  type SeededTeam = { id: string; name: string; ladderId: string; captain: string; roster: string[] };
  /** `cs2:5v5` → les équipes du ladder, dans l'ordre de leur classement. */
  const teamsByLadder = new Map<string, SeededTeam[]>();

  for (const [ladderIndex, config] of TEAM_LADDERS.entries()) {
    const ladder = ladderOf(config.gameId, config.format);
    const key = `${config.gameId}:${config.format}`;
    const forced = FORCED_CAPTAINS[key] ?? [];

    // Ordre de tirage propre à CE ladder : un joueur ne se retrouve pas avec les mêmes
    // coéquipiers partout. La graine dérive de l'index, donc le résultat est reproductible.
    const pool = shuffled(
      playablePseudos.filter((p) => !forced.includes(p)),
      1000 + ladderIndex * 37,
    );
    let cursor = 0;
    const take = () => {
      const pseudo = pool[cursor];
      if (!pseudo) throw new Error(`seed: plus assez de joueurs pour ${key}`);
      cursor += 1;
      return pseudo;
    };

    const rosters: { name: string; captain: string; members: string[] }[] = [];
    for (let t = 0; t < config.teams; t++) {
      const captain = forced[t] ?? take();
      const members = [captain];
      while (members.length < config.size) members.push(take());
      rosters.push({ name: nextTeamName(), captain, members });
    }

    const inserted = await db
      .insert(teamsTable)
      .values(rosters.map((r) => ({ ladderId: ladder.id, name: r.name, captainId: uid(r.captain) })))
      .returning({ id: teamsTable.id, name: teamsTable.name });
    const teamIdByName = new Map(inserted.map((t) => [t.name, t.id]));

    await db.insert(teamMembersTable).values(
      rosters.flatMap((r) =>
        r.members.map((pseudo) => ({
          teamId: teamIdByName.get(r.name)!,
          userId: uid(pseudo),
          ladderId: ladder.id,
        })),
      ),
    );

    // Classement : Elo étalé de ~1580 à ~900 pour que le tri soit visible à l'œil et que la
    // première page du ladder ne soit pas un mur de 1000. Un léger bruit déterministe évite
    // la suite arithmétique parfaite, qui saute aux yeux dès qu'on fait défiler la page.
    const step = 680 / Math.max(1, config.teams - 1);
    const jitter = rng(500 + ladderIndex);
    await db.insert(rankingsTable).values(
      rosters.map((r, i) => ({
        ladderId: ladder.id,
        teamId: teamIdByName.get(r.name)!,
        elo: Math.round(1580 - i * step + (jitter() - 0.5) * step * 0.6),
        wins: Math.max(1, Math.round((config.teams - i) * 1.6)),
        losses: Math.max(1, Math.round((i + 1) * 1.4)),
        lastMatchAt: new Date(now - (i + 1) * 6 * HOUR_MS),
      })),
    );

    teamsByLadder.set(
      key,
      rosters.map((r) => ({
        id: teamIdByName.get(r.name)!,
        name: r.name,
        ladderId: ladder.id,
        captain: r.captain,
        roster: r.members,
      })),
    );
  }

  // ------------------------------------------------------------------ 6. classements solo
  /** `chess:1v1` → les pseudos classés, du meilleur au moins bon. */
  const soloByLadder = new Map<string, string[]>();

  for (const [soloIndex, config] of SOLO_LADDERS.entries()) {
    const ladder = ladderOf(config.gameId, config.format);
    const key = `${config.gameId}:${config.format}`;
    // Le correcteur et l'équipe sont classés en solo eux aussi : leur dossier de compétiteur
    // ne doit pas être vide quand on l'ouvre en démonstration.
    const forced = ['correcteur', 'david', 'walid', 'william', 'adrien'];
    const pool = shuffled(
      playablePseudos.filter((p) => !forced.includes(p)),
      2000 + soloIndex * 53,
    );
    const ranked = [...forced, ...pool].slice(0, config.players);
    // On mélange une dernière fois pour que le correcteur ne soit pas systématiquement 1er.
    const ordered = shuffled(ranked, 3000 + soloIndex * 17);

    const step = 800 / Math.max(1, ordered.length - 1);
    const jitter = rng(600 + soloIndex);
    await db.insert(rankingsTable).values(
      ordered.map((pseudo, i) => ({
        ladderId: ladder.id,
        userId: uid(pseudo),
        elo: Math.round(1680 - i * step + (jitter() - 0.5) * step * 0.6),
        wins: Math.max(1, Math.round((ordered.length - i) * 0.8)),
        losses: Math.max(1, Math.round((i + 1) * 0.7)),
        lastMatchAt: new Date(now - (i + 1) * 4 * HOUR_MS),
      })),
    );
    soloByLadder.set(key, ordered);
  }

  // --------------------------------------------------- 7. matchs terminés sur chaque ladder
  // Un ladder sans historique a un classement qui sort de nulle part. On apparie les équipes
  // DEUX À DEUX sans jamais réutiliser une équipe : c'est ce qui garantit qu'aucun de ces
  // matchs n'en chevauche un autre (invariant §5.2, fenêtres strictes).
  let completedCount = 0;

  for (const [ladderIndex, config] of TEAM_LADDERS.entries()) {
    const key = `${config.gameId}:${config.format}`;
    const ladder = ladderOf(config.gameId, config.format);
    const teams = teamsByLadder.get(key)!;
    const pairs: [SeededTeam, SeededTeam][] = [];
    for (let i = 0; i + 1 < teams.length; i += 2) pairs.push([teams[i]!, teams[i + 1]!]);

    for (const [pairIndex, [home, away]] of pairs.entries()) {
      // Étalés sur plusieurs jours, très au-delà du `lockout_minutes` le plus large (60 min).
      const kickoff = at(-(24 * (2 + ladderIndex) + pairIndex * 5));
      const maps = await drawMaps(config.gameId);
      await db.transaction(async (tx) => {
        const match = await insertMatch(tx, {
          ladderId: ladder.id,
          status: 'in_progress',
          scheduledAt: kickoff,
          startedAt: new Date(kickoff.getTime() - HOUR_MS),
          maps,
          lineups: [
            { teamId: home.id, players: home.roster.map(uid) },
            { teamId: away.id, players: away.roster.map(uid) },
          ],
        });
        // Le mieux classé ne gagne pas toujours : un vainqueur toujours en side 0 laisserait
        // passer un affichage qui confond « premier camp » et « vainqueur ».
        await completeMatch(tx, match, ladder.id, pairIndex % 3 === 0 ? 1 : 0, kickoff);
      });
      completedCount += 1;
    }
  }

  for (const [soloIndex, config] of SOLO_LADDERS.entries()) {
    const key = `${config.gameId}:${config.format}`;
    const ladder = ladderOf(config.gameId, config.format);
    const ranked = soloByLadder.get(key)!;
    // 9 duels, sur des joueurs TOUS distincts — c'est ce qui garantit qu'aucun ne chevauche
    // un autre (§5.2) — dont un impliquant le correcteur.
    const duels: [string, string][] = [['correcteur', ranked.find((p) => p !== 'correcteur')!]];
    const rest = ranked.filter((p) => p !== 'correcteur' && p !== duels[0]![1]);
    for (let i = 0; i + 1 < Math.min(rest.length, 16); i += 2) duels.push([rest[i]!, rest[i + 1]!]);

    for (const [duelIndex, [home, away]] of duels.entries()) {
      const kickoff = at(-(24 * (9 + soloIndex) + duelIndex * 4));
      const maps = await drawMaps(config.gameId);
      await db.transaction(async (tx) => {
        const match = await insertMatch(tx, {
          ladderId: ladder.id,
          status: 'in_progress',
          scheduledAt: kickoff,
          startedAt: new Date(kickoff.getTime() - HOUR_MS),
          maps,
          lineups: [
            { teamId: null, players: [uid(home)] },
            { teamId: null, players: [uid(away)] },
          ],
        });
        await completeMatch(tx, match, ladder.id, duelIndex % 2 === 0 ? 0 : 1, kickoff);
      });
      completedCount += 1;
    }
  }

  // ------------------------------------------- 8. les états VIVANTS autour du correcteur
  // Un correcteur qui ne peut rien faire regarde un site ; celui-ci doit pouvoir AGIR.
  const cs2 = ladderOf('cs2', '5v5');
  const val2 = ladderOf('val', '2v2');
  const cs2Teams = teamsByLadder.get('cs2:5v5')!;
  const val2Teams = teamsByLadder.get('val:2v2')!;
  const lolTeams = teamsByLadder.get('lol:5v5')!;
  const lol = ladderOf('lol', '5v5');

  /** Retrouve une équipe par son capitaine plutôt que par un index : `FORCED_CAPTAINS` peut
   *  être réordonné sans casser silencieusement les états vivants ci-dessous. */
  const teamOf = (key: string, captain: string): SeededTeam => {
    const found = teamsByLadder.get(key)!.find((t) => t.captain === captain);
    if (!found) throw new Error(`seed: aucune équipe capitainée par ${captain} sur ${key}`);
    return found;
  };

  const myCs2 = teamOf('cs2:5v5', 'correcteur');
  const rivalCs2 = teamOf('cs2:5v5', 'david');
  // Deux équipes de figurants : le correcteur n'y est pas, ce sont ses adversaires.
  const thirdCs2 = cs2Teams.find((t) => !namedPseudos.includes(t.captain))!;
  const fourthCs2 = cs2Teams.filter((t) => !namedPseudos.includes(t.captain))[1]!;
  const myVal2 = teamOf('val:2v2', 'correcteur');
  // Le litige de l'admin oppose deux équipes de FIGURANTS : ni lui ni le correcteur n'y sont.
  const neutralLol = lolTeams.filter((t) => !namedPseudos.includes(t.captain));

  const lineup = (team: SeededTeam) => ({ teamId: team.id, players: team.roster.map(uid) });

  const live = await db.transaction(async (tx) => {
    // (a) UN DÉFI À ACCEPTER — ouvert par l'équipe de David, dans 3 jours. Trois jours et
    //     non trois heures : le ménage automatique annule tout créneau qui passe sous
    //     15 min de son coup d'envoi, une base préparée la veille n'aurait plus rien à
    //     montrer le lendemain.
    const challenge = await insertMatch(tx, {
      ladderId: cs2.id,
      status: 'pending',
      scheduledAt: at(24 * 3),
      maps: await drawMaps('cs2'),
      lineups: [lineup(rivalCs2)],
    });

    // (b) UN CRÉNEAU QUE LE CORRECTEUR A LUI-MÊME OUVERT — à annuler depuis sa page équipe.
    const myOpenSlot = await insertMatch(tx, {
      ladderId: val2.id,
      status: 'pending',
      scheduledAt: at(24 * 2 + 3),
      maps: await drawMaps('val'),
      lineups: [lineup(myVal2)],
    });

    // (c) UN SCORE À CONFIRMER — l'adversaire a déjà soumis, le correcteur confirme ou
    //     conteste. C'est l'écran qui démontre le bouton « Confirmer ».
    const awaitingKickoff = at(-5);
    const awaiting = await insertMatch(tx, {
      ladderId: cs2.id,
      status: 'awaiting_confirmation',
      scheduledAt: awaitingKickoff,
      startedAt: new Date(awaitingKickoff.getTime() - HOUR_MS),
      maps: await drawMaps('cs2'),
      lineups: [lineup(myCs2), lineup(thirdCs2)],
    });
    await tx
      .update(matchSidesTable)
      .set({
        submittedAt: new Date(awaitingKickoff.getTime() + 80 * 60 * 1000),
        submittedWinnerSideId: awaiting.sideIds[1]!,
        submittedScoreSelf: WINS_REQUIRED,
        submittedScoreOpponent: 0,
      })
      .where(eq(matchSidesTable.id, awaiting.sideIds[1]!));

    // (d) UN LITIGE OÙ LE CORRECTEUR EST PARTIE — les deux camps se déclarent vainqueurs.
    const disputedKickoff = at(-9);
    const disputed = await insertMatch(tx, {
      ladderId: cs2.id,
      status: 'disputed',
      scheduledAt: disputedKickoff,
      startedAt: new Date(disputedKickoff.getTime() - HOUR_MS),
      maps: await drawMaps('cs2'),
      lineups: [lineup(myCs2), lineup(fourthCs2)],
    });
    await tx
      .update(matchSidesTable)
      .set({
        submittedAt: new Date(disputedKickoff.getTime() + 75 * 60 * 1000),
        submittedWinnerSideId: disputed.sideIds[0]!,
        submittedScoreSelf: WINS_REQUIRED,
        submittedScoreOpponent: WINS_REQUIRED - 1,
      })
      .where(eq(matchSidesTable.id, disputed.sideIds[0]!));
    await tx
      .update(matchSidesTable)
      .set({
        submittedAt: new Date(disputedKickoff.getTime() + 82 * 60 * 1000),
        submittedWinnerSideId: disputed.sideIds[1]!,
        submittedScoreSelf: WINS_REQUIRED,
        submittedScoreOpponent: 0,
      })
      .where(eq(matchSidesTable.id, disputed.sideIds[1]!));
    const [myDispute] = await tx
      .insert(disputesTable)
      .values({ matchId: disputed.id, createdAt: new Date(disputedKickoff.getTime() + 82 * 60 * 1000) })
      .returning({ id: disputesTable.id });

    // (e) UN LITIGE POUR L'ADMIN — sur le ladder LoL, entre deux équipes dont le correcteur
    //     n'est PAS membre. 🚨 L'arbitre ne doit jamais être partie prenante : sinon la page
    //     affiche deux zones de saisie au lieu d'une et devient illisible en démonstration.
    const adminKickoff = at(-14);
    const adminDisputed = await insertMatch(tx, {
      ladderId: lol.id,
      status: 'disputed',
      scheduledAt: adminKickoff,
      startedAt: new Date(adminKickoff.getTime() - HOUR_MS),
      maps: await drawMaps('lol'),
      lineups: [lineup(neutralLol[0]!), lineup(neutralLol[1]!)],
    });
    await tx
      .update(matchSidesTable)
      .set({
        submittedAt: new Date(adminKickoff.getTime() + 70 * 60 * 1000),
        submittedWinnerSideId: adminDisputed.sideIds[0]!,
        submittedScoreSelf: WINS_REQUIRED,
        submittedScoreOpponent: 0,
      })
      .where(eq(matchSidesTable.id, adminDisputed.sideIds[0]!));
    await tx
      .update(matchSidesTable)
      .set({
        submittedAt: new Date(adminKickoff.getTime() + 78 * 60 * 1000),
        submittedWinnerSideId: adminDisputed.sideIds[1]!,
        submittedScoreSelf: WINS_REQUIRED,
        submittedScoreOpponent: WINS_REQUIRED - 1,
      })
      .where(eq(matchSidesTable.id, adminDisputed.sideIds[1]!));
    await tx
      .insert(disputesTable)
      .values({ matchId: adminDisputed.id, createdAt: new Date(adminKickoff.getTime() + 78 * 60 * 1000) });

    // (f) UN CRÉNEAU ANNULÉ — personne ne l'a pris, le ménage l'a retiré. Un seul side,
    //     comme un créneau ouvert : c'est le STATUT qui les distingue, pas l'absence
    //     d'adversaire.
    await insertMatch(tx, {
      ladderId: cs2.id,
      status: 'cancelled',
      scheduledAt: at(-30),
      maps: await drawMaps('cs2'),
      lineups: [lineup(rivalCs2)],
    });

    return { challenge, myOpenSlot, awaiting, disputed, disputeId: myDispute!.id };
  });

  // ------------------------------------------------------------------- 9. invitation reçue
  // Adrien invite le correcteur dans son équipe CS2 2v2 — un ladder où il n'a pas d'équipe,
  // donc une invitation qu'il peut réellement accepter.
  const adrienTeam = teamOf('cs2:2v2', 'adrien');
  const [invitation] = await db
    .insert(teamInvitationsTable)
    .values({
      teamId: adrienTeam.id,
      userId: uid('correcteur'),
      ladderId: adrienTeam.ladderId,
      invitedBy: uid('adrien'),
      createdAt: new Date(now - 3 * HOUR_MS),
    })
    .returning({ id: teamInvitationsTable.id });

  // ------------------------------------------------------------------------- 10. social
  const me = uid('correcteur');
  // Volumes volontairement supérieurs à la hauteur du rail : la soutenance doit aussi
  // permettre de vérifier son scroll, pas seulement l'état nominal de chaque ligne.
  // Les tranches sont disjointes : une même personne ne peut pas être simultanément amie,
  // en attente et bloquée.
  const FRIENDS = ['david', 'walid', 'william', 'adrien', ...FILLERS.slice(0, 32)];
  const INCOMING = FILLERS.slice(32, 42);
  const OUTGOING = FILLERS.slice(42, 52);
  const BLOCKED = FILLERS.slice(52, 58);

  await db.insert(friendshipsTable).values([
    ...FRIENDS.map((pseudo, i) => ({
      requesterId: me,
      addresseeId: uid(pseudo),
      status: 'accepted' as const,
      createdAt: new Date(now - (FRIENDS.length - i + 10) * DAY_MS),
    })),
    // Reçues : c'est l'AUTRE qui est demandeur, sinon elles s'afficheraient côté « envoyées ».
    ...INCOMING.map((pseudo, i) => ({
      requesterId: uid(pseudo),
      addresseeId: me,
      status: 'pending' as const,
      createdAt: new Date(now - (i + 1) * 2 * HOUR_MS),
    })),
    ...OUTGOING.map((pseudo, i) => ({
      requesterId: me,
      addresseeId: uid(pseudo),
      status: 'pending' as const,
      createdAt: new Date(now - (i + 1) * 5 * HOUR_MS),
    })),
    // L'équipe est amie entre elle : les démonstrations à deux fenêtres marchent quel que
    // soit le binôme qui les fait.
    { requesterId: uid('david'), addresseeId: uid('walid'), status: 'accepted' as const },
    { requesterId: uid('david'), addresseeId: uid('william'), status: 'accepted' as const },
    { requesterId: uid('david'), addresseeId: uid('adrien'), status: 'accepted' as const },
    { requesterId: uid('walid'), addresseeId: uid('william'), status: 'accepted' as const },
    { requesterId: uid('walid'), addresseeId: uid('adrien'), status: 'accepted' as const },
    { requesterId: uid('william'), addresseeId: uid('adrien'), status: 'accepted' as const },
  ]);

  await db.insert(blocksTable).values(BLOCKED.map((pseudo) => ({ blockerId: me, blockedId: uid(pseudo) })));

  // Horodatages espacés et croissants : la liste des conversations se trie sur le dernier
  // message, deux messages à la même seconde rendraient ce tri non reproductible.
  const CHAT = [
    { with: 'david', from: 'david', content: 'salut, tu es dispo pour le match de jeudi ?' },
    { with: 'david', from: 'correcteur', content: 'oui je suis là' },
    { with: 'david', from: 'david', content: 'on joue contre qui déjà ?' },
    { with: 'david', from: 'correcteur', content: "l'équipe qui nous a défiés hier" },
    { with: 'david', from: 'david', content: 'ok, je préviens les autres' },
    { with: 'david', from: 'correcteur', content: 'nickel' },
    { with: 'david', from: 'david', content: 'au fait ton Elo a bien monté cette semaine' },
    { with: 'david', from: 'correcteur', content: 'la série de dimanche a aidé' },
    { with: 'david', from: 'david', content: 'à jeudi 👋' },
    { with: 'walid', from: 'walid', content: 'gg pour hier soir' },
    { with: 'walid', from: 'correcteur', content: 'merci, c’était serré' },
    { with: 'william', from: 'william', content: 'tu montes en 2v2 ce week-end ?' },
    { with: 'adrien', from: 'adrien', content: "je t'ai envoyé une invitation pour l'équipe" },
    // Une conversation de deux messages par ami figurant : la liste « Messages » dépasse
    // largement la hauteur du rail, tandis que la conversation détaillée avec David garde
    // son historique réaliste.
    ...FRIENDS.slice(4).flatMap((pseudo, i) => [
      {
        with: pseudo,
        from: pseudo,
        content: `message de test ${i + 1} pour vérifier le défilement du rail`,
      },
      {
        with: pseudo,
        from: 'correcteur',
        content: `réponse de test ${i + 1}`,
      },
    ]),
  ];
  await db.insert(messagesTable).values(
    CHAT.map((m, i) => {
      const other = uid(m.with);
      const fromMe = m.from === 'correcteur';
      return {
        senderId: fromMe ? me : other,
        receiverId: fromMe ? other : me,
        content: m.content,
        createdAt: new Date(now - (CHAT.length - i) * 11 * 60_000),
      };
    }),
  );

  // 🚨 CHAQUE NOTIFICATION POINTE VERS UNE CIBLE QUI EXISTE VRAIMENT : la cloche mène à
  // l'écran concerné, un identifiant inventé produirait un 404 au clic — donc une ligne
  // rouge dans la console, motif de rejet du projet.
  const pendingIn = await db
    .select({ id: friendshipsTable.id, requesterId: friendshipsTable.requesterId })
    .from(friendshipsTable)
    .where(and(eq(friendshipsTable.addresseeId, me), eq(friendshipsTable.status, 'pending')));
  const [acceptedWithDavid] = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(and(eq(friendshipsTable.requesterId, me), eq(friendshipsTable.addresseeId, uid('david'))));

  const pseudoById = new Map(dbUsers.map((u) => [u.id, u.pseudo]));
  type SeedNotification = {
    type: (typeof notificationsTable.$inferInsert)['type'];
    data: Record<string, unknown>;
    read: boolean;
  };
  const notifications: SeedNotification[] = [];

  for (const request of pendingIn) {
    const fromPseudo = pseudoById.get(request.requesterId);
    if (!fromPseudo) continue;
    notifications.push({
      type: 'friend_request_received',
      data: { friendshipId: request.id, fromUserId: request.requesterId, fromPseudo },
      read: false,
    });
  }
  if (acceptedWithDavid) {
    notifications.push({
      type: 'friend_request_accepted',
      data: { friendshipId: acceptedWithDavid.id, byUserId: uid('david'), byPseudo: 'david' },
      read: false,
    });
  }
  if (invitation) {
    notifications.push({
      type: 'team_invitation_received',
      data: {
        invitationId: invitation.id,
        teamId: adrienTeam.id,
        teamName: adrienTeam.name,
        ladderId: adrienTeam.ladderId,
        byUserId: uid('adrien'),
        byPseudo: 'adrien',
      },
      read: false,
    });
  }
  notifications.push({
    type: 'result_submitted',
    data: { matchId: live.awaiting.id, ladderId: cs2.id },
    read: false,
  });
  notifications.push({
    type: 'dispute_opened',
    data: { matchId: live.disputed.id, ladderId: cs2.id, disputeId: live.disputeId },
    read: true,
  });

  await db.insert(notificationsTable).values(
    notifications.map((n, i) => ({
      id: notifId(i + 1),
      userId: me,
      type: n.type,
      data: n.data,
      readAt: n.read ? new Date(now - (i + 1) * HOUR_MS) : null,
      createdAt: new Date(now - (i + 1) * 35 * 60_000),
    })),
  );

  // ---------------------------------------------------------------------------- récapitulatif
  const totalTeams = TEAM_LADDERS.reduce((sum, l) => sum + l.teams, 0);
  const unread = notifications.filter((n) => !n.read).length;

  console.log('\n🌱 Base de démonstration prête.\n');
  console.log(`   ${dbUsers.length} joueurs · ${totalTeams} équipes · ${allLadders.length} ladders remplis`);
  console.log(`   ${completedCount} matchs terminés · 6 matchs en cours · 2 litiges ouverts`);
  console.log(
    `   ${notifications.length} notifications dont ${unread} non lues · ${CHAT.length} messages dans ${new Set(CHAT.map((message) => message.with)).size} conversations`,
  );

  console.log(`\n🔑 Comptes (mot de passe : ${DEMO_PASSWORD})\n`);
  console.log(`   correcteur@${DOMAIN}   LE COMPTE À UTILISER — capitaine de 3 équipes`);
  console.log(`   admin@${DOMAIN}        arbitre des litiges, membre d'aucune équipe`);
  console.log(`   david@${DOMAIN}        capitaine ${rivalCs2.name} (CS2 5v5) + 2 autres`);
  console.log(`   walid@${DOMAIN}        capitaine ${teamOf('lol:5v5', 'walid').name} (LoL 5v5) + 2 autres`);
  console.log(`   william@${DOMAIN}      capitaine ${teamOf('val:5v5', 'william').name} (Valorant 5v5) + 2 autres`);
  console.log(`   adrien@${DOMAIN}       capitaine ${adrienTeam.name} (CS2 2v2) + 2 autres`);

  console.log('\n🎯 Ce que « correcteur » peut faire immédiatement\n');
  console.log(`   Accepter un défi        ${rivalCs2.name} l'a défié sur CS2 5v5 (dans 3 jours)`);
  console.log(`   Annuler son créneau     ouvert par lui sur Valorant 2v2`);
  console.log(`   Confirmer un score      ${thirdCs2.name} a déjà soumis le sien (CS2 5v5)`);
  console.log(`   Suivre un litige        contre ${fourthCs2.name} — dossier ${live.disputeId}`);
  console.log(`   Répondre à 1 invitation  d'${adrienTeam.name} (CS2 2v2)`);
  console.log(
    `   Parcourir ${FRIENDS.length} amis, répondre à ${INCOMING.length} demandes reçues, annuler ${OUTGOING.length} demandes envoyées, débloquer ${BLOCKED.length} comptes`,
  );
  console.log(`   Il est aussi classé en solo sur Chess 1v1 et Rocket League 1v1\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
