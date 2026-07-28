/**
 * `/ladders/$ladderId` — FT-3, page complète d'un ladder (règles, pool de maps, classement).
 *
 * Ce qui est vérifié ici :
 *   - un ladderId malformé rend un ÉCRAN D'ERREUR et ne consomme AUCUNE requête — le front
 *     applique la même règle uuid que le back, donc un 400 certain ne se paie pas en ligne
 *     rouge dans la console ;
 *   - un uuid inconnu rend l'écran 404 (déclaré via expectHttp : c'est l'état testé) ;
 *   - l'arrivée se fait PAR LE LIEN « See the full ladder » d'une page équipe, et ne
 *     redéclenche PAS `GET /ladders/{id}/rankings` : les deux écrans partagent la même
 *     entrée de cache ;
 *   - le titre affiché est bien celui que rend l'API (comparé à la réponse JSON) ;
 *   - un ladder sans compétiteur classé rend un état vide honnête, pas une erreur ;
 *   - le pool de maps affiché a EXACTEMENT les maps de l'API, et la section disparaît pour un
 *     jeu qui n'en a pas (chess, lol, rl) ;
 *   - les règles décrivent challenge/accept : aucune formulation de file d'attente ou
 *     d'appariement automatique (décision produit du 13/07) ;
 *   - rien ne déborde horizontalement à 375 px.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS. La base de dev n'a aucune ligne de classement (une
 * ligne naît d'un match TERMINÉ : il faut deux équipes, une acceptation, deux scores
 * concordants et `scheduledAt` dans le passé — hors de portée d'un scénario d'audit). Les
 * LIGNES du tableau (`LadderRow`, ses liens vers /teams/$teamId et /players/$pseudo) ne sont
 * donc jamais montées pendant le run : c'est l'état VIDE qui est couvert ici. Le rendu des
 * lignes a été vérifié à la main sur une base semée en SQL — voir le compte rendu du ticket.
 */
export const name = 'ladder-detail';
export const surface = '/ladders/$ladderId — 400/404, règles, pool de maps, classement vide';

const UNKNOWN_LADDER = '22222222-2222-4222-8222-222222222222';

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

/**
 * Les ladders de la base, lus par NODE (pas par le navigateur) : ces appels ne passent donc
 * pas par la console auditée. C'est la source de vérité contre laquelle on compare l'écran.
 */
async function fetchLadders(ORIGIN, user) {
  const auth = { authorization: `Bearer ${user.accessToken}` };
  const list = await fetch(`${ORIGIN}/api/ladders`, { headers: auth });
  if (!list.ok) throw new Error(`GET /ladders -> ${list.status}`);
  const { ladders } = await list.json();

  let withMaps;
  let withoutMaps;
  for (const ladder of ladders) {
    if (withMaps && withoutMaps) break;
    const res = await fetch(`${ORIGIN}/api/ladders/${ladder.id}`, { headers: auth });
    if (!res.ok) continue;
    const detail = await res.json();
    if (detail.maps.length > 0) withMaps ??= detail;
    else withoutMaps ??= detail;
  }

  return { withMaps, withoutMaps };
}

export async function run({ page, awaitAnnouncement, setPhase, step, countRequests, expectHttp, user, ORIGIN }) {
  const { withMaps, withoutMaps } = await fetchLadders(ORIGIN, user);
  if (!withMaps || !withoutMaps) {
    // Volontairement une erreur de HARNAIS (exit 2) : sans ces deux ladders, les checks du
    // pool de maps ne mesureraient rien et sortiraient verts par accident.
    throw new Error('base de dev sans ladder avec maps ET sans ladder sans maps (seed absent ?)');
  }

  setPhase('1. ladderId malformé -> écran d’erreur, zéro requête');
  // Le back valide ses params par Zod : un id non-uuid ne peut répondre que 400. Le front
  // applique la même règle et ne tape donc pas l'API du tout.
  const ladderCalls = await countRequests(
    async () => {
      await page.goto(`${ORIGIN}/ladders/not-a-uuid`, { waitUntil: 'networkidle' });
      await appears(page.locator('text=Invalid ladder link'));
    },
    (url) => url.includes('/api/ladders/'),
  );
  step('L1', ladderCalls === 0, `appels /api/ladders/… déclenchés : ${ladderCalls} (0 attendu)`);
  step(
    'L2',
    page.url().endsWith('/ladders/not-a-uuid'),
    `pas de redirection : ${new URL(page.url()).pathname}`,
  );

  setPhase('2. uuid inconnu -> écran 404');
  // Le 404 est L'OBJET du test : on le déclare pour qu'il soit listé à part au lieu d'être
  // imputé au ticket. Motif restreint à cet uuid précis, jamais à la route /ladders/.
  expectHttp(
    new RegExp(UNKNOWN_LADDER),
    'ladder inexistant demandé volontairement -> 404 attendu (détail + classement)',
  );
  await page.goto(`${ORIGIN}/ladders/${UNKNOWN_LADDER}`, { waitUntil: 'networkidle' });
  const notFound = await appears(page.locator('text=Ladder not found'));
  step(
    'L3',
    notFound && page.url().includes(UNKNOWN_LADDER),
    `écran 404 rendu = ${notFound}, URL conservée = ${page.url().includes(UNKNOWN_LADDER)}`,
  );

  setPhase('3. arrivée depuis une équipe, par « See the full ladder »');
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Create new team")');
  const form = page.locator('form');
  await form.waitFor();
  await form.locator('div.flex-wrap').first().locator('button').first().click();
  await page.fill('#team-name', `Audit FT3 ${user.stamp}`);
  await page.click('button:has-text("Create team")');
  // ⚠️ On attend le TEXTE de la région live, pas sa présence : elle est montée en
  // permanence, donc un waitFor sur le sélecteur seul n'attendrait rien.
  await awaitAnnouncement('was created');
  await page.locator('ul li a[href^="/teams/"]').first().click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });
  // Retenu pour la phase 5 : c'est CETTE équipe dont la ligne doit être surlignée.
  const myTeamId = page.url().match(/\/teams\/([0-9a-f-]{36})/)[1];
  // L'extrait de classement doit avoir FINI de charger avant qu'on mesure la navigation,
  // sinon le compteur de requêtes ne prouverait rien (la requête serait juste encore en vol).
  await page
    .locator('text=No team is ranked on this ladder yet.')
    .waitFor({ timeout: 15000 });

  const rankingCalls = await countRequests(
    async () => {
      await page.locator('a', { hasText: 'See the full ladder' }).click();
      await page.waitForURL(/\/ladders\/[0-9a-f-]{36}/, { timeout: 10000 });
      await appears(page.locator('h1'));
      await page.waitForTimeout(600);
    },
    (url) => url.includes('/rankings'),
  );
  step(
    'L4',
    rankingCalls === 0,
    `GET …/rankings rejoué à l’arrivée : ${rankingCalls} (0 attendu — même entrée de cache)`,
  );

  // Le titre vient-il vraiment de l'API ? On compare au JSON, pas à une constante du test.
  const arrivedId = page.url().match(/\/ladders\/([0-9a-f-]{36})/)[1];
  const arrived = await (
    await fetch(`${ORIGIN}/api/ladders/${arrivedId}`, {
      headers: { authorization: `Bearer ${user.accessToken}` },
    })
  ).json();
  const heading = (await page.locator('h1').first().textContent())?.trim();
  step('L5', heading === arrived.ladder.name, `h1 « ${heading} » = nom du ladder de l’API`);

  const emptyBoard = await page.locator('text=No competitor is ranked on this ladder yet').count();
  const strayBoard = await page.locator('ol[role="list"] li').count();
  step(
    'L6',
    emptyBoard === 1 && strayBoard === 0,
    `état vide du classement = ${emptyBoard === 1}, lignes résiduelles : ${strayBoard} (0 attendu)`,
  );

  // 🚨 Décision produit verrouillée : challenge/accept, PAS de file d'attente ni
  // d'appariement automatique. Une régression de copie doit se voir ici.
  //
  // ⚠️ Scopé à <main> depuis [F-Nav]. Ce check surveille la PROSE DE CETTE PAGE ; quand il a
  // été écrit, le rail n'existait pas et le document entier ÉTAIT la page. Depuis, la nav
  // persistante porte un item « Matchmaking » — le nom interne du cycle challenge/accept,
  // celui dont `openapi.yaml` tague déjà `POST /matches` — sur TOUTES les pages
  // authentifiées. Non scopé, le check comptait le mobilier de l'app et rendait rouge une
  // page dont la copie est irréprochable. Restreindre la portée préserve son intention ;
  // l'élargir au rail en ferait un contrôle de vocabulaire de navigation, ce qu'il n'est pas.
  const content = page.locator('main');
  const queueWording = await content
    .locator('text=/\\b(queue|queueing|matchmaking|auto-?match)\\b/i')
    .count();
  const challengeWording = await content.locator('text=A side opens a slot').count();
  step(
    'L7',
    queueWording === 0 && challengeWording === 1,
    `formulation file d’attente : ${queueWording} (0 attendu), challenge/accept présent = ${challengeWording === 1}`,
  );

  // Les 5 règles que la carte exige (B1 de la review). Trois d'entre elles manquaient à la
  // livraison initiale, c'est-à-dire la moitié du contrat produit que cet écran doit
  // expliquer — un check les fige. ⚠️ On vise les LIBELLÉS (`dt`), pas la prose : une
  // reformulation reste libre, la disparition d'une règle non.
  const ruleTerms = (await page.locator('dl dt').allTextContents()).map((t) => t.trim());
  const required = [
    'Slot', // créneau au quart d'heure + préavis minimum
    'Series', // best of 3
    'Lockout', // lockoutMinutes, valeur du ladder
    'Disagreement', // litige ouvert automatiquement
    'Unclaimed slot', // sort d'un slot que personne n'accepte
  ];
  const missing = required.filter((term) => !ruleTerms.includes(term));
  step(
    'L7b',
    missing.length === 0,
    `règles exigées présentes : ${required.length - missing.length}/${required.length}` +
      (missing.length > 0 ? ` — manquantes : ${missing.join(', ')}` : ''),
  );

  // `lockoutMinutes` doit venir du LADDER, jamais d'une constante : on compare au JSON.
  // ⚠️ `> dt` (enfant DIRECT) : sans ça, `:has()` remonterait aussi sur les div ancêtres.
  const lockoutText = (
    await page.locator('div:has(> dt:text-is("Lockout"))').first().innerText()
  ).trim();
  const lockoutOk = lockoutText.includes(`${arrived.ladder.lockoutMinutes} min`);
  step(
    'L7c',
    lockoutOk,
    `lockout affiché contient « ${arrived.ladder.lockoutMinutes} min » (valeur de l’API) : ${lockoutOk}`,
  );

  setPhase('4. pool de maps servi par l’API');
  await page.goto(`${ORIGIN}/ladders/${withMaps.ladder.id}`, { waitUntil: 'networkidle' });
  await page.locator('text=Map pool').waitFor({ timeout: 10000 });
  const shownMaps = await page.locator('ul[role="list"] li').allTextContents();
  const expectedMaps = withMaps.maps;
  const sameMaps =
    shownMaps.length === expectedMaps.length &&
    expectedMaps.every((map) => shownMaps.some((shown) => shown.trim() === map));
  step(
    'L8',
    sameMaps,
    `maps affichées (${shownMaps.length}) = maps de l’API (${expectedMaps.length}) pour ${withMaps.game.name}`,
  );

  // ─────────────────────────────────────────────────────────────────────────────────────
  // §5 LE CLASSEMENT PEUPLÉ — la seule zone que ce scénario ne pouvait pas voir.
  //
  // ⚠️ POURQUOI UNE INTERCEPTION plutôt qu'un semis : une ligne de `rankings` naît d'un match
  // TERMINÉ (deux équipes, une acceptation, deux scores concordants, `scheduledAt` dans le
  // passé). Hors de portée d'un scénario d'audit. Sans elle, `LadderRow` n'est JAMAIS monté :
  // ni les liens, ni les `aria-label`, ni le surlignage, ni la largeur réelle du tableau
  // n'étaient mesurés — et le check de largeur était vert par construction (voir L9b).
  //
  // On n'intercepte QU'APRÈS les checks de cache (L4) : la réponse fabriquée ne doit pas
  // fausser la mesure « 0 refetch ».
  setPhase('5. classement peuplé (réponse interceptée)');

  // Un nom volontairement long : c'est lui qui doit être tronqué, jamais pousser la colonne.
  const LONG_NAME = 'Les Vieux Briscards de la Dernière Chance';
  const injected = {
    rankings: [
      {
        rank: 1,
        elo: 1580,
        wins: 12,
        losses: 3,
        competitor: { type: 'team', id: '11111111-1111-4111-8111-111111111111', name: LONG_NAME, logoUrl: null },
      },
      {
        rank: 2,
        elo: 1204,
        wins: 4,
        losses: 4,
        competitor: { type: 'user', id: '33333333-3333-4333-8333-333333333333', pseudo: 'solo_player', displayName: null, avatarUrl: null },
      },
      // MA team : sa ligne doit être surlignée ET ne pas être un lien (elle pointerait ici).
      {
        rank: 3,
        elo: 1000,
        wins: 0,
        losses: 0,
        competitor: { type: 'team', id: myTeamId, name: `Audit FT3 ${user.stamp}`, logoUrl: null },
      },
    ],
  };
  await page.route(/\/api\/ladders\/[0-9a-f-]{36}\/rankings/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(injected),
    }),
  );
  await page.goto(`${ORIGIN}/ladders/${arrivedId}`, { waitUntil: 'networkidle' });
  const board = page.locator('ol[role="list"]');
  await board.waitFor({ timeout: 10000 });

  const rows = page.locator('ol[role="list"] > li');
  const rowCount = await rows.count();
  const hrefs = await page.locator('ol[role="list"] > li a').evaluateAll((links) =>
    links.map((a) => a.getAttribute('href')),
  );
  step(
    'L11',
    rowCount === injected.rankings.length &&
      hrefs.some((h) => h === '/teams/11111111-1111-4111-8111-111111111111') &&
      hrefs.some((h) => h === '/players/solo_player'),
    `lignes rendues : ${rowCount}/${injected.rankings.length}, liens : ${hrefs.join(', ') || 'aucun'} (équipe -> /teams/:id, joueur -> /players/:pseudo)`,
  );

  // Le compétiteur consulté est surligné ET n'est pas un lien : il pointerait sur cette page.
  const selfRow = page.locator('ol[role="list"] > li [aria-current="true"]');
  const selfCount = await selfRow.count();
  const selfIsLink = await page
    .locator(`ol[role="list"] > li a[href="/teams/${myTeamId}"]`)
    .count();
  step(
    'L12',
    selfCount === 1 && selfIsLink === 0,
    `ligne de mon équipe surlignée : ${selfCount} (1 attendue), et rendue en lien : ${selfIsLink} (0 attendu)`,
  );

  // Chaque ligne cliquable porte son propre résumé : l'en-tête visuel est `aria-hidden`
  // (c'est une grille, pas un <table>), donc sans ce label un lecteur d'écran n'entend
  // qu'une suite de nombres nus.
  const labels = await page.locator('ol[role="list"] > li a').evaluateAll((links) =>
    links.map((a) => a.getAttribute('aria-label') ?? ''),
  );
  const labelled = labels.filter((l) => /^Rank \d+, .+, \d+ Elo, /.test(l));
  step(
    'L13',
    labelled.length === labels.length && labels.length > 0,
    `aria-label complets sur les lignes cliquables : ${labelled.length}/${labels.length}`,
  );

  // AU CLAVIER : une ligne doit être atteignable et porter un anneau de focus visible.
  await page.locator('ol[role="list"] > li a').first().focus();
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName ?? null, label: el?.getAttribute('aria-label') ?? '' };
  });
  step(
    'L14',
    focused.tag === 'A' && focused.label.startsWith('Rank '),
    `focus clavier sur une ligne : <${focused.tag}> « ${focused.label.slice(0, 40) }… »`,
  );

  setPhase('6. largeur mobile 375 px, tableau PEUPLÉ');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step('L9', overflow <= 0, `débordement horizontal du document : ${overflow}px (0 attendu)`);

  // ⚠️ L9 NE SUFFIT PAS et ne suffisait pas : la boîte du tableau est en `overflow-hidden`,
  // elle CLIPPE son propre débordement au lieu de le propager au document. L9 était donc vert
  // par construction, quoi qu'il arrive aux colonnes. On mesure la boîte elle-même, et la
  // largeur RENDUE du nom : un nom à 0 px est illisible sans rien faire déborder.
  const boxed = await page
    .locator('div.overflow-hidden.rounded-card:has(ol[role="list"])')
    .first()
    .evaluate((el) => {
      const name = el.querySelector('ol > li span.truncate');
      return {
        scroll: el.scrollWidth,
        client: el.clientWidth,
        nameWidth: name ? Math.round(name.getBoundingClientRect().width) : -1,
      };
    });
  step(
    'L9b',
    boxed.scroll <= boxed.client && boxed.nameWidth >= 60,
    `tableau à 375 px : scrollWidth=${boxed.scroll} vs clientWidth=${boxed.client} (débordement ${boxed.scroll - boxed.client}px, 0 attendu), largeur rendue du nom = ${boxed.nameWidth}px (≥ 60 attendu)`,
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  // ⚠️ L'interception est levée AVANT la phase suivante : le ladder sans maps doit répondre
  // son VRAI classement (vide), sinon L10 mesurerait notre fabrication.
  await page.unroute(/\/api\/ladders\/[0-9a-f-]{36}\/rankings/);

  setPhase('7. ladder sans pool de maps -> section masquée');
  await page.goto(`${ORIGIN}/ladders/${withoutMaps.ladder.id}`, { waitUntil: 'networkidle' });
  await page.locator('text=Standings').waitFor({ timeout: 10000 });
  const mapSection = await page.locator('text=Map pool').count();
  step(
    'L10',
    mapSection === 0,
    `section « Map pool » sur ${withoutMaps.game.name} (pool vide) : ${mapSection} (0 attendu)`,
  );
}
