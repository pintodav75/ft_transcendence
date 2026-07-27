/**
 * `/teams/$teamId` — FT-2A, page de consultation (lecture seule).
 *
 * Réécrit intégralement : l'ancien scénario auditait le brouillon (console.log,
 * alert(), trois window.confirm, un 404 par frappe de la SearchBar), tout ce code
 * a été jeté. Ce qui est vérifié ici :
 *   - un teamId malformé rend un ÉCRAN D'ERREUR (plus de redirection silencieuse) et
 *     ne consomme AUCUNE requête — le front applique la même règle uuid que le back ;
 *   - un uuid inconnu rend l'écran 404 (le 404 est déclaré via expectHttp : c'est
 *     l'état testé, pas du bruit) ;
 *   - une équipe fraîche est ABSENTE du classement -> état « Not ranked yet », jamais
 *     un Elo inventé ;
 *   - l'onglet Matches d'une équipe sans match rend un état vide honnête ;
 *   - les onglets répondent aux flèches (pattern WAI-ARIA) ;
 *   - les trois placeholders (/players/$pseudo, /matches/$matchId, /ladders/$ladderId) ne
 *     parlent pas, et celui du ladder est atteint PAR LE LIEN « See the full ladder » ;
 *   - rien ne déborde horizontalement à 375 px.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS. Il travaille sur une équipe créée à la volée par
 * l'API, donc SANS AUCUN MATCH : `MatchRow`, les pastilles de statut, le bandeau de litige,
 * le bloc « Next match » et les lignes de l'extrait de classement ne sont jamais montés
 * pendant le run. Le check A13 (« aucune colonne Line-up pour un non-membre ») en découle :
 * il constate l'absence de `th` sur une page qui n'a pas de tableau du tout — il ne prouve
 * pas le gating, il prouve seulement qu'il ne régresse pas VERS un tableau. Fabriquer un
 * historique par l'API est hors de portée ici (il faut deux équipes, une acceptation, un
 * résultat, et `scheduledAt` doit être à +15 min minimum). Le gating a donc été vérifié à la
 * main sur les 3 rôles avec un seed SQL, et la vue membre l'est par les captures.
 */
export const name = 'teams-detail';
export const surface =
  '/teams/$teamId — erreurs 400/404, équipe non classée, onglets, placeholders';

const UNKNOWN_TEAM = '00000000-0000-0000-0000-000000000000';
// Un uuid DISTINCT pour le placeholder de match : réutiliser UNKNOWN_TEAM ferait porter à
// deux surfaces différentes le même motif expectHttp().
const UNKNOWN_MATCH = '11111111-1111-4111-8111-111111111111';

/**
 * `waitFor` qui rend `false` au lieu de lever. Un `waitFor` nu fait sortir le harnais en
 * **exit 2** (« le harnais a échoué ») : une régression de l'écran 404 serait alors lue
 * comme un problème d'environnement, pas comme un défaut du ticket.
 */
const appears = (locator, timeout = 10000) =>
  locator
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);

export async function run({
  page,
  setPhase,
  step,
  countRequests,
  expectHttp,
  createUser,
  login,
  user,
  ORIGIN,
}) {
  setPhase('1. teamId malformé -> écran d’erreur, zéro requête');
  // Le back valide ses params par Zod : un id non-uuid ne peut répondre que 400. Le front
  // applique la même règle et ne tape donc pas l'API du tout.
  const teamCalls = await countRequests(
    async () => {
      await page.goto(`${ORIGIN}/teams/not-a-uuid`, { waitUntil: 'networkidle' });
      await page.locator('text=Invalid team link').waitFor({ timeout: 10000 });
    },
    (url) => url.includes('/api/teams/'),
  );
  step('A1', teamCalls === 0, `appels /api/teams/… déclenchés : ${teamCalls} (0 attendu)`);
  step(
    'A2',
    page.url().endsWith('/teams/not-a-uuid'),
    `pas de redirection : ${new URL(page.url()).pathname}`,
  );

  setPhase('2. uuid inconnu -> écran 404');
  // Le 404 est L'OBJET du test : on le déclare pour qu'il soit listé à part au lieu d'être
  // imputé au ticket. Motif restreint à cet uuid précis, jamais à la route /teams/.
  expectHttp(new RegExp(UNKNOWN_TEAM), 'équipe inexistante demandée volontairement -> 404 attendu');
  await page.goto(`${ORIGIN}/teams/${UNKNOWN_TEAM}`, { waitUntil: 'networkidle' });
  const notFound = await appears(page.locator('text=Team not found'));
  step(
    'A3',
    notFound && page.url().includes(UNKNOWN_TEAM),
    `écran 404 rendu = ${notFound}, URL conservée = ${page.url().includes(UNKNOWN_TEAM)}`,
  );

  setPhase('3. équipe fraîche -> « Not ranked yet »');
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Create new team")');
  const form = page.locator('form');
  await form.waitFor();
  await form.locator('div.flex-wrap').first().locator('button').first().click();
  await page.fill('#team-name', `Audit FT2A ${user.stamp}`);
  await page.click('button:has-text("Create team")');
  await page.locator('[role="status"]').first().waitFor({ timeout: 15000 });
  await page.locator('ul li a').first().click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });
  const teamUrl = page.url();
  // La page enchaîne GET /teams/{id} PUIS GET /ladders/{ladderId}/rankings : compter avant
  // que la puce de roster existe mesurerait le squelette de chargement.
  // ⚠️ Scopé au panneau VISIBLE depuis FT-2B : le capitaine voit le roster DEUX fois (onglet
  // Overview et onglet Manage), les deux panneaux restant montés. Un locator nu résout donc
  // 2 éléments et Playwright refuse d'agir (strict mode).
  const rosterChip = page.locator(
    `[role="tabpanel"]:not([hidden]) a[href$="/players/${user.pseudo}"]`,
  );
  await rosterChip.waitFor({ timeout: 15000 });
  await page.locator('dl').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);

  const notRanked = await page.locator('text=Not ranked yet').count();
  // La ligne de classement naît au PREMIER résultat de match : Elo/record/rang restent à —.
  const dashes = await page.locator('dd', { hasText: '—' }).count();
  step('A4', notRanked === 1, `état « Not ranked yet » présent = ${notRanked === 1}`);
  step('A5', dashes >= 3, `stats à — (Elo, record, rang) : ${dashes}`);

  const roster = await rosterChip.count();
  step('A6', roster === 1, `puce de roster liée à /players/${user.pseudo} = ${roster === 1}`);

  setPhase('4. onglet Matches au clavier -> état vide');
  const overviewTab = page.locator('[role="tab"]', { hasText: 'Overview' });
  await overviewTab.focus();
  await page.keyboard.press('ArrowRight');
  const matchesTab = page.locator('[role="tab"]', { hasText: 'Matches' });
  // `getAttribute` n'est pas ré-essayé par Playwright : on attend la condition, sinon on
  // lirait l'attribut avant que React ait re-rendu (faux rouge).
  const arrowWorked = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[role="tab"]')].some(
          (t) => t.textContent.trim() === 'Matches' && t.getAttribute('aria-selected') === 'true',
        ),
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  const emptyHistory = await appears(page.locator('text=No match yet'));
  const strayTable = await page.locator('table').count();
  step('A7', arrowWorked, `flèche droite sélectionne Matches = ${arrowWorked}`);
  step(
    'A8',
    emptyHistory && strayTable === 0,
    `état vide rendu = ${emptyHistory}, tableau vide résiduel : ${strayTable} (0 attendu)`,
  );

  setPhase('5. largeur mobile 375 px');
  // Mesuré sur l'onglet Overview : c'est lui qui porte les grilles larges (roster,
  // extrait de classement). L'historique de cette équipe est vide, il ne prouverait rien.
  await overviewTab.click();
  await rosterChip.waitFor({ timeout: 10000 });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step('A9', overflow <= 0, `débordement horizontal du document : ${overflow}px (0 attendu)`);
  await page.setViewportSize({ width: 1280, height: 900 });

  setPhase('6. placeholders /players, /matches et /ladders');
  await rosterChip.first().click();
  await page.waitForURL(`**/players/${user.pseudo}`, { timeout: 10000 });
  await page.goBack();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });
  const matchApiCalls = await countRequests(
    async () => {
      await page.goto(`${ORIGIN}/matches/${UNKNOWN_MATCH}`, { waitUntil: 'networkidle' });
      await appears(page.locator('text=Match sheet'));
    },
    (url) => url.includes('/api/matches/'),
  );
  const matchPlaceholder = await page.locator('text=Match sheet').count();
  step(
    'A10',
    matchPlaceholder === 1 && matchApiCalls === 0,
    `placeholder de match rendu (${matchPlaceholder}), appels /api/matches/ : ${matchApiCalls} (0 attendu)`,
  );

  // « See the full ladder » : l'extrait ne montre que 5 lignes, le lien doit mener quelque
  // part. On y va par le CLIC, pas par une URL forgée — c'est le lien qu'on vérifie.
  await page.goto(teamUrl, { waitUntil: 'networkidle' });
  await page.locator('a', { hasText: 'See the full ladder' }).click();
  await page.waitForURL(/\/ladders\/[0-9a-f-]{36}/, { timeout: 10000 });
  // Attendre le rendu avant de compter : l'URL change avant que le composant soit monté.
  const ladderRendered = await appears(page.locator('text=map pool'));
  step(
    'A11',
    ladderRendered,
    `lien du ladder -> placeholder /ladders/$ladderId = ${ladderRendered}`,
  );

  // La divulgation progressive est le cœur du ticket : on la vérifie avec un VRAI second
  // compte, pas en simulant. Le shell authentifié n'expose aucun bouton de déconnexion
  // (LeftRail est vide depuis F0-C), d'où le vidage de cookies avant le login.
  const visitor = await createUser();
  await page.context().clearCookies();
  await login(visitor);
  // APRÈS login() : login() pose sa propre phase (« login (hors périmètre) »), donc un
  // setPhase avant lui serait écrasé et les entrées du visiteur seraient étiquetées « login ».
  setPhase('7. même page vue par un non-membre');
  await page.goto(teamUrl, { waitUntil: 'networkidle' });
  await page.locator(`a[href$="/players/${user.pseudo}"]`).waitFor({ timeout: 15000 });

  // Les DEUX variantes, sinon faux négatif : un compte lié rend « Epic linked » (sans le
  // mot « account ») et un compte absent rend « no Epic account ». Ne compter que la
  // seconde laisserait passer une fuite sur une équipe dont tous les membres sont liés —
  // état que ce scénario ne peut pas produire (il crée un compte neuf, donc non lié).
  const accountState =
    (await page.locator('text=account').count()) + (await page.locator('text=linked').count());
  step(
    'A12',
    accountState === 0,
    `état de compte lié exposé au visiteur : ${accountState} (0 attendu)`,
  );

  await page.locator('[role="tab"]', { hasText: 'Matches' }).click();
  await page.locator('text=No public match yet').waitFor({ timeout: 10000 });
  const lineupHeader = await page.locator('th', { hasText: 'Line-up' }).count();
  step('A13', lineupHeader === 0, 'aucune colonne Line-up pour un non-membre');
}
