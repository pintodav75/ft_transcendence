/**
 * Seed de DÉVELOPPEMENT (fixtures) — À NE PAS confondre avec les données de
 * référence (games/ladders) qui, elles, vivent dans les migrations.
 *
 * Ce script insère de faux profils + faux classements pour visualiser le
 * leaderboard en local, et — depuis B16 — **six matchs de démo** entre deux des
 * équipes semées, un par état du cycle challenge/accept. Il est idempotent
 * (onConflictDoNothing + purge de sa propre production côté matchs) → relançable
 * sans créer de doublons, et ne doit JAMAIS être lancé en prod.
 *
 * Usage : docker compose exec backend npm run seed:dev
 */
import { db } from '../db/index.js';
import {
  usersTable,
  teamsTable,
  teamMembersTable,
  laddersTable,
  rankingsTable,
  userExternalAccountsTable,
  matchesTable,
  matchSidesTable,
  matchParticipantsTable,
  disputesTable,
  gameMapsTable,
} from '../db/schema.js';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { completeMatchWithElo } from '../utils/rankings.js';
import { WINS_REQUIRED } from '../utils/elo.js';

// Mot de passe des comptes CONNECTABLES — le MÊME couple que `backend/tests/helpers.py`,
// pour n'avoir qu'un seul secret de fixture à connaître dans le repo. Sans lui, les matchs
// de démo seraient visibles en SQL mais INATTEIGNABLES dans l'app (la page équipe masque
// les slots aux non-membres, et le bouton « Confirmer » n'existe que pour un participant).
// Régénérer avec :
//   docker compose exec backend node -e "console.log(require('bcryptjs').hashSync('Test1234!',12))"
const FIXTURE_PASSWORD = 'Test1234!';
const FIXTURE_HASH = '$2b$12$fw2ngYMEiBbg5XgJkTG4.ujHTa5M0g3FrITvdpTtzqVKxp8aPnuI.';

// Seuls ces 3 comptes reçoivent un mot de passe, et ils suffisent à atteindre TOUS les
// écrans : les deux capitaines qui s'affrontent (donc les deux camps de chaque match) plus
// un TIERS, indispensable pour vérifier ce qu'un non-participant voit — le slot ouvert lui
// est masqué et un match non terminé lui rend 403.
// Les 8 autres ne sont que du remplissage de lineup (un ladder 5v5 exige 5 joueurs par
// camp) : personne ne s'y connectera jamais, ils restent sans mot de passe. Moins de
// comptes ouverts sur un secret versionné = moins de surface si le seed part ailleurs.
const LOGIN_PSEUDOS: string[] = ['alice', 'bob', 'carol'];

// 11 faux joueurs, ELO décroissant pour voir le tri.
const fakeUsers = [
  { pseudo: 'alice', displayName: 'Alice', elo: 1580, wins: 30, losses: 8 },
  { pseudo: 'bob', displayName: 'Bob', elo: 1490, wins: 25, losses: 10 },
  { pseudo: 'carol', displayName: 'Carol', elo: 1435, wins: 22, losses: 12 },
  { pseudo: 'dave', displayName: 'Dave', elo: 1390, wins: 20, losses: 14 },
  { pseudo: 'erin', displayName: 'Erin', elo: 1350, wins: 18, losses: 15 },
  { pseudo: 'frank', displayName: 'Frank', elo: 1300, wins: 15, losses: 15 },
  { pseudo: 'grace', displayName: 'Grace', elo: 1255, wins: 12, losses: 18 },
  { pseudo: 'heidi', displayName: 'Heidi', elo: 1180, wins: 9, losses: 20 },
  { pseudo: 'ivan', displayName: 'Ivan', elo: 1075, wins: 5, losses: 22 },
  { pseudo: 'karl', displayName: 'Karl', elo: 1020, wins: 4, losses: 23 },
  { pseudo: 'judy', displayName: 'Judy', elo: 980, wins: 2, losses: 25 },
];

// 3 fausses équipes sur cs2 5v5, ELO décroissant.
const fakeTeams = [
  { name: 'Team Alpha', captain: 'alice', elo: 1320, wins: 12, losses: 3 },
  { name: 'Team Bravo', captain: 'bob', elo: 1130, wins: 7, losses: 6 },
  { name: 'Team Charlie', captain: 'carol', elo: 995, wins: 3, losses: 9 },
];

// Roster de chaque équipe. Le capitaine est DANS son roster : `POST /teams` l'inscrit
// lui-même comme membre, une équipe dont le capitaine n'est pas membre n'existe pas dans
// le vrai cycle. `team_members_user_ladder_unique` impose un joueur dans UNE seule équipe
// par ladder → aucun pseudo ne peut apparaître deux fois ici.
// Alpha et Bravo ont exactement 5 joueurs : c'est la taille de lineup qu'un ladder 5v5
// exige, donc le minimum pour que les matchs de démo soient alignables pour de vrai.
const teamRosters: Record<string, string[]> = {
  'Team Alpha': ['alice', 'dave', 'erin', 'frank', 'grace'],
  'Team Bravo': ['bob', 'heidi', 'ivan', 'judy', 'karl'],
  'Team Charlie': ['carol'],
};

// Les deux équipes qui s'affrontent dans les matchs de démo (B16).
const DEMO_HOME = 'Team Alpha'; // side 0 — le camp qui OUVRE les créneaux
const DEMO_AWAY = 'Team Bravo'; // side 1 — le camp qui ACCEPTE

// `db` ou le `tx` d'une transaction — même type que dans `utils/rankings.ts`.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const HOUR_MS = 60 * 60 * 1000;
// Même grille que `createMatchSchema` (:00, :15, :30, :45, 0 s, 0 ms). Comme l'époque Unix
// est alignée sur la minute UTC, arrondir au multiple de 15 min suffit à tomber dessus.
const SLOT_GRID_MS = 15 * 60 * 1000;

/**
 * Tire 3 maps distinctes dans le pool du jeu — **exactement** la requête de `POST /matches`.
 * Un jeu sans pool (lol, rl, chess) rend `[]` : c'est pour ça que les matchs de démo vivent
 * sur cs2, le seul moyen de voir la section « maps » rendue côté front.
 */
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
 * Crée un match + ses sides + les joueurs alignés, dans la forme que produit le vrai cycle :
 * side 0 = le créateur du créneau, side 1 = celui qui a accepté (absent tant que le slot est
 * `pending`), et une ligne `match_participants` par joueur de la lineup.
 *
 * Renvoie les ids des sides dans l'ordre des lineups reçues — les états « soumis / litige /
 * terminé » en ont besoin pour désigner un vainqueur.
 */
async function insertDemoMatch(
  tx: Tx,
  opts: {
    ladderId: string;
    status: NonNullable<typeof matchesTable.$inferInsert.status>;
    scheduledAt: Date;
    startedAt?: Date;
    maps: string[];
    lineups: { teamId: string; players: string[] }[];
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

async function main() {
  // --- Ladders cibles : cherchés par (game, format), PAS par id (les uuid
  // diffèrent d'une base à l'autre). ---
  const [chess] = await db
    .select()
    .from(laddersTable)
    .where(and(eq(laddersTable.gameId, 'chess'), eq(laddersTable.format, '1v1')));
  if (!chess) {
    console.error('❌ Ladder chess 1v1 introuvable — as-tu lancé les migrations ?');
    process.exit(1);
  }

  // --- Faux users ---
  // `password_hash` : voir LOGIN_PSEUDOS ci-dessus — seuls ces comptes-là servent AUSSI à
  // se connecter pour dérouler les matchs de démo dans l'app. Les autres restent à `null`,
  // donc inertes : aucun mot de passe ne peut ouvrir une session dessus.
  await db
    .insert(usersTable)
    .values(
      fakeUsers.map((u) => ({
        pseudo: u.pseudo,
        email: `${u.pseudo}@dev.local`,
        displayName: u.displayName,
        passwordHash: LOGIN_PSEUDOS.includes(u.pseudo) ? FIXTURE_HASH : null,
      })),
    )
    .onConflictDoNothing();

  // ⚠️ Rattrapage OBLIGATOIRE : `onConflictDoNothing` saute la LIGNE ENTIÈRE, il ne
  // complète pas les colonnes manquantes. Sur une base semée AVANT que ces comptes
  // deviennent connectables — donc celle de tout coéquipier qui a déjà lancé ce script —
  // les users existent déjà sans hash, et l'insert ci-dessus ne les répare pas. Le script
  // afficherait alors des identifiants qui rendent 401, en orientant le diagnostic vers le
  // mot de passe au lieu de l'ancienneté de la ligne.
  // Le `IS NULL` rend la passe inoffensive : un compte qui aurait le pseudo `alice` et un
  // VRAI mot de passe n'est jamais écrasé.
  await db
    .update(usersTable)
    .set({ passwordHash: FIXTURE_HASH })
    .where(and(inArray(usersTable.pseudo, LOGIN_PSEUDOS), isNull(usersTable.passwordHash)));

  // ⚠️ Passe SYMÉTRIQUE, même cause : sur une base semée quand TOUS les faux comptes
  // recevaient un mot de passe, les figurants restent connectables — le `null` du `.values()`
  // ci-dessus ne concerne que les lignes réellement insérées, jamais celles que le
  // `onConflictDoNothing` saute. Sans cette passe, restreindre les connexions à
  // LOGIN_PSEUDOS ne servirait à rien sur les bases existantes.
  // On ne retire QUE le hash de fixture, et seulement sur les pseudos du seed : un compte
  // homonyme avec un vrai mot de passe n'est jamais déconnecté.
  await db
    .update(usersTable)
    .set({ passwordHash: null })
    .where(
      and(
        inArray(
          usersTable.pseudo,
          fakeUsers.map((u) => u.pseudo),
        ),
        notInArray(usersTable.pseudo, LOGIN_PSEUDOS),
        eq(usersTable.passwordHash, FIXTURE_HASH),
      ),
    );

  // Re-select pour récupérer les id générés par la base.
  const pseudos = fakeUsers.map((u) => u.pseudo);
  const dbUsers = await db
    .select({ id: usersTable.id, pseudo: usersTable.pseudo })
    .from(usersTable)
    .where(inArray(usersTable.pseudo, pseudos));
  const idByPseudo = new Map(dbUsers.map((u) => [u.pseudo, u.id]));

  // --- Classement joueurs sur chess 1v1 ---
  await db
    .insert(rankingsTable)
    .values(
      fakeUsers.map((u) => ({
        ladderId: chess.id,
        userId: idByPseudo.get(u.pseudo)!,
        elo: u.elo,
        wins: u.wins,
        losses: u.losses,
      })),
    )
    .onConflictDoNothing();

  // --- Équipes + classement équipes sur cs2 5v5 (si le ladder existe) ---
  const [cs2] = await db
    .select()
    .from(laddersTable)
    .where(and(eq(laddersTable.gameId, 'cs2'), eq(laddersTable.format, '5v5')));

  let demoMatchCount = 0;

  if (cs2) {
    await db
      .insert(teamsTable)
      .values(
        fakeTeams.map((t) => ({ ladderId: cs2.id, name: t.name, captainId: idByPseudo.get(t.captain)! })),
      )
      .onConflictDoNothing();

    const teamNames = fakeTeams.map((t) => t.name);
    const dbTeams = await db
      .select({ id: teamsTable.id, name: teamsTable.name })
      .from(teamsTable)
      .where(and(eq(teamsTable.ladderId, cs2.id), inArray(teamsTable.name, teamNames)));
    const teamIdByName = new Map(dbTeams.map((t) => [t.name, t.id]));

    await db
      .insert(rankingsTable)
      .values(
        fakeTeams.map((t) => ({
          ladderId: cs2.id,
          teamId: teamIdByName.get(t.name)!,
          elo: t.elo,
          wins: t.wins,
          losses: t.losses,
        })),
      )
      .onConflictDoNothing();

    // --- Rosters ---
    await db
      .insert(teamMembersTable)
      .values(
        Object.entries(teamRosters).flatMap(([teamName, roster]) =>
          roster.map((pseudo) => ({
            teamId: teamIdByName.get(teamName)!,
            userId: idByPseudo.get(pseudo)!,
            ladderId: cs2.id,
          })),
        ),
      )
      .onConflictDoNothing();

    // --- §5.1 : comptes externes liés ---
    // cs2 impose le provider `steam` : sans ce lien, `POST /matches` REFUSE d'aligner ces
    // joueurs (400 `every selected player must have a linked steam account`). Le seed écrit
    // donc ce que le vrai cycle exige, sinon les matchs de démo décriraient un état que
    // l'API n'aurait jamais pu produire — et rouvrir un créneau depuis l'UI échouerait.
    // `verified: false` : personne n'a réellement prouvé la possession du compte (la
    // vérification OAuth Steam/Riot n'est pas encore branchée).
    const rosterPseudos = [...new Set(Object.values(teamRosters).flat())];
    await db
      .insert(userExternalAccountsTable)
      .values(
        rosterPseudos.map((pseudo) => ({
          userId: idByPseudo.get(pseudo)!,
          provider: 'steam' as const,
          externalId: `seed-steam-${pseudo}`,
        })),
      )
      .onConflictDoNothing();

    // ----------------------------------------------------------------------------------
    // --- B16 : six matchs de démo, un par état du cycle ---
    //
    // Pourquoi : atteindre « en attente de confirmation » à la main coûte 2 comptes, 2
    // équipes, une invitation, un créneau, une acceptation et une soumission. Personne ne
    // le refait deux fois, donc l'écran n'est jamais vérifié.
    //
    // Les états sont écrits DIRECTEMENT (le seed ne passe pas par HTTP) mais respectent les
    // invariants des handlers : grille de 15 min, `scheduled_at` comme seule référence
    // temporelle (invariant #4), créneaux espacés de plus d'un `lockout_minutes` pour que
    // §5.2 soit satisfait (invariant #3 — inégalités strictes), lineups ⊆ roster, et
    // `completeMatchWithElo()` RÉUTILISÉ pour le match terminé plutôt que recopié.
    // ----------------------------------------------------------------------------------
    const home = teamIdByName.get(DEMO_HOME)!;
    const away = teamIdByName.get(DEMO_AWAY)!;
    const homeLineup = { teamId: home, players: teamRosters[DEMO_HOME]!.map((p) => idByPseudo.get(p)!) };
    const awayLineup = { teamId: away, players: teamRosters[DEMO_AWAY]!.map((p) => idByPseudo.get(p)!) };

    // 1) Purge de la production PRÉCÉDENTE du seed — c'est ce qui rend le bloc rejouable.
    //    Un match n'a aucune clé naturelle : `onConflictDoNothing` ne peut rien pour lui, et
    //    sans purge chaque relance empilerait 6 matchs de plus. On efface par les SIDES (le
    //    seul lien vers une équipe) ; sides, participants et disputes partent en cascade.
    //    ⚠️ Efface donc AUSSI les matchs que tu aurais joués à la main avec ces 2 équipes.
    //    ⚠️ LIMITE CONNUE, assumée : la purge porte sur « Alpha OU Bravo » alors que l'étape 2
    //    ne remet à zéro QUE ces deux équipes. Un match Alpha–Charlie monté à la main est donc
    //    effacé sans que le classement de Charlie soit corrigé — il garde un Elo gagné sur un
    //    match qui n'existe plus. Rétrécir la purge aux matchs Alpha–Bravo ne ferait que
    //    déplacer l'incohérence sur Alpha. La vraie réponse est un clear COMPLET (tous les
    //    matchs, tous les classements remis à `default(1000)`), prévu dans le ticket « seed
    //    propre » — ne pas rafistoler ici en attendant.
    const previous = await db
      .selectDistinct({ id: matchSidesTable.matchId })
      .from(matchSidesTable)
      .where(inArray(matchSidesTable.teamId, [home, away]));
    if (previous.length)
      await db.delete(matchesTable).where(
        inArray(
          matchesTable.id,
          previous.map((p) => p.id),
        ),
      );

    // 2) Remise du classement des 2 équipes à sa valeur de fixture. Le match terminé de
    //    l'étape 3 applique un VRAI calcul d'Elo sur `rankings` : sans cette remise, chaque
    //    relance ajouterait une victoire et déplacerait l'Elo un cran plus loin.
    for (const name of [DEMO_HOME, DEMO_AWAY]) {
      const fixture = fakeTeams.find((t) => t.name === name)!;
      await db
        .update(rankingsTable)
        .set({ elo: fixture.elo, wins: fixture.wins, losses: fixture.losses, lastMatchAt: null })
        .where(and(eq(rankingsTable.ladderId, cs2.id), eq(rankingsTable.teamId, teamIdByName.get(name)!)));
    }

    // 3) Les six matchs. Les créneaux sont RELATIFS à l'instant du seed (« dans 3 h », « il y
    //    a 2 h ») : relancer le script rafraîchit donc les états « avant / après l'heure ».
    const base = new Date(Math.ceil(Date.now() / SLOT_GRID_MS) * SLOT_GRID_MS);
    const at = (hours: number) => new Date(base.getTime() + hours * HOUR_MS);
    // Espacement : |Δ| ≥ 3 h alors que le lockout cs2 5v5 vaut 60 min → aucun de ces matchs
    // n'est en conflit §5.2 avec un autre. Le match terminé, lui, n'engage plus personne.
    const KICKOFFS = {
      // ⚠️ 3 JOURS, pas 3 heures. Le ménage automatique du serveur annule un créneau encore
      // ouvert dès qu'il passe sous 15 min de son coup d'envoi (plus personne ne peut
      // l'accepter) : à 3 h, l'état « créneau ouvert » disparaissait 2 h 45 après le seed,
      // donc une base préparée la veille n'avait plus rien à montrer le lendemain matin.
      // Rien ne plafonne l'avance côté API (`createMatchSchema` n'impose qu'un MINIMUM de
      // 15 min), l'état reste donc parfaitement légal.
      pending: at(24 * 3),
      upcoming: at(1),
      live: at(-2),
      awaiting: at(-5),
      disputed: at(-8),
      completed: at(-26),
    };

    // Un tirage INDÉPENDANT par match (comme `POST /matches`) : les 6 matchs de démo
    // n'affichent pas la même triplette de maps.
    const maps = await Promise.all(Array.from({ length: 6 }, () => drawMaps(cs2.gameId)));

    const created = await db.transaction(async (tx) => {
      // (a) CRÉNEAU OUVERT — un seul side : personne n'a encore accepté. Posé à +3 h, donc
      //     très au-dessus des 15 min sous lesquelles `cancelExpiredSlots` l'annulerait.
      const slot = await insertDemoMatch(tx, {
        ladderId: cs2.id,
        status: 'pending',
        scheduledAt: KICKOFFS.pending,
        maps: maps[0]!,
        lineups: [homeLineup],
      });

      // (b) ACCEPTÉ, AVANT L'HEURE — `started_at` = l'instant de l'acceptation, jamais
      //     l'heure du match (invariant #4 : aucune règle ne lit `started_at`).
      const upcoming = await insertDemoMatch(tx, {
        ladderId: cs2.id,
        status: 'in_progress',
        scheduledAt: KICKOFFS.upcoming,
        startedAt: new Date(),
        maps: maps[1]!,
        lineups: [homeLineup, awayLineup],
      });

      // (c) ACCEPTÉ, APRÈS L'HEURE — le coup d'envoi est passé, les deux camps peuvent
      //     désormais soumettre un résultat (`POST /matches/:id/result` refuse avant).
      const live = await insertDemoMatch(tx, {
        ladderId: cs2.id,
        status: 'in_progress',
        scheduledAt: KICKOFFS.live,
        startedAt: new Date(KICKOFFS.live.getTime() - 2 * HOUR_MS),
        maps: maps[2]!,
        lineups: [homeLineup, awayLineup],
      });

      // (d) EN ATTENTE DE CONFIRMATION — c'est le match qui démontre le bouton
      //     « Confirmer » de FT-4. C'est le camp AWAY qui a soumis : le camp HOME (alice,
      //     capitaine de Team Alpha) est donc celui qui a quelque chose à confirmer, et
      //     confirmer = renvoyer le MIROIR de cette soumission (winnerSideId identique,
      //     scoreSelf/scoreOpponent croisés). Un score différent partirait en litige.
      const awaiting = await insertDemoMatch(tx, {
        ladderId: cs2.id,
        status: 'awaiting_confirmation',
        scheduledAt: KICKOFFS.awaiting,
        startedAt: new Date(KICKOFFS.awaiting.getTime() - 2 * HOUR_MS),
        maps: maps[3]!,
        lineups: [homeLineup, awayLineup],
      });
      await tx
        .update(matchSidesTable)
        .set({
          submittedAt: new Date(KICKOFFS.awaiting.getTime() + 80 * 60 * 1000),
          submittedWinnerSideId: awaiting.sideIds[1]!,
          submittedScoreSelf: WINS_REQUIRED,
          submittedScoreOpponent: 0,
        })
        .where(eq(matchSidesTable.id, awaiting.sideIds[1]!));

      // (e) EN LITIGE — les deux camps ont soumis et se contredisent (chacun se déclare
      //     vainqueur) : la route bascule le match en `disputed` et OUVRE une dispute dans
      //     la même transaction. Le seed reproduit les deux écritures.
      const disputed = await insertDemoMatch(tx, {
        ladderId: cs2.id,
        status: 'disputed',
        scheduledAt: KICKOFFS.disputed,
        startedAt: new Date(KICKOFFS.disputed.getTime() - 2 * HOUR_MS),
        maps: maps[4]!,
        lineups: [homeLineup, awayLineup],
      });
      await tx
        .update(matchSidesTable)
        .set({
          submittedAt: new Date(KICKOFFS.disputed.getTime() + 75 * 60 * 1000),
          submittedWinnerSideId: disputed.sideIds[0]!,
          submittedScoreSelf: WINS_REQUIRED,
          submittedScoreOpponent: WINS_REQUIRED - 1,
        })
        .where(eq(matchSidesTable.id, disputed.sideIds[0]!));
      await tx
        .update(matchSidesTable)
        .set({
          submittedAt: new Date(KICKOFFS.disputed.getTime() + 82 * 60 * 1000),
          submittedWinnerSideId: disputed.sideIds[1]!,
          submittedScoreSelf: WINS_REQUIRED,
          submittedScoreOpponent: 0,
        })
        .where(eq(matchSidesTable.id, disputed.sideIds[1]!));
      await tx
        .insert(disputesTable)
        .values({
          matchId: disputed.id,
          createdAt: new Date(KICKOFFS.disputed.getTime() + 82 * 60 * 1000),
        });

      // (f) TERMINÉ — les deux camps ont soumis LE MÊME verdict (même vainqueur, scores
      //     croisés cohérents) → clôture + Elo. On appelle `completeMatchWithElo()`, le
      //     helper que partagent déjà la route, le job d'auto-confirmation et l'arbitrage
      //     admin : c'est lui qui écrit `winner_side_id`, `score`, `elo_delta`, `elo_after`
      //     et qui met à jour `rankings`. Recopier son calcul ici serait une 4ᵉ vérité.
      const completed = await insertDemoMatch(tx, {
        ladderId: cs2.id,
        status: 'in_progress',
        scheduledAt: KICKOFFS.completed,
        startedAt: new Date(KICKOFFS.completed.getTime() - 2 * HOUR_MS),
        maps: maps[5]!,
        lineups: [homeLineup, awayLineup],
      });
      const submittedHome = new Date(KICKOFFS.completed.getTime() + 70 * 60 * 1000);
      const confirmedAway = new Date(KICKOFFS.completed.getTime() + 76 * 60 * 1000);
      await tx
        .update(matchSidesTable)
        .set({
          submittedAt: submittedHome,
          submittedWinnerSideId: completed.sideIds[0]!,
          submittedScoreSelf: WINS_REQUIRED,
          submittedScoreOpponent: WINS_REQUIRED - 1,
        })
        .where(eq(matchSidesTable.id, completed.sideIds[0]!));
      await tx
        .update(matchSidesTable)
        .set({
          submittedAt: confirmedAway,
          submittedWinnerSideId: completed.sideIds[0]!,
          submittedScoreSelf: WINS_REQUIRED - 1,
          submittedScoreOpponent: WINS_REQUIRED,
        })
        .where(eq(matchSidesTable.id, completed.sideIds[1]!));
      await completeMatchWithElo(
        tx,
        completed.id,
        cs2.id,
        completed.sideIds[0]!,
        WINS_REQUIRED,
        WINS_REQUIRED - 1,
      );
      // `completeMatchWithElo` horodate à `now` — exact en production (on clôt au moment où
      // le 2e camp confirme), faux pour une fixture jouée hier. On réaligne la clôture ET le
      // `last_match_at` des deux classements sur la 2e soumission, sinon la page équipe
      // afficherait « terminé à l'instant » sur un match daté de la veille.
      await tx
        .update(matchesTable)
        .set({ completedAt: confirmedAway })
        .where(eq(matchesTable.id, completed.id));
      await tx
        .update(rankingsTable)
        .set({ lastMatchAt: confirmedAway })
        .where(and(eq(rankingsTable.ladderId, cs2.id), inArray(rankingsTable.teamId, [home, away])));

      return { slot, upcoming, live, awaiting, disputed, completed };
    });

    demoMatchCount = Object.keys(created).length;
    console.log(`\n🎮 6 matchs de démo ${DEMO_HOME} vs ${DEMO_AWAY} (cs2 5v5) :`);
    console.log(`   créneau ouvert          ${created.slot.id}   (${KICKOFFS.pending.toISOString()})`);
    console.log(`   accepté, avant l'heure  ${created.upcoming.id}   (${KICKOFFS.upcoming.toISOString()})`);
    console.log(`   accepté, après l'heure  ${created.live.id}   (${KICKOFFS.live.toISOString()})`);
    console.log(`   en attente de confirm.  ${created.awaiting.id}   (${KICKOFFS.awaiting.toISOString()})`);
    console.log(`   en litige               ${created.disputed.id}   (${KICKOFFS.disputed.toISOString()})`);
    console.log(`   terminé (maps + Elo)    ${created.completed.id}   (${KICKOFFS.completed.toISOString()})`);
    console.log(`\n🔑 Les 3 SEULS comptes connectables (mot de passe : ${FIXTURE_PASSWORD}) :`);
    console.log(
      `   alice@dev.local   capitaine ${DEMO_HOME} — c'est ELLE qui a un résultat à confirmer`,
    );
    console.log(`   bob@dev.local     capitaine ${DEMO_AWAY} — le camp adverse`);
    console.log(
      `   carol@dev.local   capitaine Team Charlie — le TIERS : ne voit pas le créneau ouvert, 403 sur un match non terminé`,
    );
    console.log(`   (les 8 autres joueurs n'ont pas de mot de passe : remplissage de lineup)`);
  }

  console.log(
    `\n✅ seed-dev terminé : ${fakeUsers.length} joueurs sur chess 1v1` +
      (cs2 ? `, ${fakeTeams.length} équipes sur cs2 5v5, ${demoMatchCount} matchs de démo` : ''),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
