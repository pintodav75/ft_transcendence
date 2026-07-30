/**
 * `/matchmaking` — [F-MM] : le tableau des créneaux ouverts, et le SEUL endroit de l'app où
 * un créneau peut être **accepté** (`POST /matches/{id}/accept`, que le front n'appelait
 * nulle part avant ce ticket).
 *
 * Ce que ce scénario garde :
 *
 *   - **AUCUN bouton que l'API refuserait** : le nombre de boutons « Accept » à l'écran est
 *     comparé, case décochée, au nombre de créneaux dont l'API dit `canAccept: true`. C'est
 *     le check central du ticket — un 4xx provoqué par un bouton laisse une ligne rouge dans
 *     la console de Chrome, motif de rejet du projet ;
 *   - **l'anonymat B5b** : ni le nom de l'équipe qui a ouvert le créneau, ni les maps. On
 *     accepte sans savoir contre qui — c'est ce qui protège l'Elo ;
 *   - **les six raisons de refus ne sont pas interchangeables** : `no_team`,
 *     `roster_too_small` et `roster_not_linked` sont produites À LA SUITE sur LE MÊME créneau,
 *     en ne changeant que la donnée, et chacune doit rendre sa phrase ET son lien de remède.
 *     ⚠️ Les deux dernières sont distinctes **à dessein** (« recrute » vs « fais lier les
 *     comptes ») : les fusionner à l'affichage enverrait un capitaine réparer la mauvaise
 *     chose ;
 *   - les deux chemins d'acceptation, qui n'ont rien en commun : **2v2+** passe par un
 *     panneau de composition (disclosure inline), **1v1** par une confirmation directe et
 *     **sans corps de requête** ;
 *   - `?ladderId=` inconnu : écran honnête et **zéro requête portant cet uuid** — `GET
 *     /matches` répondrait 404, donc la validation se fait sur la liste des ladders DÉJÀ en
 *     cache (même discipline que le slug de jeu de [F-GAMES]).
 *
 * ⚠️ IL NE DÉPEND PAS DU SEED, et c'est délibéré : il fabrique ses deux équipes, ses quatre
 * comptes et ses deux créneaux par API. La base semée porte pourtant un créneau cs2 5v5 ouvert
 * (Team Alpha) — s'il est là il apparaît sur le tableau, et **le scénario ne l'accepte
 * JAMAIS** : `match-detail` exige les 7 états cs2 du seed, l'accepter les détruirait.
 * Les comptages sont donc tous relatifs à ce que l'API répond au même instant, jamais à un
 * nombre absolu.
 *
 * ⚠️ TEARDOWN OBLIGATOIRE. Les deux matchs acceptés sont `in_progress`, donc ils ENGAGENT
 * leurs comptes : `DELETE /users/me` les refuserait en 409 `engaged_in_match`, et
 * `DELETE /teams/:id` refuserait les équipes en 409 `team_engaged_in_match`
 * (`purgeUserMatches()` du runner ne sait annuler qu'un slot encore `pending`). On force donc
 * les matchs hors des statuts engageants puis on efface les lignes, **même si un check a
 * échoué**.
 */
import { assertUuid } from '../sql.mjs';

export const name = 'matchmaking';
export const surface =
  '/matchmaking — tableau des créneaux ouverts, verdict canAccept, acceptation 1v1 et 2v2+ (F-MM)';

const UNKNOWN_LADDER = '33333333-3333-4333-8333-333333333333';

/**
 * `waitFor` qui rend `false` au lieu de lever. Un `waitFor` nu ferait sortir le harnais en
 * **exit 2** (« le harnais a échoué ») là où on veut un rouge imputable au ticket.
 */
const appears = (locator, timeout = 10000) =>
  locator
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);

/**
 * Un coup d'envoi VALIDE côté serveur : sur la grille des quarts, secondes et ms à zéro, et à
 * plus de 15 minutes — d'où l'arrondi AU QUART SUPÉRIEUR, le même que `future()` dans
 * `backend/tests/helpers.py`.
 */
function futureQuarter(hoursAhead) {
  const at = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  at.setUTCSeconds(0, 0);
  at.setUTCMinutes(at.getUTCMinutes() + ((15 - (at.getUTCMinutes() % 15)) % 15));
  return at.toISOString();
}

export async function run({
  page,
  setPhase,
  step,
  awaitAnnouncement,
  countRequests,
  createUser,
  expectHttp,
  user,
  ORIGIN,
  sql,
}) {
  /**
   * Appel API direct, lu par NODE : ces requêtes ne traversent pas la console auditée. C'est
   * la source de vérité contre laquelle l'écran est comparé.
   *
   * ⚠️ `content-type: application/json` UNIQUEMENT s'il y a un corps : Fastify refuse en 400
   * (`FST_ERR_CTP_EMPTY_JSON_BODY`) une requête qui annonce du JSON sans en envoyer — et
   * `POST /matches/:id/accept` se passe de corps en 1v1.
   */
  const api = (as, path, init = {}) => {
    const headers = { authorization: `Bearer ${as.accessToken}`, ...(init.headers ?? {}) };
    if (init.body) headers['content-type'] = 'application/json';
    return fetch(`${ORIGIN}/api${path}`, { ...init, headers });
  };
  const json = async (res) => {
    if (!res.ok) throw new Error(`${res.url} -> ${res.status} : ${await res.text()}`);
    return res.json();
  };
  const link = (as, provider) =>
    api(as, '/users/me/external-accounts', {
      method: 'POST',
      body: JSON.stringify({ provider, externalId: `AUDIT-MM-${provider}-${as.stamp}` }),
    });
  const unlink = (as, provider) =>
    api(as, `/users/me/external-accounts/${provider}`, { method: 'DELETE' });
  const idOf = (as) => api(as, '/users/me').then(json).then(({ user: me }) => me.id);

  const main = page.locator('main');
  /** Tous les boutons d'acceptation de la page : un `aria-label` qui commence par ce texte. */
  const acceptButtons = main.locator('button[aria-label^="Accept the slot on"]');
  /**
   * LE tableau, nommé — et pas n'importe quelle liste de la page.
   * ⚠️ `LineupPicker` rend ses candidats en `<li>` : un `getByRole('listitem')` non scopé n'est
   * juste que tant qu'aucun panneau n'est ouvert, et un futur ajout le rendrait FAUX sans le
   * rendre ROUGE.
   */
  const board = main.getByRole('list', { name: 'Open slots' });

  /**
   * 🚨 `/matchmaking` EST UN TABLEAU **GLOBAL**, ET LA BASE DE DEV EST **PARTAGÉE** — ce
   * scénario n'est donc jamais seul sur ses ladders, et il n'a pas le droit de le supposer.
   *
   * Vécu le 30/07 : un coéquipier avait ouvert à la main quatre créneaux de démo, dont un sur
   * le même 2v2 que la fixture. `filter({ hasText: ladderName })` a résolu **2 lignes**,
   * Playwright a levé (« strict mode violation ») et la campagne complète est sortie en
   * **`exit 2`** — un harnais en échec, qui se lit comme un problème d'environnement, et qui
   * bloquait TOUT LE MONDE. Le défaut n'était pas la donnée du coéquipier : c'était ce
   * sélecteur, qui disait « la ligne de ce ladder » là où il voulait dire « MA ligne ».
   *
   * 🔑 LE DISCRIMINANT EST LE COUP D'ENVOI, parce que c'est la seule chose que la ligne
   * affiche et que le run **choisit** (l'anonymat B5b interdit tout nom sur cette ligne :
   * ni équipe, ni maps, ni Elo — voir `OpenSlotRow`). Chaque créneau ouvert ici s'enregistre,
   * et `rowOf()` ne regarde que les lignes dont l'heure est l'une des siennes.
   *
   * ⚠️ Si le libellé venait à ne plus correspondre (`formatMatchDate` change de style), les
   * lignes résolvent à **0** : les checks sortent ROUGES, jamais en `exit 2`. C'est le mode
   * d'échec qu'on veut — imputable et lisible.
   */
  const kickOffFormat = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  /** Miroir EXACT de `formatMatchDate(iso, 'long')` (`frontend/src/lib/match-detail.ts`). */
  const kickOff = (iso) => kickOffFormat.format(new Date(iso));
  const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Les coups d'envoi ouverts PAR CE RUN, par ladder. */
  const myKickOffs = new Map();
  const registerSlot = (ladderName, iso) => {
    const times = myKickOffs.get(ladderName) ?? new Set();
    times.add(kickOff(iso));
    myKickOffs.set(ladderName, times);
    return iso;
  };
  const forgetSlot = (ladderName, iso) => myKickOffs.get(ladderName)?.delete(kickOff(iso));

  /**
   * MA ligne sur un ladder — jamais « la première », jamais « n'importe laquelle de ce
   * ladder ». `at` restreint à UN créneau précis quand le run en a ouvert plusieurs ici.
   */
  const rowOf = (ladderName, at) => {
    const times = at ? [kickOff(at)] : [...(myKickOffs.get(ladderName) ?? [])];
    if (times.length === 0) {
      // Erreur de HARNAIS : viser un ladder sans y avoir ouvert de créneau ne mesure rien.
      throw new Error(`rowOf('${ladderName}') : aucun créneau enregistré pour ce ladder`);
    }
    return board
      .getByRole('listitem')
      .filter({ hasText: ladderName })
      .filter({ hasText: new RegExp(times.map(escapeRe).join('|')) });
  };
  /** Les créneaux tels que l'API les voit POUR LE COMPTE DU RUN, au même instant. */
  const boardFromApi = (query = '') => api(user, `/matches?limit=50${query}`).then(json);

  const matchIds = [];

  // ------------------------------------------------------------- §0 mise en place
  setPhase('0. mise en place (API directe) : 2 équipes, 4 comptes, 2 créneaux');

  const { ladders } = await api(user, '/ladders').then(json);
  // Trouvés par leur DONNÉE (format), jamais par un uuid en dur : les ids viennent des
  // migrations et diffèrent d'une base à l'autre.
  const teamLadder = ladders.find((l) => l.format === '2v2');
  // Un SECOND ladder d'équipe, indispensable au refus `not_captain` : un joueur ne peut être
  // que dans UNE équipe par ladder (`team_members_user_ladder_unique`), donc le compte du run
  // ne peut pas être à la fois simple membre ici et capitaine là.
  const otherLadder = ladders.find((l) => l.format === '2v2' && l.id !== teamLadder?.id);
  const soloLadder = ladders.find((l) => l.gameId === 'chess' && l.format === '1v1');
  if (!teamLadder || !otherLadder || !soloLadder) {
    // Erreur de HARNAIS (exit 2), pas un check rouge : sans ces ladders tout ce qui suit
    // mesurerait le vide.
    throw new Error(
      `ladders manquants — 2v2: ${Boolean(teamLadder)}, 2e 2v2: ${Boolean(otherLadder)}, ` +
        `chess 1v1: ${Boolean(soloLadder)} (${ladders.length} ladder(s) vus)`,
    );
  }

  const { games } = await api(user, '/games').then(json);
  const teamProvider = games.find((g) => g.id === teamLadder.gameId)?.requiredProvider;
  const otherProvider = games.find((g) => g.id === otherLadder.gameId)?.requiredProvider;
  if (!teamProvider || !otherProvider) {
    throw new Error(`requiredProvider manquant (${teamLadder.gameId} / ${otherLadder.gameId})`);
  }

  // L'ouvreur et son coéquipier (l'équipe d'en face), puis le futur coéquipier du compte du
  // run. Le compte du run est l'ACCEPTEUR : c'est lui qui pilote le navigateur.
  const opener = await createUser();
  const openerMate = await createUser();
  const myMate = await createUser();

  const links = await Promise.all([
    link(opener, teamProvider),
    link(openerMate, teamProvider),
    link(user, teamProvider),
    link(opener, 'chess_com'),
    link(user, 'chess_com'),
    // Le second ladder d'équipe peut exiger un autre provider (cs2 -> steam, rl -> epic,
    // val -> riot) : on lie les quatre comptes qui y joueront.
    link(opener, otherProvider),
    link(openerMate, otherProvider),
    link(user, otherProvider),
    link(myMate, otherProvider),
  ]);
  const allLinked = links.every((res) => res.status === 201);

  /** Crée une équipe et y fait entrer un joueur par le vrai cycle d'invitation (B-INV). */
  const teamWith = async (captain, ladderId, name, mate) => {
    const { team } = await api(captain, '/teams', {
      method: 'POST',
      body: JSON.stringify({ ladderId, name }),
    }).then(json);
    const { invitation } = await api(captain, `/teams/${team.id}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ userId: await idOf(mate) }),
    }).then(json);
    await api(mate, `/teams/invitations/${invitation.id}/accept`, { method: 'POST' });
    return team;
  };

  // L'équipe adverse, complète et liée : c'est elle qui ouvre le créneau 2v2.
  const theirTeam = await teamWith(opener, teamLadder.id, `MM Openers ${user.stamp}`, openerMate);

  // Sur le SECOND ladder : une équipe adverse qui ouvre un créneau, et une équipe dont le
  // compte du run est simple MEMBRE — c'est tout le montage du refus `not_captain`.
  const otherTheirTeam = await teamWith(
    opener,
    otherLadder.id,
    `MM Openers B ${user.stamp}`,
    openerMate,
  );
  const notMyTeam = await teamWith(myMate, otherLadder.id, `MM Benched ${user.stamp}`, user);

  const teamSlotAt = registerSlot(teamLadder.name, futureQuarter(5));
  const { match: teamSlot } = await api(opener, '/matches', {
    method: 'POST',
    body: JSON.stringify({
      ladderId: teamLadder.id,
      scheduledAt: teamSlotAt,
      lineup: [await idOf(opener), await idOf(openerMate)],
    }),
  }).then(json);
  matchIds.push(assertUuid(teamSlot.id, 'créneau 2v2'));

  const { match: otherSlot } = await api(opener, '/matches', {
    method: 'POST',
    body: JSON.stringify({
      ladderId: otherLadder.id,
      scheduledAt: registerSlot(otherLadder.name, futureQuarter(7)),
      lineup: [await idOf(opener), await idOf(openerMate)],
    }),
  }).then(json);
  matchIds.push(assertUuid(otherSlot.id, 'créneau 2v2 du second ladder'));

  // ⚠️ L'INSTANT EST RETENU, pas recalculé : le créneau concurrent du §13b doit tomber sur
  // EXACTEMENT la même fenêtre, et deux appels à `futureQuarter(2)` peuvent franchir un quart.
  const soloSlotAt = registerSlot(soloLadder.name, futureQuarter(2));
  const { match: soloSlot } = await api(opener, '/matches', {
    method: 'POST',
    body: JSON.stringify({ ladderId: soloLadder.id, scheduledAt: soloSlotAt }),
  }).then(json);
  matchIds.push(assertUuid(soloSlot.id, 'créneau 1v1'));

  step(
    'MM0',
    allLinked && matchIds.length === 3,
    `comptes externes liés : ${links.map((r) => r.status).join('/')} (201 attendus) ; ` +
      `créneaux ouverts par un tiers : ${teamLadder.name} (${teamProvider}), ${otherLadder.name} ` +
      `(${otherProvider}) et ${soloLadder.name} ; équipes : « ${theirTeam.name} », ` +
      `« ${otherTheirTeam.name} », « ${notMyTeam.name} » (le compte du run y est MEMBRE, pas capitaine)`,
  );

  try {
    // ------------------------------------------------- §1 le tableau, tel que l'API le voit
    setPhase('1. /matchmaking : chargement, une seule région live, la liste = l’API');
    await page.goto(`${ORIGIN}/matchmaking`, { waitUntil: 'networkidle' });
    const heading = await appears(main.getByRole('heading', { level: 1, name: 'Open slots' }));

    // Invariant #11 : UNE seule région live par écran, sinon deux se disputent la lecture et
    // un sélecteur `[role=status]` en `.first()` prend la première venue.
    const liveRegions = await main.locator('[role="status"]').count();
    step(
      'MM1',
      heading && liveRegions === 1,
      `titre « Open slots » rendu = ${heading}, régions live \`role="status"\` dans <main> : ${liveRegions} (exactement 1 attendue)`,
    );

    // La case est cochée par défaut : l'écran ne montre que l'acceptable. On compare à
    // l'API interrogée AU MÊME INSTANT, jamais à un nombre absolu — le seed peut porter son
    // propre créneau ouvert, et un autre scénario n'en crée pas.
    const acceptableApi = await boardFromApi('&acceptable=true');
    const shownRows = await board.getByRole('listitem').count();
    step(
      'MM2',
      shownRows === acceptableApi.slots.length,
      `case cochée : ${shownRows} ligne(s) à l’écran pour ${acceptableApi.slots.length} créneau(x) acceptable(s) selon l’API`,
    );

    // ----------------------------------------------------------- §2 anonymat (décision B5b)
    setPhase('2. anonymat : ni l’équipe créatrice, ni les maps');
    // On décoche pour avoir TOUT le tableau sous les yeux, y compris les créneaux refusés.
    const acceptableBox = main.getByLabel('Only slots I can accept');
    await acceptableBox.uncheck();
    await appears(rowOf(teamLadder.name).first());

    const boardText = (await main.innerText()).toLowerCase();
    const leaksTeam = boardText.includes(theirTeam.name.toLowerCase());
    // Les maps ne sont même pas dans la charge utile : ce check garde le rendu, pas l'API.
    const leaksMaps = ['ancient', 'mirage', 'inferno', 'nuke', 'anubis'].filter((m) =>
      boardText.includes(m),
    );
    step(
      'MM3',
      !leaksTeam && leaksMaps.length === 0,
      `équipe créatrice « ${theirTeam.name} » citée : ${leaksTeam} (false attendu), maps citées : ${leaksMaps.join(', ') || 'aucune'} — on accepte SANS savoir contre qui, c’est la décision B5b`,
    );

    // ------------------------- §3 LE CHECK CENTRAL : aucun bouton que l’API refuserait
    setPhase('3. case décochée : un bouton par créneau acceptable, et pas un de plus');
    const fullApi = await boardFromApi();
    const acceptableCount = fullApi.slots.filter((s) => s.canAccept).length;
    const refusedCount = fullApi.slots.length - acceptableCount;
    const buttons = await acceptButtons.count();
    step(
      'MM4',
      buttons === acceptableCount && refusedCount > 0,
      `boutons « Accept » : ${buttons} pour ${acceptableCount} créneau(x) acceptable(s) et ${refusedCount} refusé(s) — un refusé à l’écran EST attendu (> 0), sinon le check serait vert par construction`,
    );

    // ------------------------------------------------------------------- §3b 375 px
    // Mesuré ICI, tableau PLEIN (case décochée : acceptables et refusés, avec leurs phrases
    // et leurs liens). À la fin du run les deux créneaux sont acceptés et la liste peut être
    // vide — on mesurerait alors une page sans contenu.
    setPhase('3b. le tableau plein à 375 px');
    await page.setViewportSize({ width: 375, height: 900 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // 🔑 LA MESURE FAIBLE ET LA MESURE FORTE. `scrollWidth - clientWidth` était VERT PAR
    // CONSTRUCTION sur `LadderBoard` (leçon FT-3 : 73 px sortaient en silence, nom rendu à
    // 0 px de large) parce qu'un conteneur qui CLIPPE ne déborde jamais. On mesure donc aussi
    // ce qui est réellement rendu : le nom du ladder et la cible tactile du bouton.
    // ⚠️ COMPTER AVANT DE LIRE : `boundingBox()` sur un locator vide LÈVE -> exit 2.
    const nameNode = rowOf(teamLadder.name).getByText(teamLadder.name, { exact: true });
    const nameBox = (await nameNode.count()) === 1 ? await nameNode.first().boundingBox() : null;
    const btnNode = acceptButtons.first();
    const btnBox = (await btnNode.count()) >= 1 ? await btnNode.boundingBox() : null;
    step(
      'MM4b',
      overflow <= 0 &&
        (nameBox?.width ?? 0) >= 40 &&
        (btnBox?.width ?? 0) >= 24 &&
        (btnBox?.height ?? 0) >= 24,
      `375 px : débordement du document ${overflow}px (≤ 0) ; largeur RENDUE du nom de ladder ` +
        `${Math.round(nameBox?.width ?? -1)}px (≥ 40 attendu — un conteneur qui clippe ne déborde ` +
        `jamais, c’est le défaut FT-3) ; cible du bouton ${Math.round(btnBox?.width ?? -1)}×` +
        `${Math.round(btnBox?.height ?? -1)}px (≥ 24×24, WCAG 2.5.8)`,
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    // --------------------------------- §4 les raisons de refus, produites À LA SUITE
    // Le compte du run n'a aucune équipe : sur un ladder 2v2, c'est `no_team`.
    setPhase('4. refus `no_team` : la phrase ET le lien qui la résout');
    const teamRow = rowOf(teamLadder.name);
    const noTeamText = await teamRow.getByText('You have no team on').count();
    const createLink = teamRow.getByRole('link', { name: 'Create a team' });
    const createHref = (await createLink.count()) === 1 ? await createLink.getAttribute('href') : '';
    step(
      'MM5',
      noTeamText === 1 && createHref === `/teams?create=${teamLadder.id}`,
      `phrase « You have no team on… » : ${noTeamText} (1 attendu), lien de remède : « ${createHref} » (/teams?create=${teamLadder.id} attendu — le formulaire arrive AVEC le ladder pré-sélectionné)`,
    );

    // 🔑 LA 5e RAISON, sur le SECOND ladder : j'y ai une équipe, mais je n'en suis pas le
    // capitaine — et seul lui engage une équipe. Le remède n'est ni « crée une équipe » ni
    // « recrute » : c'est « va voir ton équipe », donc un lien vers ELLE.
    setPhase('4b. refus `not_captain` : membre d’une équipe, pas capitaine');
    const otherRow = rowOf(otherLadder.name);
    const notCaptainText = await otherRow.getByText('Only the captain of your team').count();
    const myTeamLink = otherRow.getByRole('link', { name: 'Open my team' });
    const myTeamHref =
      (await myTeamLink.count()) === 1 ? await myTeamLink.getAttribute('href') : '';
    const notCaptainButtons = await otherRow
      .locator('button[aria-label^="Accept the slot on"]')
      .count();
    step(
      'MM5b',
      notCaptainText === 1 && myTeamHref === `/teams/${notMyTeam.id}` && notCaptainButtons === 0,
      `phrase « Only the captain of your team… » : ${notCaptainText} (1 attendu), lien : ` +
        `« ${myTeamHref} » (/teams/${notMyTeam.id} attendu — MON équipe, pas celle d’en face), ` +
        `bouton « Accept » : ${notCaptainButtons} (0 attendu)`,
    );

    setPhase('5. refus `roster_too_small` : une équipe d’un seul joueur');
    const { team: myTeam } = await api(user, '/teams', {
      method: 'POST',
      body: JSON.stringify({ ladderId: teamLadder.id, name: `MM Takers ${user.stamp}` }),
    }).then(json);
    await page.reload({ waitUntil: 'networkidle' });
    await acceptableBox.uncheck();
    // Décocher relance la requête : la ligne était MASQUÉE tant que la case filtrait sur
    // l'acceptable, donc son apparition est la preuve que le nouveau tableau a atterri.
    await appears(teamRow.first());
    const tooSmall = await teamRow.getByText(`Your team needs 2 players`).count();
    const recruit = teamRow.getByRole('link', { name: 'Recruit players' });
    const recruitHref = (await recruit.count()) === 1 ? await recruit.getAttribute('href') : '';
    step(
      'MM6',
      tooSmall === 1 && recruitHref === `/teams/${myTeam.id}`,
      `phrase « Your team needs 2 players… » : ${tooSmall} (1 attendu), lien : « ${recruitHref} » (/teams/${myTeam.id} attendu)`,
    );

    // 🔑 LE CHECK QUI GARDE LA DISTINCTION. Le roster passe à 2 joueurs — la taille n'est
    // plus le problème — mais le second n'a PAS de compte lié. Le remède change, donc la
    // phrase et le lien changent : les fusionner enverrait recruter un 3e joueur pour rien.
    setPhase('6. refus `roster_not_linked` : roster assez grand, comptes insuffisants');
    const { invitation: myInvite } = await api(user, `/teams/${myTeam.id}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ userId: await idOf(myMate) }),
    }).then(json);
    await api(myMate, `/teams/invitations/${myInvite.id}/accept`, { method: 'POST' });
    await page.reload({ waitUntil: 'networkidle' });
    await acceptableBox.uncheck();
    await appears(teamRow.first());
    const notLinked = await teamRow.getByText('have linked their').count();
    const stillTooSmall = await teamRow.getByText('Your team needs 2 players').count();
    const roster = teamRow.getByRole('link', { name: 'See the roster' });
    const rosterHref = (await roster.count()) === 1 ? await roster.getAttribute('href') : '';
    step(
      'MM7',
      notLinked === 1 && stillTooSmall === 0 && rosterHref === `/teams/${myTeam.id}`,
      `phrase « …have linked their <provider> account » : ${notLinked} (1 attendu), ancienne phrase « needs 2 players » : ${stillTooSmall} (0 attendu — deux remèdes, deux libellés), lien : « ${rosterHref} »`,
    );

    // -------------------------------------- §7 le positif : la donnée retournée, le bouton
    setPhase('7. le roster est lié : le bouton apparaît, et lui seul change');
    await link(myMate, teamProvider);
    await page.reload({ waitUntil: 'networkidle' });
    const acceptOnTeamRow = teamRow.locator('button[aria-label^="Accept the slot on"]');
    const gotButton = await appears(acceptOnTeamRow);
    // ⚠️ COMPTER AVANT DE LIRE : `getAttribute()` sur un locator vide LÈVE -> exit 2
    // (« harnais en échec ») au lieu d'un rouge imputable au ticket.
    const collapsed = (await acceptOnTeamRow.count()) === 1
      ? await acceptOnTeamRow.getAttribute('aria-expanded')
      : null;
    step(
      'MM8',
      gotButton && collapsed === 'false',
      `après liaison du 2e joueur : bouton « Accept » rendu = ${gotButton}, aria-expanded « ${collapsed ?? '—'} » (false attendu — c’est un disclosure, pas une modale). C’est ce check qui prouve que MM5/MM6/MM7 peuvent virer au rouge`,
    );

    // ------------------------- §7b `GET /teams` en panne : un message, jamais un bouton mort
    // 🔑 CE CHEMIN ÉTAIT « VÉRIFIÉ PAR CONSTRUCTION », donc pas vérifié. La garde initiale
    // testait `myTeams !== undefined`, or `data` vaut `undefined` PENDANT LE CHARGEMENT COMME
    // EN CAS D'ÉCHEC : sur une panne on tombait sur un bouton « Accept » grisé à vie, sans un
    // mot d'explication, et le message prévu pour ce cas était inatteignable.
    // ⚠️ Nouvelle capacité du harnais : `page.route` fabrique la panne. C'est le pendant de
    // `sql.mjs` — certains états ne s'atteignent pas par l'API.
    setPhase('7b. `GET /teams` en panne : le message remplace le bouton');
    // ⚠️ Motif SANS ancre de fin : l'entrée console de Chrome poursuit après l'URL (« Failed to
    // load resource… »), donc `(\?|$)` ne matchait rien et les 500 étaient imputés au ticket.
    expectHttp(/\/api\/teams/, 'panne de GET /teams provoquée par le scénario');
    await page.route('**/api/teams', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal error' }),
      }),
    );
    await page.reload({ waitUntil: 'networkidle' });
    const rowOnPanne = rowOf(teamLadder.name);
    await appears(rowOnPanne.first());
    // ⚠️ ON ATTEND LE MESSAGE, on ne le compte pas tout de suite : `retryServerErrorsOnly`
    // réessaie 2 fois sur un 500, et pendant les réessais la requête est encore « pending » —
    // le bouton grisé est alors LÉGITIME (ça charge). Compter à `networkidle` mesurait cet
    // instant-là et rendait le check rouge sur un front correct. Vu rouge avant d'être corrigé.
    // ⚠️ COMPTÉ SUR MA LIGNE, PAS SUR LA PAGE. Le message est rendu par CHAQUE ligne d'un
    // format d'équipe : sur une base partagée, un créneau ouvert par quelqu'un d'autre en
    // ajoute un et le compte « 1 attendu » devient faux sans que rien ne soit cassé. Ce que le
    // check veut dire est « MA ligne explique au lieu d'offrir un bouton mort » — même
    // discipline que le comptage de boutons juste en dessous, qui était déjà scopé.
    await appears(rowOnPanne.getByText('Your teams could not be loaded'), 20000);
    const panneNotice = await rowOnPanne.getByText('Your teams could not be loaded').count();
    const deadButtons = await rowOnPanne.locator('button[aria-label^="Accept the slot on"]').count();
    step(
      'MM8b',
      panneNotice === 1 && deadButtons === 0,
      `panne de GET /teams : message d’explication ${panneNotice} (1 attendu), bouton « Accept » mort ${deadButtons} (0 attendu — un bouton grisé sans raison est un cul-de-sac muet)`,
    );
    await page.unroute('**/api/teams');
    await page.reload({ waitUntil: 'networkidle' });
    await appears(rowOf(teamLadder.name).locator('button[aria-label^="Accept the slot on"]'));

    // ----------------------------------------------- §8 filtres : jeu, puis ?ladderId=
    setPhase('8. filtre par jeu');
    await main.getByLabel('Game', { exact: true }).selectOption('chess');
    await appears(rowOf(soloLadder.name).first());
    const chessOnly = await board.getByRole('listitem').count();
    const teamRowsLeft = await rowOf(teamLadder.name).count();
    step(
      'MM9',
      chessOnly >= 1 && teamRowsLeft === 0,
      `filtre « chess » : ${chessOnly} ligne(s) (≥ 1 attendue), dont ${teamRowsLeft} sur ${teamLadder.name} (0 attendu)`,
    );

    // 🔑 LE SÉLECTEUR DE FORMAT SUIT LE JEU CHOISI. Les 4 formats du contrat ne sont pas les
    // formats d'un jeu : Valorant n'a pas de ladder 1v1, et proposer « 1v1 » là servait un
    // tableau vide sans dire si personne ne joue ou si la combinaison ne peut pas exister.
    // ⚠️ Piloté par la DONNÉE, pas par « val » en dur : on cherche dans la liste des ladders un
    // jeu auquel il manque un format, donc le check survit à un changement de catalogue.
    setPhase('8b. les formats proposés sont ceux du jeu choisi');
    const gapped = (() => {
      for (const id of new Set(ladders.map((l) => l.gameId))) {
        const have = new Set(ladders.filter((l) => l.gameId === id).map((l) => l.format));
        const absent = ['1v1', '2v2', '3v3', '5v5'].find((f) => !have.has(f));
        if (absent) return { gameId: id, absent, present: [...have] };
      }
      return null;
    })();

    if (!gapped) {
      step('MM9b', false, 'aucun jeu du catalogue ne manque d’un format : check inapplicable');
    } else {
      await main.getByLabel('Game', { exact: true }).selectOption(gapped.gameId);
      const offered = await main
        .getByLabel('Format', { exact: true })
        .locator('option')
        .evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean));
      const missing = gapped.present.filter((f) => !offered.includes(f));
      step(
        'MM9b',
        !offered.includes(gapped.absent) && missing.length === 0,
        `jeu « ${gapped.gameId} » : formats proposés [${offered.join(', ')}] — « ${gapped.absent} » ne doit PAS y être (${!offered.includes(gapped.absent)}), et ses formats réels [${gapped.present.join(', ')}] doivent tous y être (manquants : ${missing.join(', ') || 'aucun'})`,
      );

      // ⚠️ Et un format devenu impossible est LÂCHÉ, pas gardé hors de vue : sinon le tableau se
      // vide pendant que le sélecteur affiche une valeur qu'il n'offre plus.
      await main.getByLabel('Game', { exact: true }).selectOption('');
      await main.getByLabel('Format', { exact: true }).selectOption(gapped.absent);
      await main.getByLabel('Game', { exact: true }).selectOption(gapped.gameId);
      // 🔑 CE CHECK PORTE SUR LE TABLEAU, PAS SUR LE SÉLECTEUR — et c'est tout l'intérêt : lu sur
      // le `<select>`, il était VERT PAR CONSTRUCTION. Une valeur qui ne correspond à aucune
      // option rendue fait afficher « All formats » au navigateur quoi qu'il arrive, pendant que
      // l'état continue d'envoyer `format=2v2` et vide la liste. Vu vert sur le code cassé.
      const kept = await main.getByLabel('Format', { exact: true }).inputValue();
      const rowsAfter = await board.getByRole('listitem').count();
      step(
        'MM9c',
        kept === '' && rowsAfter >= 1,
        `format « ${gapped.absent} » puis passage à « ${gapped.gameId} » : sélecteur sur « ${kept || 'All formats'} » et ${rowsAfter} ligne(s) au tableau (≥ 1 — un format périmé encore actif le viderait)`,
      );
      await main.getByLabel('Game', { exact: true }).selectOption('');
    }

    setPhase('9. ?ladderId= inconnu : écran honnête et ZÉRO requête portant cet uuid');
    // Un uuid bien formé mais inconnu ferait 404 sur `GET /matches` — donc une ligne rouge en
    // console, motif de rejet. Le front tranche sur la liste des ladders DÉJÀ en cache.
    // ⚠️ SCOPÉ À `/api/`, et ce n'est pas cosmétique : la navigation du DOCUMENT porte elle
    // aussi l'uuid (`/matchmaking?ladderId=<uuid>`). Sans ce filtre le check comptait 1 et
    // sortait ROUGE sur un front pourtant correct — vu rouge avant vert.
    const carriesUnknown = (url) => url.includes('/api/') && url.includes(UNKNOWN_LADDER);
    const unknownCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/matchmaking?ladderId=${UNKNOWN_LADDER}`, {
        waitUntil: 'networkidle',
      });
      await appears(main.getByText('That ladder does not exist'));
    }, carriesUnknown);

    // ⚠️ LE CONTRÔLE POSITIF, et il n'est pas décoratif : « 0 requête » est aussi ce que
    // mesurerait un filtre qui ne matche RIEN. Le même filtre, appliqué à un ladder VALIDE,
    // doit compter au moins une requête.
    // ⚠️ Le contrôle positif ne peut PLUS chercher `ladderId=` dans l'appel : un `?ladderId=`
    // entrant est traduit dans les deux sélecteurs (un ladder EST le couple jeu+format, garanti
    // par `ladders_game_format_unique`), donc la requête part filtrée sur `gameId`+`format`.
    const carriesKnown = (url) =>
      url.includes('/api/matches?') &&
      url.includes(`gameId=${teamLadder.gameId}`) &&
      url.includes(`format=${teamLadder.format}`);
    const knownCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/matchmaking?ladderId=${teamLadder.id}`, {
        waitUntil: 'networkidle',
      });
      await appears(rowOf(teamLadder.name).first());
    }, carriesKnown);

    const droppedNotice = await main.getByText('That ladder does not exist').count();
    const filteredRows = await board.getByRole('listitem').count();
    const soloRowsLeft = await rowOf(soloLadder.name).count();
    step(
      'MM10',
      unknownCalls === 0 && knownCalls > 0 && filteredRows >= 1 && soloRowsLeft === 0,
      `uuid inconnu : ${unknownCalls} requête(s) le portant (0 attendue — un 404 laisserait une ligne rouge), le MÊME filtre sur un ladder valide : ${knownCalls} (> 0 attendu) ; ladder valide : ${filteredRows} ligne(s) dont ${soloRowsLeft} hors périmètre (0 attendu)`,
    );
    step(
      'MM10b',
      droppedNotice === 0,
      `sur un ladder valide, l’avis « That ladder does not exist » n’est plus affiché : ${droppedNotice} (0 attendu)`,
    );

    // ------------------- §9b la PORTE D'ENTRÉE : depuis le ladder vers ses créneaux ouverts
    // [F-MM] a appris à `/matchmaking` à LIRE `?ladderId=` mais n'a posé aucun lien qui le
    // produise : le filtre n'était atteignable qu'en tapant l'URL à la main. Ce bloc garde le
    // chemin dans les deux sens — le nombre affiché, puis la navigation qu'il déclenche.
    setPhase('9b. depuis /ladders/$id : le compte des créneaux ouverts et le lien vers le tableau');
    await page.goto(`${ORIGIN}/ladders/${teamLadder.id}`, { waitUntil: 'networkidle' });

    const doorway = main.getByRole('link', { name: 'See open slots', exact: true });
    await appears(doorway);

    // ⚠️ Le nombre est comparé À L'API, pas à lui-même : un « 3 » codé en dur, ou le compte des
    // seuls créneaux acceptables, passerait un check qui se contenterait de voir un chiffre.
    const openHere = await boardFromApi(`&ladderId=${teamLadder.id}`);
    const expected = openHere.slots.length;
    // ⚠️ On lit le texte de `<main>` UNE fois et on teste le motif dessus, plutôt que de compter
    // des nœuds : un `getByText` matche aussi les ancêtres, et `{ has: … }` avec un locator déjà
    // enraciné sur `main` ne résout pas (mesuré : innerText vide, MM10c rouge sur un front juste).
    // Le motif exige l'adjacence « <n> open slots on this ladder », donc un autre nombre de la
    // page ne peut pas le satisfaire par hasard.
    const wording = await main.innerText().catch(() => '');
    const announced = new RegExp(`\\b${expected}\\b\\s+slots?\\s+(is|are)\\s+open here`).test(wording);
    step(
      'MM10c',
      expected > 0 && announced,
      `page du ladder : l’API compte ${expected} créneau(x) ouvert(s) (> 0 attendu), motif « ${expected} slot(s) is/are open here » présent : ${announced}`,
    );

    // ⚠️ Prédicat sur la CIBLE EXACTE, jamais un motif : `waitForURL(/matchmaking/)` rendrait la
    // main immédiatement si l'on y était déjà, et le check serait vert sans rien garder.
    const target = `/matchmaking?ladderId=${teamLadder.id}`;
    await doorway.click();
    const arrived = await page
      .waitForURL((url) => `${url.pathname}${url.search}` === target, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    await appears(rowOf(teamLadder.name).first());
    const offTopic = await rowOf(soloLadder.name).count();
    step(
      'MM10d',
      arrived && offTopic === 0,
      `le lien mène à ${target} (${arrived}) et le tableau arrive filtré : ${offTopic} ligne(s) hors périmètre (0 attendue)`,
    );

    // 🔑 LE FILTRE ARRIVÉ PAR L'URL DOIT SE VOIR DANS LES CONTRÔLES. Avant, le tableau était
    // restreint pendant que les deux sélecteurs affichaient « All games / All formats » : l'écran
    // filtrait en disant qu'il ne filtrait pas, et le seul retour en arrière était un lien que
    // personne ne remarquait. Défaut trouvé à l'usage par David, pas par un check.
    const gameSelect = main.getByLabel('Game', { exact: true });
    const formatSelect = main.getByLabel('Format', { exact: true });
    const shownGame = await gameSelect.inputValue().catch(() => '');
    const shownFormat = await formatSelect.inputValue().catch(() => '');
    step(
      'MM10e',
      shownGame === teamLadder.gameId && shownFormat === teamLadder.format,
      `les sélecteurs annoncent le filtre reçu : Game « ${shownGame} » (${teamLadder.gameId} attendu), Format « ${shownFormat} » (${teamLadder.format} attendu)`,
    );

    // ⚠️ Et le retour à « tout voir » doit MARCHER : c'est la moitié du défaut. Remettre les deux
    // sélecteurs sur « All » doit ramener les créneaux des autres ladders, et l'URL ne doit plus
    // nommer un ladder que l'utilisateur vient d'écarter.
    await gameSelect.selectOption('');
    await formatSelect.selectOption('');
    await appears(rowOf(soloLadder.name).first());
    const widened = await rowOf(soloLadder.name).count();
    const urlAfter = new URL(page.url()).search;
    step(
      'MM10f',
      widened >= 1 && !urlAfter.includes('ladderId='),
      `retour à « All games / All formats » : ${widened} ligne(s) sur ${soloLadder.name} (≥ 1 attendue) et l’URL ne porte plus de ladder (« ${urlAfter || '∅'} »)`,
    );

    // ------------------------------------------- §10 accepter un créneau 2v2 (lineup)
    setPhase('10. acceptation 2v2 : panneau de composition, puis la fiche du match');
    await acceptOnTeamRow.click();
    const panelOpen = await appears(teamRow.getByRole('heading', { name: /Field your line-up/ }));
    const expanded = (await acceptOnTeamRow.count()) === 1
      ? await acceptOnTeamRow.getAttribute('aria-expanded')
      : null;
    // Le focus est porté sur le titre du panneau : sans ça, au clavier, il faudrait retraverser
    // toute la ligne pour atteindre la première case.
    const focusedHeading = await page.evaluate(
      () => document.activeElement?.textContent?.slice(0, 16) ?? '',
    );

    const boxes = teamRow.locator('fieldset input[type="checkbox"]');
    // ⚠️ COURSE VUE ROUGE : le panneau charge SON roster (`GET /teams/{id}`) et n'affiche
    // « Loading your roster… » qu'en attendant — `count()` n'attend rien et rendait 0, tandis
    // que le `check()` juste en dessous, lui, patiente. Le check sortait donc rouge alors que
    // le clic aboutissait. On attend la première case AVANT de les compter.
    await appears(boxes.first());
    const boxCount = await boxes.count();
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    // ⚠️ `exact: true` : le nom accessible du bouton de la LIGNE commence par « Accept the
    // slot on … », et Playwright matche en SOUS-CHAÎNE par défaut — il attraperait les deux.
    const submit = teamRow.getByRole('button', { name: 'Accept the slot', exact: true });
    await submit.click();

    // Prédicat sur la CIBLE, pas un motif : `waitForURL(/regex/)` rend la main immédiatement
    // si l'URL courante matche déjà.
    const landedOnTeamMatch = await page
      .waitForURL((url) => url.pathname.startsWith('/matches/'), { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    step(
      'MM11',
      panelOpen && expanded === 'true' && boxCount === 2 && landedOnTeamMatch,
      `panneau ouvert = ${panelOpen}, aria-expanded « ${expanded ?? '—'} » (true attendu), joueurs proposés : ${boxCount} (2 attendus), redirection vers la fiche du match = ${landedOnTeamMatch} (${new URL(page.url()).pathname})`,
    );
    step(
      'MM11b',
      focusedHeading.startsWith('Field your'),
      `focus posé sur le titre du panneau à l’ouverture : « ${focusedHeading || '—'} » (« Field your… » attendu — sinon un clavier doit retraverser la ligne)`,
    );

    // Le créneau accepté ne doit plus figurer nulle part sur le tableau.
    await page.goto(`${ORIGIN}/matchmaking`, { waitUntil: 'networkidle' });
    await acceptableBox.uncheck();
    const goneRows = await rowOf(teamLadder.name).count();
    step(
      'MM12',
      goneRows === 0,
      `après acceptation, lignes restantes sur ${teamLadder.name} : ${goneRows} (0 attendu — le cache du tableau est invalidé, pas seulement la fiche)`,
    );

    // ------------------------------- §11 §5.1 en 1v1 : le négatif ET son positif
    setPhase('11. 1v1 sans compte lié : aucun bouton, et la raison en clair');
    await unlink(user, 'chess_com');
    await page.reload({ waitUntil: 'networkidle' });
    await acceptableBox.uncheck();
    const soloRow = rowOf(soloLadder.name);
    await appears(soloRow.first());
    const notLinkedText = await soloRow.getByText('needs a linked').count();
    const soloButtons = await soloRow.locator('button[aria-label^="Accept the slot on"]').count();
    step(
      'MM13',
      notLinkedText === 1 && soloButtons === 0,
      `sans compte chess.com : phrase « needs a linked … account » ${notLinkedText} (1 attendu), bouton « Accept » sur cette ligne : ${soloButtons} (0 attendu — l’accept répondrait 400 §5.1)`,
    );

    setPhase('12. le compte est relié : le bouton revient (contrôle positif de MM13)');
    await link(user, 'chess_com');
    await page.reload({ waitUntil: 'networkidle' });
    const soloAccept = soloRow.locator('button[aria-label^="Accept the slot on"]');
    const soloButtonBack = await appears(soloAccept);
    step(
      'MM14',
      soloButtonBack,
      `après re-liaison chess.com : bouton « Accept » rendu = ${soloButtonBack} — c’est ce qui prouve que MM13 peut virer au rouge`,
    );

    // ------------------------------ §13 accepter un créneau 1v1 (confirmation, sans corps)
    setPhase('13. acceptation 1v1 : confirmation directe, aucune lineup');
    await soloAccept.click();
    const dialog = page.getByRole('dialog');
    const dialogOpen = await appears(dialog.getByRole('heading', { name: 'Accept this slot?' }));
    const noLineup = await dialog.locator('input[type="checkbox"]').count();
    await dialog.getByRole('button', { name: 'Accept the slot', exact: true }).click();
    const landedOnSoloMatch = await page
      .waitForURL((url) => url.pathname.startsWith('/matches/'), { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    step(
      'MM15',
      dialogOpen && noLineup === 0 && landedOnSoloMatch,
      `boîte de confirmation = ${dialogOpen}, cases de lineup dedans : ${noLineup} (0 attendue — en 1v1 le joueur EST le camp, la requête part sans corps), redirection = ${landedOnSoloMatch} (${new URL(page.url()).pathname})`,
    );

    // ------------------------------- §13b la 6e raison : §5.2, déjà engagé sur cette fenêtre
    // Le compte du run vient d'accepter le match chess à `soloSlotAt` : il est `in_progress`,
    // donc il VERROUILLE sa fenêtre. Un tiers ouvre un créneau sur EXACTEMENT la même heure —
    // l'API le listera, mais avec `schedule_conflict`, et sans bouton.
    setPhase('13b. refus `schedule_conflict` : ma fenêtre est déjà prise');
    await link(myMate, 'chess_com');
    const { match: rivalSolo } = await api(myMate, '/matches', {
      method: 'POST',
      body: JSON.stringify({ ladderId: soloLadder.id, scheduledAt: soloSlotAt }),
    }).then(json);
    matchIds.push(assertUuid(rivalSolo.id, 'créneau 1v1 concurrent'));

    await page.goto(`${ORIGIN}/matchmaking`, { waitUntil: 'networkidle' });
    await acceptableBox.uncheck();
    await appears(soloRow.first());
    const conflictText = await soloRow.getByText('already engaged in a match around that').count();
    const conflictButtons = await soloRow
      .locator('button[aria-label^="Accept the slot on"]')
      .count();
    step(
      'MM15b',
      conflictText === 1 && conflictButtons === 0,
      `phrase « You are already engaged in a match around that time. » : ${conflictText} ` +
        `(1 attendu), bouton « Accept » : ${conflictButtons} (0 attendu — l’accept répondrait 409 §5.2)`,
    );

    // ------------------------- §13c le créneau disparaît SOUS le clic (bannière, annonce, focus)
    // 🔑 « COURSE NON FABRICABLE » — FAUX, et c'est pour ça que ce chemin est resté nu. Il n'y a
    // aucune course à gagner : il suffit qu'un tiers accepte le créneau PAR L'API entre l'ouverture
    // de la boîte de confirmation et le clic qui la valide. C'est séquentiel et déterministe.
    // C'est le seul endroit où l'utilisateur ne peut RIEN voir venir : sa cible a disparu et la
    // ligne qui portait le message est retirée par le refetch.
    setPhase('13c. le créneau est pris pendant la confirmation : bannière, annonce et focus');
    expectHttp(/\/api\/matches\/[0-9a-f-]+\/accept/, 'accept d’un créneau volontairement déjà pris');
    await link(opener, 'chess_com');
    const stolenAt = registerSlot(soloLadder.name, futureQuarter(7));
    const { match: stolen } = await api(opener, '/matches', {
      method: 'POST',
      body: JSON.stringify({ ladderId: soloLadder.id, scheduledAt: stolenAt }),
    }).then(json);
    matchIds.push(stolen.id);

    await page.reload({ waitUntil: 'networkidle' });
    // Visé par SON coup d'envoi : le run tient trois créneaux sur ce ladder (le sien, celui du
    // rival du §13b, celui-ci). Un `.last()` pariait sur l'ordre de tri du tableau.
    const stolenRow = rowOf(soloLadder.name, stolenAt);
    const stolenButton = stolenRow.locator('button[aria-label^="Accept the slot on"]');
    await appears(stolenButton);
    await stolenButton.click();
    const stealDialog = page.getByRole('dialog');
    await appears(stealDialog.getByRole('heading', { name: 'Accept this slot?' }));

    // LE VOL : `myMate` prend le créneau pendant que la boîte est ouverte. Son propre créneau
    // `rivalSolo` est `pending`, donc il ne verrouille rien et ne bloque pas cet accept.
    const stealRes = await api(myMate, `/matches/${stolen.id}/accept`, { method: 'POST' });
    const stealOk = stealRes.ok;

    await stealDialog.getByRole('button', { name: 'Accept the slot', exact: true }).click();
    const heard = await awaitAnnouncement('This slot is no longer available');
    const banner = await main.getByText('This slot is no longer available').count();
    const stillHere = new URL(page.url()).pathname === '/matchmaking';
    // ⚠️ Compter AVANT de lire : `evaluate` sur un focus absent ne lève pas, mais on veut la
    // valeur exacte, pas « un élément quelconque ».
    const focusTag = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
    step(
      'MM15c',
      stealOk && heard && banner >= 1 && stillHere && focusTag !== 'BODY',
      `vol par l’API = ${stealOk} ; bannière « no longer available » ${banner} (≥ 1), annonce entendue = ${heard}, on reste sur /matchmaking = ${stillHere}, focus sur « ${focusTag} » (jamais BODY — un clavier retomberait au début de la page)`,
    );

    // -------------------- §14 le créneau franchit la barre des 15 min, onglet resté ouvert
    // 🚨 LE DERNIER CHEMIN VERS UN 4xx OFFERT PAR UN BOUTON, et il n'a besoin d'aucune course :
    // le serveur ne liste que les créneaux à plus de 15 min AU MOMENT OÙ IL RÉPOND. Un onglet
    // laissé au premier plan ne refetch pas ; deux minutes de lecture suffisent.
    setPhase('14. la barre des 15 min franchie pendant que l’onglet reste ouvert');
    const expiringOpenedAt = registerSlot(teamLadder.name, futureQuarter(9));
    const { match: expiring } = await api(opener, '/matches', {
      method: 'POST',
      body: JSON.stringify({
        ladderId: teamLadder.id,
        scheduledAt: expiringOpenedAt,
        lineup: [await idOf(opener), await idOf(openerMate)],
      }),
    }).then(json);
    matchIds.push(assertUuid(expiring.id, 'créneau qui va expirer'));
    // ⚠️ USAGE SANCTIONNÉ DE `sql()` : forcer un état que l'API INTERDIT d'atteindre.
    // `POST /matches` exige un coup d'envoi sur la grille des quarts et à plus de 15 min ; il
    // n'existe aucune séquence HTTP qui pose un créneau à 16 minutes précises.
    //
    // ⚠️ UN INSTANT ABSOLU, CALCULÉ ICI, ET PAS `now() + interval` : reculer l'heure change ce
    // que la LIGNE AFFICHE, or c'est ce libellé qui distingue mon créneau de celui d'un tiers
    // (voir `rowOf`). Avec un intervalle SQL, ce run ne saurait plus reconnaître sa propre
    // ligne. Les deux horloges sont celles de la même machine, l'écart est sans effet.
    const expiringAt = new Date(Date.now() + 16 * 60 * 1000).toISOString();
    forgetSlot(teamLadder.name, expiringOpenedAt);
    registerSlot(teamLadder.name, expiringAt);
    sql(`update matches set scheduled_at = '${expiringAt}' where id = '${expiring.id}';`);

    let expiryBefore = -1;
    let expiryAfter = -1;
    let expiryNotice = -1;
    try {
      // L'horloge de la PAGE est pilotée : c'est la seule façon de faire avancer le temps du
      // client sans faire avancer celui du serveur — donc de reproduire « l'onglet est resté
      // ouvert » sans attendre deux minutes pour de vrai.
      await page.clock.install();
      await page.goto(`${ORIGIN}/matchmaking`, { waitUntil: 'networkidle' });
      const expiringRow = rowOf(teamLadder.name);
      await appears(expiringRow.first());
      expiryBefore = await expiringRow.locator('button[aria-label^="Accept the slot on"]').count();

      await page.clock.fastForward('02:00');
      await page.waitForTimeout(500);
      expiryAfter = await expiringRow.locator('button[aria-label^="Accept the slot on"]').count();
      expiryNotice = await expiringRow.getByText('kicks off in less than').count();
    } catch (err) {
      // Une panne du pilotage d'horloge doit rougir CE check, jamais faire sortir le harnais
      // en exit 2 (« harnais en échec »), qui se lit comme un problème d'environnement.
      step('MM16', false, `pilotage de l’horloge indisponible : ${err.message}`);
    }
    if (expiryBefore !== -1) {
      step(
        'MM16',
        expiryBefore === 1 && expiryAfter === 0 && expiryNotice === 1,
        `créneau à T+16 min : bouton « Accept » avant ${expiryBefore} (1 attendu — le serveur ` +
          `le liste encore), après 2 min d’horloge cliente ${expiryAfter} (0 attendu — l’accept ` +
          `répondrait 409), phrase « kicks off in less than 15 minutes » : ${expiryNotice} (1 attendu)`,
      );
    }

  } finally {
    // ------------------------------------------------------------------ §15 teardown
    // Exécuté MÊME si un check a échoué : sans ça, le premier run raté laisse quatre comptes
    // et deux équipes indéracinables (un match `in_progress` engage ses participants ET son
    // équipe), et le suivant hérite de leur bruit.
    setPhase('15. teardown : les matchs cessent d’engager comptes et équipes');
    // ⚠️ La page est ENCORE OUVERTE ici (le runner ne ferme le navigateur qu'après `run()`).
    // On la vide avant de toucher aux matchs : une invalidation en vol referait une requête
    // sur une ressource disparue et écrirait un 404 dans la console, imputé à ce nettoyage.
    await page.goto('about:blank').catch(() => {});
    const ids = matchIds.map((id) => `'${id}'`).join(', ');
    try {
      // 1) `cancelled` est, avec `completed`, l'un des deux seuls statuts hors
      //    `ENGAGING_STATUSES` : c'est ce qui rend les équipes dissolubles et les comptes
      //    supprimables par le runner. Étape LOAD-BEARING, donc faite en premier.
      sql(`update matches set status = 'cancelled', winner_side_id = null where id in (${ids});`);
      // 2) Puis les matchs eux-mêmes : `DELETE /matches/:id` ne fait que passer le statut à
      //    `cancelled`, donc sans cette requête chaque run laisserait deux coquilles de plus.
      //    Sides et participants tombent en CASCADE.
      sql(`delete from matches where id in (${ids});`);
      // Ce check lit la BASE, et c'est légitime : la base EST le sujet ici — il garde le
      // teardown, pas un comportement de l'application (règle du docblock de `sql.mjs`).
      const left = sql(
        `select (select count(*) from matches where id in (${ids}))
              + (select count(*) from match_sides where match_id in (${ids}))
              + (select count(*) from match_participants where match_side_id in
                   (select id from match_sides where match_id in (${ids})));`,
      );
      step('MM17', left === '0', `lignes résiduelles (matchs + sides + participants) : ${left} (0 attendu)`);
    } catch (err) {
      // ⚠️ Une exception de teardown ne doit JAMAIS écraser celle qui a interrompu le run : le
      // rapport afficherait « SQL refusé… » à la place de la vraie cause. On la rend visible en
      // ROUGE — donc en exit 1, imputable — sans la laisser remonter.
      step('MM17', false, `teardown interrompu : ${err.message}`);
    }
  }
}
