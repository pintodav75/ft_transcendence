/**
 * `/teams/$teamId` — FT-2B, onglet Manage (gestion capitaine).
 *
 * Ce que le scénario vérifie :
 *   - l'onglet **Manage** n'existe que pour le capitaine, et la barre à 3 onglets ne lève
 *     aucune barre de défilement à 375 px (le piège CSS de FT-2A) ;
 *   - renommage : nominal (200 + en-tête ET grille `/teams` à jour sans rechargement) puis
 *     conflit (409 déclaré, message posé SUR le champ, `aria-invalid` compris) ;
 *   - logo : type refusé et fichier > 2 Mo sont arrêtés CÔTÉ CLIENT (zéro requête), un
 *     fichier valide affiche une progression puis part en 200, et « Remove logo » le retire ;
 *   - recherche de joueur : 1 caractère ne déclenche aucune requête, 2 caractères en
 *     déclenchent une seule, et **aucun 404 sur tout le parcours** (c'est la régression que
 *     `GET /users/{pseudo}` produisait à chaque frappe) ;
 *   - ajout refusé (409 déclaré) puis accepté (201), exclusion, et retour du joueur ;
 *   - l'onglet Manage **au repos** ne parle pas (mesure de référence : sans elle, une requête
 *     tardive d'une autre origine serait imputée au dialogue) ;
 *   - `ConfirmDialog` : ouvrir/fermer ne coûte aucune requête, Escape ferme sans muter, et
 *     **aucune boîte native** (`window.confirm`) n'est apparue de tout le run ;
 *   - un membre non-capitaine n'a pas l'onglet Manage, peut quitter, et atterrit sur
 *     `/teams` ;
 *   - la dissolution atterrit sur `/teams` **sans un seul 404** — c'est ce check qui valide
 *     l'ordre `navigate` → `removeQueries` de `useDissolveTeam`.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - **Le roster plein.** L'état « This roster is full » et le 409 « team is full »
 *     demanderaient 10 comptes : le bloc désactivé n'est jamais rendu ici.
 *   - **Le même joueur ajouté deux fois.** C'est INATTEIGNABLE par l'UI : dès qu'un joueur
 *     est au roster, `excludeIds` le retire des résultats de recherche, il n'y a plus rien à
 *     cliquer. Le 409 est donc provoqué par l'autre cause du même statut — un joueur déjà
 *     engagé dans une équipe de ce ladder — qui emprunte le même chemin de code et le même
 *     rendu de message (verbatim serveur).
 *   - **Le rendu visuel** (contraste, alignements) et la **restauration du focus après un
 *     kick** : la puce qui portait le bouton disparaît avec le membre, le focus retombe donc
 *     sur `<body>`. À constater à l'œil, pas mesurable ici.
 *   - **403 (capitaine destitué) et 429** : mappés dans `team-mutations.ts`, jamais
 *     déclenchés ici.
 *   - L'équipe créée à la volée **n'a aucun match** : rien ne dit ce que devient un
 *     historique quand un joueur aligné est exclu.
 */
export const name = 'teams-manage';
export const surface = '/teams/$teamId — onglet Manage : renommage, logo, roster, dissolution';

export async function run({
  page,
  setPhase,
  step,
  countRequests,
  expectHttp,
  createUser,
  login,
  user,
  fixtures,
  ORIGIN,
}) {
  // Filet transverse : un seul 404 sur tout le parcours suffit à faire rougir la console
  // d'un correcteur. On les collecte pour pouvoir DIRE lesquels, pas seulement « il y en a ».
  const notFound = [];
  page.on('response', (res) => {
    if (res.status() === 404) notFound.push(res.url());
  });

  // Le runner a déjà un handler `dialog` (il rejette la boîte pour ne pas figer le
  // navigateur piloté) ; celui-ci ne fait que COMPTER. Zéro = plus aucun window.confirm.
  let nativeDialogs = 0;
  page.on('dialog', () => {
    nativeDialogs += 1;
  });

  /**
   * Appel API direct, pour fabriquer un état que l'UI ne sait pas produire (l'équipe rivale).
   *
   * ⚠️ `content-type: application/json` est posé UNIQUEMENT s'il y a un corps : Fastify
   * refuse en 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`) une requête qui annonce du JSON et
   * n'en envoie pas — le DELETE échouait en silence et le joueur restait engagé.
   */
  const api = (as, path, init = {}) => {
    const headers = { authorization: `Bearer ${as.accessToken}`, ...(init.headers ?? {}) };
    if (init.body) headers['content-type'] = 'application/json';
    return fetch(`${ORIGIN}/api${path}`, { ...init, headers });
  };

  const openManage = async () => {
    await page.getByRole('tab', { name: 'Manage' }).click();
    await page.getByLabel('Team name').waitFor({ timeout: 10000 });
  };

  // ------------------------------------------------------------------ §1 l'onglet Manage
  setPhase('1. capitaine : création de l’équipe puis onglet Manage');
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Create new team")');
  const form = page.locator('form');
  await form.waitFor();
  // Premier groupe de boutons = les jeux ; le clic sélectionne aussi le premier ladder.
  await form.locator('div.flex-wrap').first().locator('button').first().click();
  await page.fill('#team-name', `Audit FT2B ${user.stamp}`);
  await page.click('button:has-text("Create team")');
  await page.locator('[role="status"]').first().waitFor({ timeout: 15000 });
  await page.locator('ul li a').first().click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });

  const teamUrl = page.url();
  const teamId = new URL(teamUrl).pathname.split('/').pop();

  const tabStrip = page.locator('[role="tablist"]');
  await tabStrip.waitFor({ timeout: 15000 });
  // ⚠️ `innerText` rend le texte TEL QU'AFFICHÉ : `label-caps` applique `text-transform:
  // uppercase`, donc « Manage » revient en « MANAGE ». On compare en minuscules.
  const tabLabels = (await page.locator('[role="tab"]').allInnerTexts()).map((t) =>
    t.trim().toLowerCase(),
  );
  step(
    'B1',
    tabLabels.length === 3 && tabLabels.includes('manage'),
    `onglets du capitaine : ${tabLabels.join(' / ')} (overview / matches / manage attendus)`,
  );

  await openManage();

  // ------------------------------------------------------------------ §2 largeurs
  setPhase('2. largeurs : 616 px de colonne centrale, puis 375 px');
  // La colonne centrale du shell ne fait que 616 px à 1280 : une section qui réclame plus
  // sort du champ SANS RIEN DIRE. On mesure, on ne regarde pas.
  const panelBox = await page
    .locator('[role="tabpanel"]:not([hidden])')
    .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  step(
    'B2',
    panelBox.scroll <= panelBox.client,
    `panneau Manage à 1280 px : scrollWidth=${panelBox.scroll} vs clientWidth=${panelBox.client}`,
  );

  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(400);
  const stripBox = await tabStrip.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  const docOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'B3',
    stripBox.scroll === stripBox.client && docOverflow <= 0,
    `barre à 3 onglets à 375 px : scrollWidth=${stripBox.scroll}/clientWidth=${stripBox.client}, débordement du document ${docOverflow}px`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);

  // ------------------------------------------------------------------ §3 renommage nominal
  setPhase('3. renommage nominal');
  const nameField = page.getByLabel('Team name');
  const renamedTo = `Audit FT2B ${user.stamp} v2`;
  await nameField.fill(renamedTo);
  const renamePromise = page.waitForResponse(
    (r) => r.url().endsWith(`/api/teams/${teamId}`) && r.request().method() === 'PATCH',
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Save name' }).click();
  const renameRes = await renamePromise;
  const headingUpdated = await page
    .locator('h1', { hasText: renamedTo })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step(
    'B4',
    renameRes.status() === 200 && headingUpdated,
    `PATCH -> HTTP ${renameRes.status()}, en-tête à jour = ${headingUpdated}`,
  );

  // La grille est un AUTRE consommateur du cache : elle doit suivre sans rechargement, donc
  // par une navigation CLIENT (le lien « My teams »), jamais par un page.reload().
  await page.getByRole('link', { name: 'My teams' }).click();
  await page.waitForURL(/\/teams$/, { timeout: 10000 });
  const inGrid = await page
    .getByText(renamedTo, { exact: true })
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step('B5', inGrid, `grille /teams à jour sans rechargement = ${inGrid}`);

  await page.goBack();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });
  await openManage();

  // ------------------------------------------------------------------ §4 renommage en conflit
  // L'équipe rivale sert DEUX fois : son nom provoque le 409 du renommage, et son capitaine
  // est « déjà engagé sur ce ladder » pour le 409 de l'ajout de membre.
  const rival = await createUser();
  const ladderId = await api(user, `/teams/${teamId}`)
    .then((r) => r.json())
    .then(({ team }) => team.ladderId);
  const rivalName = `Audit rival ${user.stamp}`;
  const rivalTeamId = await api(rival, '/teams', {
    method: 'POST',
    body: JSON.stringify({ ladderId, name: rivalName }),
  })
    .then((r) => r.json())
    .then(({ team }) => team.id);

  setPhase('4. renommage vers un nom déjà pris -> 409');
  // Le motif ne peut pas viser mieux que la route : deux 409 différents partagent l'URL
  // /teams/<id>. C'est le CLOISONNEMENT PAR PHASE qui discrimine (README, garde-fou n°2) —
  // aucun autre appel à cette URL n'échoue dans cette phase.
  expectHttp(
    new RegExp(`/teams/${teamId}`),
    'renommage vers un nom déjà pris sur ce ladder -> 409 attendu',
  );
  await nameField.fill(rivalName);
  const conflictPromise = page.waitForResponse(
    (r) => r.url().endsWith(`/api/teams/${teamId}`) && r.request().method() === 'PATCH',
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Save name' }).click();
  const conflictRes = await conflictPromise;

  const fieldMessageShown = await page
    .locator('text=This name is already taken on this ladder.')
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  // Le message doit être RATTACHÉ au champ, pas juste posé quelque part dans la page :
  // sans aria-describedby un lecteur d'écran ne l'annonce jamais.
  const describedBy = await nameField.getAttribute('aria-describedby');
  const describedText = describedBy
    ? await page.locator(`[id="${describedBy}"]`).innerText()
    : '';
  const invalid = await nameField.getAttribute('aria-invalid');
  step(
    'B6',
    conflictRes.status() === 409 && fieldMessageShown && invalid === 'true' && describedText.includes('already taken'),
    `HTTP ${conflictRes.status()}, aria-invalid=${invalid}, message décrit le champ = « ${describedText.trim()} »`,
  );

  // Le champ reste sur le nom refusé : on le remet sur le nom réel pour la suite.
  await nameField.fill(renamedTo);

  // ------------------------------------------------------------------ §5 logo
  const fileInput = page.locator('input[type=file]');

  setPhase('5. logo : type refusé côté client');
  let logoCalls = await countRequests(
    async () => {
      await fileInput.setInputFiles(fixtures.bad);
      await page.waitForTimeout(500);
    },
    (url) => url.includes('/logo'),
  );
  const badTypeMessage = await page.locator('text=Use a JPEG, PNG or WebP image.').count();
  step(
    'B7',
    badTypeMessage === 1 && logoCalls === 0,
    `message affiché = ${badTypeMessage === 1}, requêtes /logo : ${logoCalls} (0 attendu)`,
  );

  setPhase('6. logo : > 2 Mo refusé côté client');
  logoCalls = await countRequests(
    async () => {
      await fileInput.setInputFiles(fixtures.big);
      await page.waitForTimeout(800);
    },
    (url) => url.includes('/logo'),
  );
  const tooLargeMessage = await page.locator('text=Image is too large').count();
  step(
    'B8',
    tooLargeMessage === 1 && logoCalls === 0,
    `message affiché = ${tooLargeMessage === 1}, requêtes /logo : ${logoCalls} (0 attendu)`,
  );

  setPhase('7. logo : fichier valide -> progression puis 200');
  const uploadPromise = page.waitForResponse(
    (r) => /\/api\/teams\/[^/]+\/logo$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  // Le guetteur est armé AVANT la sélection : la barre naît avec le premier octet et meurt
  // au refetch, la fenêtre est courte.
  const progressWatch = page
    .locator('[role="progressbar"]')
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  await fileInput.setInputFiles(fixtures.ok);
  const progressSeen = await progressWatch;
  const uploadRes = await uploadPromise;
  // `complete && naturalWidth` lu UNE fois est une course : l'élément peut être visible et
  // l'image encore en vol. On attend la condition, on ne l'échantillonne pas.
  const logoDecoded = await page
    .waitForFunction(
      () => {
        const img = document.querySelector('img[src^="/media/"]');
        return Boolean(img && img.complete && img.naturalWidth > 0);
      },
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  step(
    'B9',
    uploadRes.status() === 200 && progressSeen && logoDecoded,
    `POST .../logo -> HTTP ${uploadRes.status()}, barre de progression vue = ${progressSeen}, logo /media décodé = ${logoDecoded}`,
  );

  setPhase('7b. retrait du logo -> PATCH { logoUrl: null }');
  const clearLogoPromise = page.waitForResponse(
    (r) => r.url().endsWith(`/api/teams/${teamId}`) && r.request().method() === 'PATCH',
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Remove logo' }).click();
  const clearLogoRes = await clearLogoPromise;
  const logoCleared = await page
    .waitForFunction(() => document.querySelector('img[src^="/media/"]') === null, {
      timeout: 15000,
    })
    .then(() => true)
    .catch(() => false);
  step(
    'B9b',
    clearLogoRes.status() === 200 && logoCleared,
    `PATCH { logoUrl: null } -> HTTP ${clearLogoRes.status()}, plus aucune image /media affichée = ${logoCleared}`,
  );

  // ------------------------------------------------------------------ §6 recherche
  const searchField = page.getByLabel('Search players');
  const rivalRow = page.locator(`button:has-text("@${rival.pseudo}")`);

  /**
   * Saisit le pseudo et ATTEND la réponse de `/search` avant de rendre la main.
   *
   * ⚠️ Sans cette attente le scénario clique la liste PRÉCÉDENTE : pendant le débounce,
   * `UserSearch` continue d'afficher les résultats de la frappe d'avant. On cliquait donc
   * une ligne obtenue par une autre requête, et la recherche demandée partait APRÈS le clic —
   * exactement le « appel fantôme » qu'on cherchait ensuite dans les mesures.
   */
  const searchForRival = async () => {
    await searchField.fill('');
    const answered = page.waitForResponse(
      (r) => r.url().includes('/api/search') && r.url().includes(`q=${rival.pseudo}`),
      { timeout: 20000 },
    );
    await searchField.fill(rival.pseudo);
    await answered;
    await rivalRow.waitFor({ timeout: 15000 });
  };

  setPhase('8. recherche : 1 caractère -> aucune requête');
  let searchCalls = await countRequests(
    async () => {
      await searchField.fill('a');
      await page.waitForTimeout(900);
    },
    (url) => url.includes('/api/search'),
  );
  step('B10', searchCalls === 0, `appels /api/search sous la borne : ${searchCalls} (0 attendu)`);

  setPhase('9. recherche : 2 caractères -> une seule requête');
  const searchPromise = page.waitForResponse((r) => r.url().includes('/api/search'), {
    timeout: 15000,
  });
  searchCalls = await countRequests(
    async () => {
      await searchField.fill('au');
      await page.waitForTimeout(900);
    },
    (url) => url.includes('/api/search'),
  );
  const searchRes = await searchPromise;
  step(
    'B11',
    searchRes.status() === 200 && searchCalls === 1,
    `GET /search -> HTTP ${searchRes.status()}, ${searchCalls} requête(s) pour une saisie (1 attendue)`,
  );

  // ------------------------------------------------------------------ §7 ajout refusé
  setPhase('10. ajout d’un joueur déjà engagé sur ce ladder -> 409');
  expectHttp(
    new RegExp(`/teams/${teamId}/members`),
    'joueur déjà dans une équipe de ce ladder -> 409 attendu',
  );
  await searchForRival();
  const addConflictPromise = page.waitForResponse(
    (r) => r.url().endsWith(`/api/teams/${teamId}/members`) && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await rivalRow.click();
  const addConflictRes = await addConflictPromise;
  const conflictMessage = await page
    .locator('text=already in a team on this ladder')
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step(
    'B12',
    addConflictRes.status() === 409 && conflictMessage,
    `POST /members -> HTTP ${addConflictRes.status()}, message serveur affiché verbatim = ${conflictMessage}`,
  );

  // ------------------------------------------------------------------ §8 ajout nominal
  // Libère le joueur : tant que son équipe existe, l'ajout ne peut QUE répondre 409.
  const rivalTeamGone = await api(rival, `/teams/${rivalTeamId}`, { method: 'DELETE' });

  setPhase('11. ajout nominal -> 201');
  const addMember = async () => {
    await searchForRival();
    const promise = page.waitForResponse(
      (r) => r.url().endsWith(`/api/teams/${teamId}/members`) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await rivalRow.click();
    return promise;
  };

  // ⚠️ Scopé au panneau VISIBLE : le roster est rendu deux fois (Overview et Manage), et
  // la copie de l'onglet inactif est `hidden` — un `.first()` nu attendrait la mauvaise.
  const rivalChip = page.locator(
    `[role="tabpanel"]:not([hidden]) a[href$="/players/${rival.pseudo}"]`,
  );
  const addRes = await addMember();
  const chipAppeared = await rivalChip
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'B13',
    addRes.status() === 201 && chipAppeared,
    `dissolution de l’équipe rivale -> HTTP ${rivalTeamGone.status}, POST /members -> HTTP ${addRes.status()}, puce de roster apparue = ${chipAppeared}`,
  );

  // ------------------------------------------------------------------ §9 ConfirmDialog
  setPhase('12a. onglet Manage au repos : aucune requête');
  // L'ajout qui précède invalide trois clés de cache ; leurs refetch partent APRÈS que la
  // puce soit apparue. Sans cette attente ils tomberaient dans la fenêtre de mesure et on
  // imputerait au dialogue une requête qui ne lui appartient pas.
  await page.waitForLoadState('networkidle');
  // Mesure de RÉFÉRENCE, sans aucune interaction : elle sépare « le dialogue coûte une
  // requête » de « quelque chose parle tout seul sur cet onglet ». Sans elle, la seconde
  // cause serait imputée au dialogue.
  const idleUrls = [];
  const idleCalls = await countRequests(
    async () => {
      await page.waitForTimeout(1500);
    },
    (url) => {
      if (!url.includes('/api/')) return false;
      idleUrls.push(url.replace(ORIGIN, ''));
      return true;
    },
  );
  step(
    'B14a',
    idleCalls === 0,
    `requêtes /api sur l’onglet Manage au repos : ${idleCalls} (0 attendu)${idleUrls.length ? ` -> ${idleUrls.join(', ')}` : ''}`,
  );

  setPhase('12b. ConfirmDialog : ouverture/Escape sans aucune mutation');
  const kickButton = page.getByRole('button', { name: `Kick ${rival.pseudo}` });
  // Le filtre sert aussi de collecteur : un échec doit DIRE quelle requête est partie,
  // sinon il ne reste qu'un compteur et rien pour le diagnostiquer.
  const dialogUrls = [];
  const dialogCalls = await countRequests(
    async () => {
      await kickButton.click();
      await page.locator('dialog[open]').waitFor({ timeout: 5000 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    },
    (url) => {
      if (!url.includes('/api/')) return false;
      dialogUrls.push(url.replace(ORIGIN, ''));
      return true;
    },
  );
  const dialogClosed = (await page.locator('dialog[open]').count()) === 0;
  const chipSurvived = (await rivalChip.count()) > 0;
  step(
    'B14b',
    dialogCalls === 0 && dialogClosed && chipSurvived,
    `appels /api pendant ouverture+Escape : ${dialogCalls} (0 attendu)${dialogUrls.length ? ` -> ${dialogUrls.join(', ')}` : ''}, dialogue refermé = ${dialogClosed}, joueur toujours au roster = ${chipSurvived}`,
  );

  setPhase('13. kick confirmé -> la puce disparaît');
  await kickButton.click();
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor({ timeout: 5000 });
  const kickPromise = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/teams/${teamId}/members/`) && r.request().method() === 'DELETE',
    { timeout: 20000 },
  );
  await dialog.getByRole('button', { name: 'Remove player' }).click();
  const kickRes = await kickPromise;
  const chipGone = await rivalChip
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'B15',
    kickRes.status() === 200 && chipGone,
    `DELETE /members/:userId -> HTTP ${kickRes.status()}, puce retirée = ${chipGone}`,
  );

  // ------------------------------------------------------------------ §10 vue non-capitaine
  setPhase('14. ré-ajout du joueur pour la vue non-capitaine');
  const readdRes = await addMember();
  await rivalChip.first().waitFor({ timeout: 15000 });
  step('B16', readdRes.status() === 201, `ré-ajout -> HTTP ${readdRes.status()}`);

  await page.context().clearCookies();
  await login(rival);
  // APRÈS login() : il pose sa propre phase, un setPhase avant lui serait écrasé.
  setPhase('15. même page vue par un membre non-capitaine');
  await page.goto(teamUrl, { waitUntil: 'networkidle' });
  await page.locator('h1').first().waitFor({ timeout: 15000 });
  const manageTabForMember = await page.getByRole('tab', { name: 'Manage' }).count();
  const leaveButton = page.getByRole('button', { name: 'Leave team' });
  // getByRole ignore ce que l'arbre d'accessibilité ne voit pas : le bouton du dialogue
  // fermé (<dialog> = display:none) n'est donc PAS compté ici.
  const leaveCount = await leaveButton.count();
  step(
    'B17',
    manageTabForMember === 0 && leaveCount === 1,
    `onglet Manage pour un membre : ${manageTabForMember} (0 attendu), bouton « Leave team » : ${leaveCount} (1 attendu)`,
  );

  setPhase('16. départ volontaire -> retour sur /teams');
  await leaveButton.click();
  await dialog.waitFor({ timeout: 5000 });
  const leavePromise = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/teams/${teamId}/members/`) && r.request().method() === 'DELETE',
    { timeout: 20000 },
  );
  await dialog.getByRole('button', { name: 'Leave team' }).click();
  const leaveRes = await leavePromise;
  const landedOnTeams = await page
    .waitForURL(/\/teams$/, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'B18',
    leaveRes.status() === 200 && landedOnTeams,
    `DELETE -> HTTP ${leaveRes.status()}, atterrissage sur /teams = ${landedOnTeams}`,
  );

  // ------------------------------------------------------------------ §11 dissolution
  await page.context().clearCookies();
  await login(user);
  setPhase('17. dissolution -> /teams, et surtout AUCUN 404');
  await page.goto(teamUrl, { waitUntil: 'networkidle' });
  await openManage();
  await page.getByRole('button', { name: 'Dissolve team' }).first().click();
  await dialog.waitFor({ timeout: 5000 });
  const dissolvePromise = page.waitForResponse(
    (r) => r.url().endsWith(`/api/teams/${teamId}`) && r.request().method() === 'DELETE',
    { timeout: 20000 },
  );
  await dialog.getByRole('button', { name: 'Dissolve team' }).click();
  const dissolveRes = await dissolvePromise;
  const backOnTeams = await page
    .waitForURL(/\/teams$/, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  // Laisse le temps à un refetch fautif de partir : c'est justement le 404 qu'on traque.
  await page.waitForTimeout(1200);
  const deadTeamCalls = notFound.filter((url) => url.includes(teamId));
  step(
    'B19',
    dissolveRes.status() === 200 && backOnTeams && deadTeamCalls.length === 0,
    `DELETE -> HTTP ${dissolveRes.status()}, retour sur /teams = ${backOnTeams}, requêtes 404 sur l’équipe morte : ${deadTeamCalls.length} (0 attendu)`,
  );

  // ------------------------------------------------------------------ §12 filets transverses
  step(
    'B20',
    notFound.length === 0,
    `404 sur TOUT le parcours : ${notFound.length} (0 attendu)${notFound.length ? ` -> ${notFound.slice(0, 3).join(', ')}` : ''}`,
  );
  step(
    'B21',
    nativeDialogs === 0,
    `boîtes natives (window.confirm/alert) rencontrées : ${nativeDialogs} (0 attendu)`,
  );
}
