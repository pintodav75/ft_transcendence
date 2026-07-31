/**
 * `/teams/$teamId` — onglet Manage (gestion capitaine). FT-2B, mis à jour par FT-INV :
 * l'ajout direct d'un membre n'existe plus, le capitaine INVITE.
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
 *   - **invitation refusée** (409 `already_in_team_on_ladder`, déclaré) : le message affiché
 *     est celui dérivé du **`code`**, comparé en `exact` pour le distinguer de la prose
 *     serveur — c'est le check qui garde la migration verbatim → `code` ;
 *   - **invitation envoyée** (201) : la puce « Pending » apparaît au pseudo du joueur, le
 *     compteur de plafond passe de `Roster slots 1/10` à `Roster slots 2/10 · 1 pending`, et
 *     la statistique « Roster » de l'en-tête (les MEMBRES) **ne bouge pas** ;
 *   - **annulation** (200) : la puce disparaît — puis **ré-invitation du même joueur en
 *     201**, ce qui prouve que l'index d'unicité est PARTIEL (une invitation annulée ne
 *     bloque pas la suivante) ;
 *   - un **non-membre** (en l'occurrence le joueur invité lui-même) ne voit **aucune** puce
 *     « Pending » — la divulgation progressive vient du contrat, pas d'une garde client — et
 *     un **membre non-capitaine** les voit, mais **sans** bouton d'annulation ;
 *   - les deux compteurs de l'écran sont mesurés **séparément** : « Roster slots » (onglet
 *     Manage, membres + invitations) monte, « Roster » (en-tête, public, MEMBRES) ne bouge
 *     pas — deux libellés distincts pour deux chiffres légitimement différents ;
 *   - l'onglet Manage **au repos** ne parle pas (mesure de référence : sans elle, une requête
 *     tardive d'une autre origine serait imputée au dialogue) ;
 *   - `ConfirmDialog` : ouvrir/fermer ne coûte aucune requête, Escape ferme sans muter, et
 *     **aucune boîte native** (`window.confirm`) n'est apparue de tout le run ;
 *   - kick, départ volontaire d'un membre, atterrissage sur `/teams` ;
 *   - la dissolution atterrit sur `/teams` **sans un seul 404** — c'est ce check qui valide
 *     l'ordre `navigate` → `removeQueries` de `useDissolveTeam`.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - **Le parcours du joueur invité** (Accept / Decline sur `/teams`) : il a son propre
 *     scénario, `teams-invitations.mjs`. Ici les deux acceptations passent par un **appel
 *     API direct**, uniquement pour fabriquer l'état « le joueur est membre » dont les
 *     phases kick / départ / dissolution ont besoin.
 *   - **Le roster plein.** L'état « This roster is full » et le 409 `roster_full`
 *     demanderaient 10 comptes : le bloc désactivé n'est jamais rendu ici.
 *   - **`already_invited` et `already_member`.** Tous deux INATTEIGNABLES par l'UI :
 *     `excludeIds` retire des résultats de recherche les membres ET les joueurs déjà
 *     invités, il n'y a plus rien à cliquer. Seul `already_in_team_on_ladder` est
 *     déclenchable, et il emprunte le même chemin de code (mapping par `code`).
 *   - **Le rendu visuel** (contraste, alignements, distinction Kick / Cancel à l'œil).
 *     ⚠️ La **restauration du focus** après un kick ou une annulation d'invitation N'EST
 *     PLUS un angle mort : [FX-FOCUS] l'a corrigée et les checks B13c-bis / B15-bis la
 *     mesurent (le focus doit atterrir sur le titre « Roster », jamais sur `<body>`).
 *   - **403 (capitaine destitué) et 429** : mappés dans `team-mutations.ts`, jamais
 *     déclenchés ici.
 *   - L'équipe créée à la volée **n'a aucun match** : rien ne dit ce que devient un
 *     historique quand un joueur aligné est exclu.
 */
export const name = 'teams-manage';
export const surface =
  '/teams/$teamId — onglet Manage : renommage, logo, invitations, roster, dissolution';

export async function run({
  page,
  setPhase,
  step,
  focusLanding,
  awaitFocusRestored,
  awaitAnnouncement,
  pressEnterOn,
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
  const main = page.getByRole('main');

  const openManage = async () => {
    await main.getByRole('tab', { name: 'Manage' }).click();
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
  await awaitAnnouncement('was created');
  await page.locator('ul li a').first().click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });

  const teamUrl = page.url();
  const teamId = new URL(teamUrl).pathname.split('/').pop();

  const tabStrip = main.locator('[role="tablist"]');
  await tabStrip.waitFor({ timeout: 15000 });
  // ⚠️ `innerText` rend le texte TEL QU'AFFICHÉ : `label-caps` applique `text-transform:
  // uppercase`, donc « Manage » revient en « MANAGE ». On compare en minuscules.
  const tabLabels = (await main.locator('[role="tab"]').allInnerTexts()).map((t) =>
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
  const panelBox = await main
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
  // ⚠️ Porté sur `main` : depuis F-Nav le rail de gauche porte un item « my teams » vers la
  // même route, et à 1280 px les deux sont montés — un `getByRole` global part en violation
  // du mode strict. C'est le fil d'Ariane de la page qu'on veut cliquer, pas le rail.
  await page.locator('main').getByRole('link', { name: 'My teams' }).click();
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

  // ------------------------------------------------------------------ §7 invitation refusée
  setPhase('10. invitation d’un joueur déjà engagé sur ce ladder -> 409');
  expectHttp(
    new RegExp(`/teams/${teamId}/invitations`),
    'joueur déjà dans une équipe de ce ladder -> 409 already_in_team_on_ladder attendu',
  );
  await searchForRival();
  const inviteConflictPromise = page.waitForResponse(
    (r) => r.url().endsWith(`/api/teams/${teamId}/invitations`) && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await rivalRow.click();
  const inviteConflictRes = await inviteConflictPromise;
  // ⚠️ `exact: true` n'est pas cosmétique : c'est LUI qui prouve qu'on affiche le message
  // dérivé du `code` stable et non la prose du serveur. Le back dit « this player already
  // has a team on this ladder » (minuscule, sans point final), le front dit « This player
  // already has a team on this ladder. ». Un match par sous-chaîne confondrait les deux —
  // et c'est précisément la régression que B-INV rend possible.
  const conflictByCode = await page
    .getByText('This player already has a team on this ladder.', { exact: true })
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step(
    'B12',
    inviteConflictRes.status() === 409 && conflictByCode,
    `POST /invitations -> HTTP ${inviteConflictRes.status()}, message dérivé du code (et non la prose serveur) affiché = ${conflictByCode}`,
  );

  // ------------------------------------------------------------------ §8 invitation nominale
  // Libère le joueur : tant que son équipe existe, l'invitation ne peut QUE répondre 409.
  const rivalTeamGone = await api(rival, `/teams/${rivalTeamId}`, { method: 'DELETE' });

  const invitePlayer = async () => {
    await searchForRival();
    const promise = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/teams/${teamId}/invitations`) && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await rivalRow.click();
    return promise;
  };

  // ⚠️ Scopé au panneau VISIBLE : le roster est rendu deux fois (Overview et Manage), et
  // la copie de l'onglet inactif est `hidden` — un `.first()` nu viserait la mauvaise.
  const visiblePanel = main.locator('[role="tabpanel"]:not([hidden])');
  const rivalChip = visiblePanel.locator(`li:has(a[href$="/players/${rival.pseudo}"])`);
  const rivalPendingChip = rivalChip.filter({ hasText: 'Pending' });
  // Compteur de PLAFOND de l'onglet Manage (« Roster slots » = membres + invitations en
  // attente) — à ne pas confondre avec la statistique « Roster » de l'en-tête, qui compte
  // les MEMBRES. Les deux libellés diffèrent exprès : ils ne doivent PAS bouger ensemble,
  // et c'est mesuré ci-dessous.
  const capCounter = visiblePanel
    .locator('p')
    .filter({ hasText: /^Roster slots \d+\/10/ })
    .first();
  // 4e statistique de l'en-tête, dans l'ordre fixe Elo / Record / Rank / Roster.
  const memberStat = page.locator('dl > div').nth(3).locator('dd');
  const flat = (value) => value.replace(/\s+/g, ' ').trim();

  setPhase('11. invitation nominale -> 201 et puce « Pending »');
  const capBefore = flat(await capCounter.innerText());
  const membersBefore = flat(await memberStat.innerText());
  const inviteRes = await invitePlayer();
  const pendingAppeared = await rivalPendingChip
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const capAfter = flat(await capCounter.innerText());
  const membersAfter = flat(await memberStat.innerText());
  step(
    'B13',
    inviteRes.status() === 201 && pendingAppeared,
    `dissolution de l’équipe rivale -> HTTP ${rivalTeamGone.status}, POST /invitations -> HTTP ${inviteRes.status()}, puce « Pending » au pseudo du joueur apparue = ${pendingAppeared}`,
  );
  step(
    'B13a',
    capBefore.startsWith('Roster slots 1/10') &&
      capAfter.startsWith('Roster slots 2/10') &&
      capAfter.includes('1 pending'),
    `compteur de plafond : « ${capBefore.slice(0, 46)} » -> « ${capAfter.slice(0, 46)} » (2/10 · 1 pending attendu)`,
  );
  step(
    'B13b',
    membersBefore === membersAfter,
    `statistique « Roster » de l’en-tête (MEMBRES) : « ${membersBefore} » -> « ${membersAfter} » — un invité ne doit pas être compté comme membre`,
  );

  setPhase('11b. la puce « Pending » + son bouton Cancel à 375 px');
  // La puce en attente est la plus large du roster (avatar + pseudo + pastille « Pending » +
  // bouton « Cancel »). FT-2B avait laissé ce trou : la puce AVEC son bouton n'avait jamais
  // été mesurée à 375 px. On mesure, on ne regarde pas.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(400);
  const narrowPanel = await visiblePanel.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  const narrowDocOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'B13b2',
    narrowPanel.scroll <= narrowPanel.client && narrowDocOverflow <= 0,
    `panneau Manage avec une puce « Pending » à 375 px : scrollWidth=${narrowPanel.scroll} vs clientWidth=${narrowPanel.client}, débordement du document ${narrowDocOverflow}px`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);

  // ------------------------------------------------------------------ §8b annulation
  const dialog = page.locator('dialog[open]');

  setPhase('12. annulation de l’invitation -> la puce disparaît');
  // AU CLAVIER, pas au clic : c'est le seul parcours où « où atterrit le focus » a un sens.
  await pressEnterOn(page.getByRole('button', { name: `Cancel invitation to ${rival.pseudo}` }));
  await dialog.waitFor({ timeout: 5000 });
  const cancelPromise = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/teams/${teamId}/invitations/`) && r.request().method() === 'DELETE',
    { timeout: 20000 },
  );
  // Le libellé de confirmation (« Cancel invitation ») est distinct de celui du bouton de
  // la puce (« Cancel invitation to <pseudo> ») ET du bouton d'abandon (« Keep it »).
  await pressEnterOn(dialog.getByRole('button', { name: 'Cancel invitation', exact: true }));
  const cancelRes = await cancelPromise;
  const pendingGone = await rivalPendingChip
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'B13c',
    cancelRes.status() === 200 && pendingGone,
    `DELETE /invitations/:id -> HTTP ${cancelRes.status()}, puce « Pending » retirée = ${pendingGone}`,
  );

  // FX-FOCUS — la puce annulée portait le bouton qui a ouvert la boîte ; sans point de
  // repli, le <dialog> natif rendrait le focus à <body>.
  // ⚠️ AVANT `focusLanding()`, qui est un instantané sans attente : sans ça on lit l'annonce
  // PRÉCÉDENTE (« … has been invited. ») et le check rougit alors que l'app est correcte.
  await awaitAnnouncement(`The invitation to @${rival.pseudo} was cancelled.`);
  await awaitFocusRestored();
  const afterCancel = await focusLanding();
  const cancelAnnounced = afterCancel.live.some((line) =>
    line === `The invitation to @${rival.pseudo} was cancelled.`,
  );
  step(
    'B13c-bis',
    afterCancel.tag === 'H2' && afterCancel.label === 'Roster' && cancelAnnounced,
    `focus après annulation : <${afterCancel.tag}> « ${afterCancel.label} » (H2 « Roster » attendu, JAMAIS BODY) — annonce exacte trouvée = ${cancelAnnounced} parmi [${afterCancel.live.join(' | ')}]`,
  );

  setPhase('13. ré-invitation du même joueur -> 201');
  const reinviteRes = await invitePlayer();
  await rivalPendingChip.first().waitFor({ timeout: 15000 });
  step(
    'B13d',
    reinviteRes.status() === 201,
    `ré-invitation après annulation -> HTTP ${reinviteRes.status()} (201 attendu : l’index d’unicité est PARTIEL, il ne porte que sur les invitations « pending »)`,
  );

  // ------------------------------------------------------------------ §8c acceptation
  // Le joueur accepte par APPEL DIRECT : ce parcours-ci appartient au scénario
  // `teams-invitations`, on ne fabrique ici que l'état « rival = membre » dont les phases
  // kick / départ / dissolution ci-dessous ont besoin.
  setPhase('14. le joueur accepte (appel direct) -> il devient membre');
  const pendingForRival = await api(rival, '/teams/invitations/me').then((r) => r.json());
  // ⚠️ Garde AVANT de construire l'URL : une liste vide interpolerait `undefined` et
  // produirait un 404 qui ferait rougir le filet transverse B20 avec un diagnostic
  // trompeur (« un 404 sur le parcours ») au lieu de la vraie cause.
  const rivalInviteId = pendingForRival.invitations[0]?.id;
  step(
    'B13e0',
    pendingForRival.invitations.length === 1 && Boolean(rivalInviteId),
    `invitations en attente du joueur avant acceptation : ${pendingForRival.invitations.length} (1 attendue)`,
  );
  const acceptRes = await api(rival, `/teams/invitations/${rivalInviteId}/accept`, {
    method: 'POST',
  });
  await page.goto(teamUrl, { waitUntil: 'networkidle' });
  await openManage();
  await rivalChip.first().waitFor({ timeout: 15000 });
  const chipsForRival = await rivalChip.count();
  const stillPending = await rivalPendingChip.count();
  const membersJoined = flat(await memberStat.innerText());
  step(
    'B13e',
    acceptRes.status === 200 && chipsForRival === 1 && stillPending === 0,
    `POST .../accept -> HTTP ${acceptRes.status}, puces au nom du joueur : ${chipsForRival} (1 attendue), dont « Pending » : ${stillPending} (0 attendu), en-tête « Roster » = « ${membersJoined} »`,
  );

  // ------------------------------------------------------------------ §9 ConfirmDialog
  setPhase('15a. onglet Manage au repos : aucune requête');
  // Le rechargement qui précède invalide plusieurs clés de cache ; leurs refetch partent
  // APRÈS que la puce soit apparue. Sans cette attente ils tomberaient dans la fenêtre de
  // mesure et on imputerait au dialogue une requête qui ne lui appartient pas.
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

  setPhase('15b. ConfirmDialog : ouverture/Escape sans aucune mutation');
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

  setPhase('16. kick confirmé -> la puce disparaît');
  await pressEnterOn(kickButton);
  await dialog.waitFor({ timeout: 5000 });
  const kickPromise = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/teams/${teamId}/members/`) && r.request().method() === 'DELETE',
    { timeout: 20000 },
  );
  await pressEnterOn(dialog.getByRole('button', { name: 'Remove player' }));
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

  // Même piège que B13c-bis : instantané sans attente -> on lirait l'annonce précédente.
  await awaitAnnouncement(`@${rival.pseudo} was removed from the roster.`);
  await awaitFocusRestored();
  const afterKick = await focusLanding();
  const kickAnnounced = afterKick.live.some(
    (line) => line === `@${rival.pseudo} was removed from the roster.`,
  );
  step(
    'B15-bis',
    afterKick.tag === 'H2' && afterKick.label === 'Roster' && kickAnnounced,
    `focus après kick : <${afterKick.tag}> « ${afterKick.label} » (H2 « Roster » attendu, JAMAIS BODY) — annonce exacte trouvée = ${kickAnnounced} parmi [${afterKick.live.join(' | ')}]`,
  );

  // ------------------------------------------------------------------ §10 vue non-membre
  setPhase('17. ré-invitation du joueur pour la vue non-membre');
  const readdRes = await invitePlayer();
  await rivalPendingChip.first().waitFor({ timeout: 15000 });
  step('B16', readdRes.status() === 201, `ré-invitation -> HTTP ${readdRes.status()}`);

  await page.context().clearCookies();
  await login(rival);
  // APRÈS login() : il pose sa propre phase, un setPhase avant lui serait écrasé.
  setPhase('18. la même page vue par un NON-MEMBRE (invité, pas encore membre)');
  await page.goto(teamUrl, { waitUntil: 'networkidle' });
  await page.locator('h1').first().waitFor({ timeout: 15000 });
  const manageTabForGuest = await main.getByRole('tab', { name: 'Manage' }).count();
  // ⚠️ LE check de divulgation progressive : `invitations` est ABSENT de GET /teams/{id}
  // pour un non-membre. Le compte utilisé ici est justement CELUI QUI EST INVITÉ — s'il ne
  // voit aucune puce « Pending », personne hors de l'équipe n'en voit.
  const pendingForGuest = await visiblePanel.locator('li:has-text("Pending")').count();
  step(
    'B17',
    manageTabForGuest === 0 && pendingForGuest === 0,
    `onglet Manage pour un non-membre : ${manageTabForGuest} (0 attendu), puces « Pending » visibles par un non-membre : ${pendingForGuest} (0 attendu)`,
  );

  setPhase('19. le joueur accepte -> il devient membre et peut quitter');
  const pendingAgain = await api(rival, '/teams/invitations/me').then((r) => r.json());
  // Même garde qu'en phase 14, même raison.
  const rivalInviteId2 = pendingAgain.invitations[0]?.id;
  step(
    'B17b0',
    pendingAgain.invitations.length === 1 && Boolean(rivalInviteId2),
    `invitations en attente du joueur avant la 2e acceptation : ${pendingAgain.invitations.length} (1 attendue)`,
  );
  const acceptAgainRes = await api(rival, `/teams/invitations/${rivalInviteId2}/accept`, {
    method: 'POST',
  });
  await page.goto(teamUrl, { waitUntil: 'networkidle' });
  const leaveButton = page.getByRole('button', { name: 'Leave team' });
  await leaveButton.waitFor({ timeout: 15000 });
  // getByRole ignore ce que l'arbre d'accessibilité ne voit pas : le bouton du dialogue
  // fermé (<dialog> = display:none) n'est donc PAS compté ici.
  const leaveCount = await leaveButton.count();
  step(
    'B17b',
    acceptAgainRes.status === 200 && leaveCount === 1,
    `POST .../accept -> HTTP ${acceptAgainRes.status}, bouton « Leave team » du nouveau membre : ${leaveCount} (1 attendu)`,
  );

  // ----------------------------------------------------- §10b vue d'un MEMBRE non-capitaine
  // Critère §4.2 : un membre voit les puces en attente (« le capitaine a sollicité untel »)
  // mais n'a AUCUN bouton d'annulation — retirer une invitation reste la décision du
  // capitaine. Un 3e compte est nécessaire : le capitaine ne peut pas s'auto-inviter, et le
  // seul autre compte du run est justement celui qui regarde.
  setPhase('19b. un membre non-capitaine voit les puces « Pending », sans bouton Cancel');
  const outsider = await createUser();
  const outsiderId = await api(outsider, '/users/me')
    .then((r) => r.json())
    .then(({ user: me }) => me.id);
  const inviteOutsider = await api(user, `/teams/${teamId}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ userId: outsiderId }),
  });
  await page.goto(teamUrl, { waitUntil: 'networkidle' });
  await visiblePanel.locator('li:has-text("Pending")').first().waitFor({ timeout: 15000 });
  const pendingForMember = await visiblePanel.locator('li:has-text("Pending")').count();
  // Motif ancré : n'importe quel bouton « Cancel invitation to <pseudo> », quel que soit le
  // joueur visé. Le dialogue de confirmation, lui, s'appelle « Cancel invitation » tout
  // court et est de toute façon fermé (donc hors arbre d'accessibilité).
  const cancelButtonsForMember = await page
    .getByRole('button', { name: /^Cancel invitation to / })
    .count();
  step(
    'B17c',
    inviteOutsider.status === 201 && pendingForMember === 1 && cancelButtonsForMember === 0,
    `invitation d’un 3e joueur -> HTTP ${inviteOutsider.status}, puces « Pending » vues par un MEMBRE : ${pendingForMember} (1 attendue), boutons d’annulation : ${cancelButtonsForMember} (0 attendu — réservés au capitaine)`,
  );

  setPhase('20. départ volontaire -> retour sur /teams');
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
  setPhase('21. dissolution -> /teams, et surtout AUCUN 404');
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
