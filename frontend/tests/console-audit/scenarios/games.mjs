/**
 * `/games` et `/games/$gameId` — [F-GAMES] : le parcours « je veux jouer à ce jeu ».
 *
 * Ce que ce scénario garde :
 *
 *   - la grille des jeux, et le sous-titre PILOTÉ PAR LA DONNÉE (les formats viennent de
 *     `GET /ladders`, pas d'une liste en dur) ;
 *   - un slug inconnu -> écran d'erreur **sans aucune requête**. `games.id` est un slug texte,
 *     il n'y a donc pas de forme locale à valider : c'est la LISTE déjà en cache qui tranche.
 *     Une requête ici prendrait un 404, donc une ligne rouge en console — motif de rejet ;
 *   - **le CTA est décidé par le FORMAT du ladder, jamais par l'absence d'équipe.** Le compte
 *     du run est neuf : il n'a d'équipe nulle part, et pourtant chess 1v1 doit offrir « Play
 *     solo » quand cs2 5v5 offre « Create a team ». Lire un `null` d'équipe comme « solo » est
 *     le bug déjà corrigé deux fois dans ce repo (FT-4A, F-SOLO) ;
 *   - **UNE seule requête de classement par ladder** (un `useQueries`, pas un `useQuery` par
 *     carte) et surtout **zéro** en suivant « See the full standings » : les deux écrans
 *     partagent la clé `['ladder', id, 'rankings']`, c'est tout l'intérêt de la carte ;
 *   - le retour de `/ladders/$ladderId` nomme sa VRAIE origine, et retombe **inchangé** sur
 *     « Back to my teams » quand il n'y en a pas ;
 *   - `?create=<ladderId>` ouvre le formulaire pré-sélectionné, et un id inconnu est ignoré
 *     **en silence**.
 *
 * ⚠️ CE SCÉNARIO NE DÉPEND PAS DU SEED. Les 5 jeux et les 9 ladders viennent des migrations ;
 * le podium est comparé à ce que l'API répond au même instant, donc il est juste que la base
 * soit peuplée ou vide. Le seul cas qu'il ne peut pas fabriquer est un classement RENSEIGNÉ
 * sur une base vierge (une ligne `rankings` naît d'un match terminé) — c'est le point de
 * recette manuel du ticket.
 */
export const name = 'games';
export const surface =
  '/games + /games/$gameId — grille des jeux, ladders d’un jeu, podium, CTA par format, ?create= (F-GAMES)';

/** Slug qui n'existe pas : il ne doit déclencher AUCUNE requête. */
const UNKNOWN_GAME = 'not-a-game';
/** uuid bien formé mais inexistant : `?create=` doit l'ignorer sans rien dire. */
const UNKNOWN_LADDER = '33333333-3333-4333-8333-333333333333';

/**
 * `waitFor` qui rend `false` au lieu de lever. Un `waitFor` nu fait sortir le harnais en
 * **exit 2** (« le harnais a échoué ») : une régression d'écran serait alors lue comme un
 * problème d'environnement, pas comme un défaut du ticket.
 */
const appears = (locator, timeout = 10000) =>
  locator
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);

export async function run({ page, setPhase, step, countRequests, user, ORIGIN }) {
  /** Appel API direct, lu par NODE : il ne traverse pas la console auditée. */
  const api = (path) =>
    fetch(`${ORIGIN}/api${path}`, { headers: { authorization: `Bearer ${user.accessToken}` } });

  const json = async (path) => {
    const res = await api(path);
    // ⚠️ Le statut se lit AVANT le corps : sur un 429 (quota global par IP) ou un 500, la
    // lecture d'une clé absente lèverait un TypeError opaque, loin de sa cause.
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status} : ${await res.text()}`);
    return res.json();
  };

  const main = page.locator('main');
  /** La carte d'un ladder, repérée par son titre — jamais par sa position dans la liste. */
  const ladderCard = (ladderName) =>
    main
      .locator('li')
      .filter({ has: page.getByRole('heading', { level: 3, name: ladderName, exact: true }) });

  // ------------------------------------------------------------- §0 mise en place
  setPhase('0. mise en place (API directe) : jeux, ladders et pool de maps');

  const { games } = await json('/games');
  const { ladders } = await json('/ladders');
  // Trouvés par leur DONNÉE (jeu + format), jamais par un uuid en dur : les ids viennent des
  // migrations et diffèrent d'une base à l'autre.
  const cs2 = games.find((game) => game.id === 'cs2');
  const cs2Ladders = ladders.filter((ladder) => ladder.gameId === 'cs2');
  const cs2Team = cs2Ladders.find((ladder) => ladder.format === '5v5');
  const chess = ladders.find((ladder) => ladder.gameId === 'chess' && ladder.format === '1v1');
  if (!cs2 || !cs2Team || !chess || cs2Ladders.length < 2) {
    // Erreur de HARNAIS (exit 2), pas un check rouge : sans ces données, tout ce qui suit
    // mesurerait le vide.
    throw new Error(
      `données de référence manquantes — jeu cs2: ${Boolean(cs2)}, ladders cs2: ` +
        `${cs2Ladders.length} (≥ 2 attendus), chess 1v1: ${Boolean(chess)}`,
    );
  }
  const { maps: cs2Maps } = await json('/games/cs2');

  // ------------------------------------------------------------- §1 la grille des jeux
  setPhase('1. /games : la grille des 5 jeux');
  await page.goto(`${ORIGIN}/games`, { waitUntil: 'networkidle' });
  const gridTitle = await appears(main.getByRole('heading', { level: 1 }));
  // ⚠️ Scopé à `<main>` : le rail gauche est monté sur toute page authentifiée et porte lui
  // aussi un item « Games » — un balayage global le compterait (piège `L7` de `ladder-detail`).
  const tiles = main.locator('ul li a[href^="/games/"]');
  const tileCount = await tiles.count();
  step(
    'G1',
    gridTitle && tileCount === games.length,
    `titre rendu : ${gridTitle}, tuiles de jeu : ${tileCount} (${games.length} attendues, d’après GET /games)`,
  );

  // Le sous-titre vient de la DONNÉE (`formatsForGame` sur le cache de GET /ladders), pas
  // d'une liste en dur : on le compare à ce que l'API répond au même instant.
  //
  // ⚠️ COMPARAISON INSENSIBLE À LA CASSE, et ce n'est pas de la complaisance : `label-caps`
  // applique `text-transform: uppercase`, donc `innerText()` rend « COUNTER-STRIKE 2 » là où
  // le DOM porte « Counter-Strike 2 ». Ce check est sorti ROUGE dessus au premier jet.
  const expectedFormats = [...new Set(cs2Ladders.map((ladder) => ladder.format))].join(' · ');
  const cs2Tile = main.locator(`ul li a[href="/games/cs2"]`);
  const cs2TileCount = await cs2Tile.count();
  // ⚠️ COMPTER AVANT DE LIRE : `innerText()` sur un locator vide LÈVE -> exit 2 (« harnais en
  // échec ») au lieu d'un rouge imputable au ticket.
  const cs2TileText = (cs2TileCount === 1 ? await cs2Tile.innerText() : '').toLowerCase();
  const nameShown = cs2TileText.includes(cs2.name.toLowerCase());
  const formatsShown = cs2TileText.includes(expectedFormats.toLowerCase());
  step(
    'G2',
    cs2TileCount === 1 && nameShown && formatsShown,
    `tuile cs2 : ${cs2TileCount} (1 attendue), nom « ${cs2.name} » présent = ${nameShown}, formats « ${expectedFormats} » présents = ${formatsShown} (sous-titre piloté par GET /ladders, pas par une liste en dur)`,
  );

  // -------------------------------------------- §2 slug inconnu -> écran d'erreur, 0 requête
  setPhase('2. slug inconnu -> écran d’erreur sans la moindre requête');
  // `GET /games/{id}` ne sert QUE le pool de maps, et il n'est armé que si le slug figure dans
  // la liste déjà en cache. Un slug inconnu ne doit donc taper l'API nulle part.
  const detailCalls = (url) => url.includes('/api/games/');

  const unknownCalls = await countRequests(async () => {
    await page.goto(`${ORIGIN}/games/${UNKNOWN_GAME}`, { waitUntil: 'networkidle' });
    await appears(main.locator('text=Game not found'));
  }, detailCalls);

  // ⚠️ LE CONTRÔLE POSITIF, et il n'est pas décoratif : « 0 requête » est aussi ce que
  // mesurerait un filtre qui ne matche RIEN (une route renommée, un `/api` oublié). Le même
  // filtre est rejoué sur un slug VALIDE, où il doit compter la requête du pool de maps.
  const validCalls = await countRequests(async () => {
    await page.goto(`${ORIGIN}/games/cs2`, { waitUntil: 'networkidle' });
    await appears(main.getByRole('heading', { level: 1, name: cs2.name }));
  }, detailCalls);

  step(
    'G3',
    unknownCalls === 0 && validCalls > 0,
    `requêtes /api/games/<slug> sur un slug inconnu : ${unknownCalls} (0 attendue — un 404 laisserait une ligne rouge en console) ; le MÊME filtre sur cs2 : ${validCalls} (> 0 attendu, c’est ce qui prouve que le filtre matche vraiment quelque chose)`,
  );

  await page.goto(`${ORIGIN}/games/${UNKNOWN_GAME}`, { waitUntil: 'networkidle' });
  const unknownScreen = await appears(main.locator('text=Game not found'));
  step(
    'G3b',
    unknownScreen && page.url().endsWith(`/games/${UNKNOWN_GAME}`),
    `écran « Game not found » rendu = ${unknownScreen}, URL conservée (pas de redirection silencieuse) : ${new URL(page.url()).pathname}`,
  );

  // ------------------------------------------------------------- §3 la page d’un jeu
  setPhase('3. /games/cs2 : identité, pool de maps, ladders');
  // On compte les requêtes de classement du CHARGEMENT : un `useQuery` par carte en enverrait
  // autant, mais le jour où une migration ajoute un ladder il casserait les règles des hooks.
  // Ce que ce check garde, c'est qu'il n'y en a pas DEUX par carte (montage + refetch).
  const rankingCalls = await countRequests(async () => {
    await page.goto(`${ORIGIN}/games/cs2`, { waitUntil: 'networkidle' });
    await appears(main.getByRole('heading', { level: 1, name: cs2.name }));
  }, (url) => url.includes('/rankings'));

  const cardCount = await main.getByRole('heading', { level: 3 }).count();
  step(
    'G4',
    cardCount === cs2Ladders.length && rankingCalls === cs2Ladders.length,
    `cartes de ladder : ${cardCount} (${cs2Ladders.length} attendues), requêtes GET /ladders/{id}/rankings au chargement : ${rankingCalls} (${cs2Ladders.length} attendues — une par ladder, un seul useQueries)`,
  );

  // L'ORDRE DES CARTES : le format le plus grand d'abord. `GET /ladders` trie par NOM, ce qui
  // plaçait « Counter-Strike 2 2v2 (Wingman) » — vide — devant le 5v5 qui porte toutes les
  // équipes classées : la page s'ouvrait sur sa carte morte. Sur les neuf ladders semés, le
  // plus grand format est toujours le format phare (cs2 5v5, valorant 5v5, RL 3v3).
  // ⚠️ Attendu CALCULÉ depuis l'API, jamais un nom en dur : le check suit la donnée.
  const expectedOrder = [...cs2Ladders]
    .sort((a, b) => Number.parseInt(b.format, 10) - Number.parseInt(a.format, 10))
    .map((ladder) => ladder.name);
  const renderedOrder = await main.getByRole('heading', { level: 3 }).allTextContents();
  const orderMatches =
    renderedOrder.length === expectedOrder.length &&
    expectedOrder.every((name, i) => renderedOrder[i]?.trim().toUpperCase() === name.toUpperCase());
  step(
    'G4b',
    orderMatches,
    `ordre des cartes rendu « ${renderedOrder.map((t) => t.trim()).join(' | ')} », attendu ` +
      `« ${expectedOrder.join(' | ')} » (le plus grand format d’abord — sinon la page s’ouvre ` +
      `sur le ladder secondaire, souvent vide)`,
  );

  // ⚠️ `:has()` REMONTE : `section:has(h2:text-is("Map pool"))` matcherait AUSSI la section
  // parente qui contient ce titre. Il faut le chemin DIRECT — le `<h2>` d'un `SectionTitle`
  // est enveloppé dans sa ligne de titre, il n'est donc jamais frère de la liste qui suit.
  const mapChips = main.locator('section:has(> div > h2:text-is("Map pool")) ul li');
  // ⚠️ Insensible à la casse pour la même raison que G2 : `Pill` porte `label-caps`, donc
  // `Ancient` se lit `ANCIENT` à l'écran. Ce check est sorti ROUGE dessus au premier jet.
  const renderedMaps = (await mapChips.allInnerTexts()).map((text) => text.trim().toLowerCase());
  const sameMaps = cs2Maps.every((map) => renderedMaps.includes(map.toLowerCase()));
  step(
    'G5',
    renderedMaps.length === cs2Maps.length && sameMaps,
    `pool de maps affiché : ${renderedMaps.length} (${cs2Maps.length} attendues d’après GET /games/cs2), maps identiques = ${sameMaps} — la page ne peut pas annoncer une map que POST /matches n’attribuerait pas`,
  );

  const providerNote = await main.getByText('Requires a linked Steam account').count();
  step(
    'G5b',
    providerNote === 1,
    `compte externe requis annoncé comme une INFORMATION : ${providerNote} mention(s) (1 attendue) — aucun bouton de liaison, la route n’a pas encore d’écran ([F4B])`,
  );

  // ------------------------- §4 LE CHECK CENTRAL : le CTA est décidé par le FORMAT
  setPhase('4. le CTA vient du FORMAT du ladder, pas de l’absence d’équipe');
  // Le compte du run est NEUF : il n'a d'équipe nulle part. Sur un ladder d'équipe, cela doit
  // donner « Create a team » — et surtout PAS « Play solo ».
  const teamCard = ladderCard(cs2Team.name);
  const createLink = teamCard.getByRole('link', { name: 'Create a team', exact: true });
  const createCount = await createLink.count();
  // ⚠️ Compter avant de lire l'attribut : `getAttribute()` sur un locator vide LÈVE -> exit 2.
  const createHref = createCount === 1 ? await createLink.getAttribute('href') : null;
  const soloOnTeamPage = await main.getByRole('link', { name: 'Play solo', exact: true }).count();
  step(
    'G6',
    createCount === 1 &&
      createHref === `/teams?create=${cs2Team.id}` &&
      soloOnTeamPage === 0,
    `sur « ${cs2Team.name} » (${cs2Team.format}) sans équipe : bouton « Create a team » ${createCount} (1 attendu) vers « ${createHref ?? '—aucun—'} », bouton « Play solo » sur la page : ${soloOnTeamPage} (0 attendu — c’est le FORMAT qui tranche, jamais l’absence d’équipe)`,
  );

  // Le POSITIF du même check, sur l'autre face de la règle : même compte, même absence
  // d'équipe, mais un ladder 1v1 -> « Play solo ». Sans lui, G6 resterait vert le jour où le
  // CTA cesserait d'être rendu pour tout le monde.
  await page.goto(`${ORIGIN}/games/chess`, { waitUntil: 'networkidle' });
  const soloLink = main.getByRole('link', { name: 'Play solo', exact: true });
  const soloCount = await soloLink.count();
  const soloHref = soloCount === 1 ? await soloLink.getAttribute('href') : null;
  const createOnSolo = await main.getByRole('link', { name: 'Create a team', exact: true }).count();
  const mapsOnChess = await main.locator('h2:text-is("Map pool")').count();
  step(
    'G7',
    soloCount === 1 &&
      soloHref === `/solo/${chess.id}` &&
      createOnSolo === 0 &&
      mapsOnChess === 0,
    `sur chess 1v1, MÊME compte sans équipe : « Play solo » ${soloCount} (1 attendu) vers « ${soloHref ?? '—aucun—'} », « Create a team » : ${createOnSolo} (0 attendu), section « Map pool » : ${mapsOnChess} (0 attendue — chess n’a pas de maps, et un pool vide n’est pas une erreur)`,
  );

  // ------------------------------------------------------- §5 le podium, comparé à l’API
  setPhase('5. le podium de la page jeu contre GET /ladders/{id}/rankings');
  await page.goto(`${ORIGIN}/games/cs2`, { waitUntil: 'networkidle' });
  await appears(main.getByRole('heading', { level: 1, name: cs2.name }));
  const { rankings } = await json(`/ladders/${cs2Team.id}/rankings`);
  const expectedPodium = Math.min(3, rankings.length);
  const podiumRows = teamCard.locator('ol li');
  const podiumCount = await podiumRows.count();
  // 🚨 La couleur ne porte JAMAIS l'information seule (WCAG) : l'icône de médaille est
  // `aria-hidden`, donc la place doit exister en toutes lettres pour un lecteur d'écran.
  const firstPlaceLabel = await teamCard.getByText('First place').count();
  const emptyNotice = await teamCard.getByText('No one ranked yet').count();
  step(
    'G8',
    podiumCount === expectedPodium &&
      (expectedPodium === 0 ? emptyNotice === 1 : firstPlaceLabel === 1),
    expectedPodium === 0
      ? `classement vide (${rankings.length} classé(s)) : lignes de podium ${podiumCount} (0 attendue), phrase « No one ranked yet » : ${emptyNotice} (1 attendue — jamais un podium à trous)`
      : `${rankings.length} classé(s) : lignes de podium ${podiumCount} (${expectedPodium} attendues), libellé sr-only « First place » : ${firstPlaceLabel} (1 attendu — une médaille dorée seule n’est rien pour un lecteur d’écran)`,
  );

  // L'AUTRE face de G8, et elle compte : sur la MÊME page, un ladder sans aucun classé doit
  // rendre une phrase, jamais un podium à trous. Le seed range des équipes sur cs2 5v5 et
  // personne sur cs2 2v2, une base vierge n'a rien nulle part — dans les deux cas ce check
  // trouve sa donnée. Il vire au ROUGE, avec le message qui l'explique, si la base a fini par
  // classer quelqu'un sur les deux (il faudrait alors lui trouver un autre ladder).
  const otherLadder = cs2Ladders.find((ladder) => ladder.id !== cs2Team.id);
  const otherRankings = (await json(`/ladders/${otherLadder.id}/rankings`)).rankings;
  const emptyCard = ladderCard(otherLadder.name);
  const emptyPodium = await emptyCard.locator('ol li').count();
  const emptySentence = await emptyCard.getByText('No one ranked yet').count();
  step(
    'G8c',
    otherRankings.length === 0 && emptyPodium === 0 && emptySentence === 1,
    `« ${otherLadder.name} » : ${otherRankings.length} classé(s) d’après l’API (0 attendu — sinon ce check n’a plus de donnée à observer), lignes de podium ${emptyPodium} (0 attendue), phrase « No one ranked yet » ${emptySentence} (1 attendue — jamais un podium à trous)`,
  );

  // Invariant #11 : UNE seule région live par écran — deux se disputeraient la lecture, et un
  // sélecteur `[role=status]` en `.first()` prendrait la première venue.
  //
  // 🔑 MESURÉ PENDANT LE CHARGEMENT, ET C'EST TOUT L'INTÉRÊT. Compter sur une page déjà
  // chargée ne garde RIEN : les trois régions candidates sont démontées par définition, le
  // check lirait 0 et resterait vert quoi qu'on casse. La seule fenêtre où deux régions
  // pourraient coexister est celle où `game-detail` a fini de charger (sa région disparaît) et
  // où `GameLadderCards` monte la sienne — donc on retient `GET /ladders` pour l'ouvrir.
  // ⚠️ On retient bien la LISTE des ladders, pas les classements : une fois la liste arrivée,
  // `GameLadderCards` rend son `<ul>` et n'a plus de région du tout.
  const laddersRoute = /\/api\/ladders$/;
  let releaseLadders;
  const heldLadders = new Promise((resolve) => {
    releaseLadders = resolve;
  });
  await page.route(laddersRoute, async (route) => {
    await heldLadders;
    // ⚠️ La route peut avoir été résolue autrement pendant l'attente (navigation, `unroute`) :
    // `continue()` LÈVE alors, et une exception non rattrapée dans un handler sort le harnais
    // en exit 2 — un « échec du harnais » qu'on lirait comme une régression du ticket.
    await route.continue().catch(() => {});
  });
  // ⚠️ `commit` et pas `networkidle` : le réseau ne peut pas devenir inactif tant qu'on retient
  // une requête.
  await page.goto(`${ORIGIN}/games/cs2`, { waitUntil: 'commit' });
  const loadingWindow = await appears(main.getByText(/loading the ladders/i));
  const liveRegions = loadingWindow ? await main.locator('[role="status"]').count() : -1;
  releaseLadders();
  // La page doit repartir chargée : les checks suivants la reprennent là où ils l'ont laissée.
  // ⚠️ ET c'est ce qui garantit que le handler a fini avant le `unroute` — l'inverse coupait la
  // route sous ses pieds.
  await appears(main.getByRole('heading', { level: 3, name: cs2Team.name, exact: true }));
  await page.unroute(laddersRoute).catch(() => {});
  step(
    'G8b',
    loadingWindow && liveRegions === 1,
    `pendant le chargement des ladders : fenêtre observée = ${loadingWindow}, régions live \`role="status"\` dans <main> : ${liveRegions} (exactement 1 attendue — 0 voudrait dire que le check ne regarde rien, 2+ que deux régions se disputent la lecture)`,
  );

  // ----------------------- §6 « See the full standings » : ZÉRO requête de classement
  setPhase('6. See the full standings -> /ladders/$ladderId sans rejouer le classement');
  const standingsLink = teamCard.getByRole('link', { name: 'See the full standings', exact: true });
  const standingsCount = await standingsLink.count();
  const standingsHref = standingsCount === 1 ? await standingsLink.getAttribute('href') : null;
  let reachedLadder = false;
  const reuseCalls = await countRequests(async () => {
    if (!standingsHref) return;
    await standingsLink.click();
    // ⚠️ Un motif rendrait la main IMMÉDIATEMENT si l'URL courante le satisfaisait déjà : on
    // exige le pathname EXACT de la cible. Et `.catch()`, sinon une attente qui lève sort en
    // exit 2 au lieu d'un rouge imputable.
    reachedLadder = await page
      .waitForURL((url) => url.pathname === standingsHref, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    await appears(main.getByRole('heading', { level: 1, name: cs2Team.name }));
  }, (url) => url.includes('/rankings'));

  step(
    'G9',
    standingsCount === 1 &&
      standingsHref === `/ladders/${cs2Team.id}` &&
      reachedLadder &&
      reuseCalls === 0,
    `lien « See the full standings » : ${standingsCount} (1 attendu) vers « ${standingsHref ?? '—aucun—'} », page ladder atteinte = ${reachedLadder}, requêtes de classement rejouées : ${reuseCalls} (0 attendue — les deux écrans partagent la clé ['ladder', id, 'rankings'])`,
  );

  // -------------------------------- §7 le retour de la page ladder nomme son origine
  setPhase('7. /ladders/$ladderId : le retour nomme sa vraie origine');
  const backToGame = main.getByRole('link', { name: /^back to the game$/i });
  const backToGameCount = await backToGame.count();
  const backToTeamsCount = await main.getByRole('link', { name: /^back to my teams$/i }).count();
  // Le lien fait 16 px de haut sans le `py-1` de `backLinkClasses`, sous le plancher de 24 px
  // de WCAG 2.5.8. ⚠️ `boundingBox()` LÈVE quand rien ne matche -> `.catch()`.
  const backBox = backToGameCount >= 1 ? await backToGame.first().boundingBox().catch(() => null) : null;
  const backHeight = backBox ? Math.round(backBox.height) : 0;
  const wentBack =
    backToGameCount >= 1 &&
    (await backToGame
      .first()
      .click()
      .then(() => page.waitForURL((url) => url.pathname === '/games/cs2', { timeout: 10000 }))
      .then(() => true)
      .catch(() => false));
  step(
    'G10',
    backToGameCount === 1 && backToTeamsCount === 0 && backHeight >= 24 && wentBack,
    `arrivé depuis /games/cs2 : lien « Back to the game » ${backToGameCount} (1 attendu), « Back to my teams » ${backToTeamsCount} (0 attendu — ce serait faux pour un compte sans équipe), hauteur ${backHeight}px (≥ 24 attendus, WCAG 2.5.8), retour effectif sur /games/cs2 = ${wentBack}`,
  );

  // Le REPLI, inchangé : sans origine dans l'entrée d'historique (URL collée, onglet neuf),
  // la page doit continuer de proposer « Back to my teams ».
  await page.goto(`${ORIGIN}/ladders/${cs2Team.id}`, { waitUntil: 'networkidle' });
  await appears(main.getByRole('heading', { level: 1, name: cs2Team.name }));
  const fallbackTeams = await main.getByRole('link', { name: /^back to my teams$/i }).count();
  const fallbackGame = await main.getByRole('link', { name: /^back to the game$/i }).count();
  step(
    'G10b',
    fallbackTeams === 1 && fallbackGame === 0,
    `arrivée par URL directe : « Back to my teams » ${fallbackTeams} (1 attendu — le repli est INCHANGÉ), « Back to the game » ${fallbackGame} (0 attendu)`,
  );

  // ------------------------------------------ §8 ?create= : le ladder est pré-sélectionné
  setPhase('8. /teams?create=<ladderId> : formulaire ouvert et ladder pré-sélectionné');
  await page.goto(`${ORIGIN}/games/cs2`, { waitUntil: 'networkidle' });
  const cta = ladderCard(cs2Team.name).getByRole('link', { name: 'Create a team', exact: true });
  const ctaVisible = await appears(cta);
  if (ctaVisible) await cta.click();
  const reachedTeams = ctaVisible
    ? await page
        .waitForURL((url) => url.pathname === '/teams' && url.search === `?create=${cs2Team.id}`, {
          timeout: 10000,
        })
        .then(() => true)
        .catch(() => false)
    : false;
  const formOpen = await appears(main.getByLabel('Team name'));
  // Le format pré-sélectionné : c'est LUI la valeur du champ, le bouton du jeu ne fait que
  // suivre. `aria-pressed` est l'état réel du composant, pas une classe CSS.
  const formatButton = main.getByRole('button', { name: cs2Team.format, exact: true });
  // ⚠️ ATTENDRE LE BOUTON, PAS LE FORMULAIRE. `LadderSelect` lance SA PROPRE requête (games +
  // ladders) à son montage : le champ « Team name » existe avant que la rangée de formats
  // n'apparaisse. Le premier jet lisait tout de suite et comptait 0 — check ROUGE, et la
  // cause n'était PAS la casse des libellés (mesuré : `exact: true` matche bien ici).
  const formatShown = await appears(formatButton);
  const formatCount = formatShown ? await formatButton.count() : 0;
  // ⚠️ Compter avant de lire : `getAttribute()` sur un locator vide LÈVE -> exit 2.
  const formatPressed = formatCount === 1 ? await formatButton.getAttribute('aria-pressed') : null;
  const gameButton = main.getByRole('button', { name: cs2.name, exact: true });
  const gameCount = await gameButton.count();
  const gamePressed = gameCount === 1 ? await gameButton.getAttribute('aria-pressed') : null;
  step(
    'G11',
    reachedTeams && formOpen && formatPressed === 'true' && gamePressed === 'true',
    `URL /teams?create=${cs2Team.id} atteinte = ${reachedTeams}, formulaire ouvert = ${formOpen}, jeu « ${cs2.name} » pré-sélectionné (aria-pressed « ${gamePressed ?? '—'} »), format « ${cs2Team.format} » pré-sélectionné (aria-pressed « ${formatPressed ?? '—'} ») — sans ça il faudrait re-choisir le ladder qu’on vient de choisir`,
  );

  // Fermer le formulaire doit AUSSI retirer le param, sinon le rendu suivant le rouvrirait :
  // l'état est dérivé de l'URL, pas copié dans un `useState`.
  const cancelButton = main.getByRole('button', { name: 'Cancel', exact: true });
  const cancelCount = await cancelButton.count();
  if (cancelCount === 1) await cancelButton.click();
  const paramDropped =
    cancelCount === 1 &&
    (await page
      .waitForURL((url) => url.pathname === '/teams' && url.search === '', { timeout: 10000 })
      .then(() => true)
      .catch(() => false));
  const backToList = await appears(main.getByRole('button', { name: 'Create new team' }));
  step(
    'G11b',
    cancelCount === 1 && paramDropped && backToList,
    `bouton « Cancel » : ${cancelCount} (1 attendu), param retiré de l’URL = ${paramDropped}, retour à la liste (bouton « Create new team ») = ${backToList}`,
  );

  // ---------------------------------------------- §9 un ?create= inconnu est ignoré
  setPhase('9. ?create=<uuid inconnu> : ignoré en silence');
  await page.goto(`${ORIGIN}/teams?create=${UNKNOWN_LADDER}`, { waitUntil: 'networkidle' });
  const listShown = await appears(main.getByRole('button', { name: 'Create new team' }));
  const formLeaked = await main.getByLabel('Team name').count();
  step(
    'G12',
    listShown && formLeaked === 0,
    `uuid inconnu en ?create= : liste rendue normalement = ${listShown}, formulaire ouvert : ${formLeaked} (0 attendu — un param inconnu n’ouvre rien et ne lève rien)`,
  );

  // ------------------------------------------------------------------ §10 375 px
  setPhase('10. la grille et la page d’un jeu à 375 px');
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${ORIGIN}/games`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const gridOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await page.goto(`${ORIGIN}/games/cs2`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const detailOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'G13',
    gridOverflow <= 0 && detailOverflow <= 0,
    `débordement horizontal à 375 px — /games : ${gridOverflow}px, /games/cs2 : ${detailOverflow}px (≤ 0 attendus)`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
}
