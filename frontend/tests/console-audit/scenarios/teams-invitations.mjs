/**
 * `/teams` — FT-INV, le parcours CÔTÉ JOUEUR INVITÉ (bloc « Team invitations »).
 *
 * Le pendant de `teams-manage.mjs` : là-bas le capitaine invite et annule, ici l'invité
 * refuse puis accepte. Aucun équivalent n'existait avant ce ticket.
 *
 * Ce que le scénario vérifie :
 *   - un compte **sans invitation** ne rend **aucun** bloc, et ne coûte qu'**une seule**
 *     requête `GET /teams/invitations/me` par affichage de `/teams` (le bloc fait sa propre
 *     query : on prouve qu'elle ne part pas en boucle) ;
 *   - le joueur invité voit le bloc, avec le **nom de l'équipe** et le ladder ;
 *   - **Decline** (200) : la ligne disparaît, la grille « My teams » reste vide ; et depuis
 *     [FX-FOCUS], le focus atterrit sur le titre de la PAGE (le bloc entier ayant disparu
 *     avec son propre titre) au lieu de tomber sur `<body>` ;
 *   - **deux équipes du même ladder** peuvent inviter le même joueur ; en **acceptant**
 *     l'une, l'autre invitation **disparaît toute seule** — c'est l'annulation en cascade
 *     du serveur, jamais une simulation côté client ;
 *   - après **Accept** (200), la nouvelle équipe apparaît dans la grille **sans
 *     rechargement** (navigation cliente uniquement) et la confirmation est annoncée ;
 *   - **aucun 404 sur tout le parcours**, et aucune boîte native : accepter et refuser ne
 *     passent PAS par un `ConfirmDialog`.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - **Les erreurs de réponse** (`not_pending`, `roster_full`, `already_in_team`,
 *     `invitation_not_found`) : elles demandent une course entre deux sessions — le
 *     capitaine annulant pendant que l'invité clique. Mappées dans `team-mutations.ts`,
 *     jamais déclenchées ici.
 *   - **L'état d'erreur de la query** (`Could not load your team invitations.`) : il
 *     faudrait faire tomber la route.
 *   - **Le chargement par ligne** avec deux mutations en vol simultanément : les réponses
 *     de la base de dev arrivent trop vite pour observer la fenêtre de façon stable.
 *   - **Le rendu visuel** (contraste, alignement du logo d'équipe) : à l'œil.
 */
export const name = 'teams-invitations';
export const surface = '/teams — bloc « Team invitations » : accepter / refuser une invitation';

export async function run({ page, awaitAnnouncement, setPhase, step, countRequests, createUser, user, ORIGIN, focusLanding, awaitFocusRestored, pressEnterOn }) {
  // Filet transverse : un seul 404 sur tout le parcours suffit à faire rougir la console
  // d'un correcteur. On les collecte pour pouvoir DIRE lesquels.
  const notFound = [];
  page.on('response', (res) => {
    if (res.status() === 404) notFound.push(res.url());
  });

  let nativeDialogs = 0;
  page.on('dialog', () => {
    nativeDialogs += 1;
  });

  /**
   * Appel API direct, pour fabriquer l'état que l'UI de CE scénario ne produit pas (les
   * deux équipes émettrices, et leurs invitations). Le parcours du capitaine a son propre
   * scénario : le dérouler une seconde fois ici ne prouverait rien de neuf et doublerait
   * la durée du run.
   *
   * ⚠️ `content-type: application/json` uniquement s'il y a un corps : Fastify refuse en
   * 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`) une requête qui annonce du JSON sans en envoyer.
   */
  const api = (as, path, init = {}) => {
    const headers = { authorization: `Bearer ${as.accessToken}`, ...(init.headers ?? {}) };
    if (init.body) headers['content-type'] = 'application/json';
    return fetch(`${ORIGIN}/api${path}`, { ...init, headers });
  };

  const json = (res) => res.json();
  // Le bloc est identifié par son TITRE de section, pas par une classe : c'est ce qu'un
  // lecteur d'écran utilise, et ça ne casse pas au prochain ajustement de style.
  const invitationBlock = page.locator('section', {
    has: page.getByRole('heading', { name: 'Team invitations' }),
  });
  const invitationRows = invitationBlock.locator('ul[role="list"] > li');

  // ------------------------------------------------------------------ §1 aucun invité
  setPhase('1. /teams sans aucune invitation : rien ne doit être rendu');
  let meCalls = await countRequests(
    async () => {
      await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
    },
    (url) => url.includes('/api/teams/invitations/me'),
  );
  const blocksWhenEmpty = await invitationBlock.count();
  step(
    'I1',
    blocksWhenEmpty === 0 && meCalls === 1,
    `blocs d’invitation sans invitation : ${blocksWhenEmpty} (0 attendu), appels GET /teams/invitations/me : ${meCalls} (1 attendu)`,
  );

  // ------------------------------------------------------------------ §2 mise en place
  setPhase('2. mise en place : deux équipes du même ladder invitent le même joueur');
  // Équipe A, créée par le capitaine du run via l'UI — c'est le seul chemin qui donne
  // aussi un ladder valide sans deviner d'identifiant.
  await page.click('button:has-text("Create new team")');
  const form = page.locator('form');
  await form.waitFor();
  await form.locator('div.flex-wrap').first().locator('button').first().click();
  const teamAName = `Audit INV A ${user.stamp}`;
  await page.fill('#team-name', teamAName);
  await page.click('button:has-text("Create team")');
  await awaitAnnouncement('was created');
  await page.locator('ul li a').first().click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });
  const teamAId = new URL(page.url()).pathname.split('/').pop();
  // `ladderName` sert au check I3 : le bandeau promet « le nom de l'équipe ET le ladder »,
  // les deux doivent donc être vérifiés, sinon il ment.
  const { ladderId, ladderName } = await api(user, `/teams/${teamAId}`)
    .then(json)
    .then(({ team }) => team);

  // L'invité, et une SECONDE équipe sur le MÊME ladder : c'est elle qui rend observable
  // l'annulation en cascade à l'acceptation (règle métier « une seule équipe par ladder »).
  const invitee = await createUser();
  const inviteeId = await api(invitee, '/users/me')
    .then(json)
    .then(({ user: me }) => me.id);
  const rival = await createUser();
  const teamBName = `Audit INV B ${user.stamp}`;
  const teamBId = await api(rival, '/teams', {
    method: 'POST',
    body: JSON.stringify({ ladderId, name: teamBName }),
  })
    .then(json)
    .then(({ team }) => team.id);

  const inviteFrom = (captain, teamId) =>
    api(captain, `/teams/${teamId}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ userId: inviteeId }),
    });

  const firstInvite = await inviteFrom(user, teamAId);
  step(
    'I2',
    firstInvite.status === 201,
    `mise en place : équipe A « ${teamAName} », équipe B « ${teamBName} » sur le même ladder, invitation A -> HTTP ${firstInvite.status}`,
  );

  // ------------------------------------------------------------------ §3 vue de l'invité
  // Session ouverte par INJECTION DU COOKIE de refresh, comme le fait le runner pour le
  // compte principal : le formulaire de connexion n'est pas l'objet de ce scénario, et son
  // quota (5/min par IP) est partagé avec toute la campagne.
  await page.context().clearCookies();
  await page.context().addCookies(invitee.cookies);

  setPhase('3. l’invité ouvre /teams : le bloc d’invitations est visible');
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
  await invitationBlock.waitFor({ timeout: 15000 });
  const rowsSeen = await invitationRows.count();
  const teamNameShown = await invitationBlock.getByText(teamAName, { exact: true }).count();
  // Le ladder est sur la MÊME ligne que le nom (sous-titre « <ladder> · <format> · invited
  // by @… »), donc un `hasText` sur la ligne suffit et reste lisible si le séparateur bouge.
  const ladderShown = await invitationRows.filter({ hasText: ladderName }).count();
  const gridEmpty = await page.getByText("You're not part of any team.").count();
  step(
    'I3',
    rowsSeen === 1 && teamNameShown === 1 && ladderShown === 1 && gridEmpty === 1,
    `lignes d’invitation : ${rowsSeen} (1 attendue), nom de l’équipe affiché = ${teamNameShown === 1}, ladder « ${ladderName} » affiché = ${ladderShown === 1}, grille « My teams » encore vide = ${gridEmpty === 1}`,
  );

  // ------------------------------------------------------------------ §4 refus
  setPhase('4. Decline -> la ligne disparaît, la grille reste vide');
  const declinePromise = page.waitForResponse(
    (r) => /\/api\/teams\/invitations\/[^/]+\/decline$/.test(r.url()),
    { timeout: 20000 },
  );
  // AU CLAVIER (`pressEnterOn`) : la restauration du focus ne se juge pas à la souris.
  await pressEnterOn(page.getByRole('button', { name: `Decline the invitation from ${teamAName}` }));
  const declineRes = await declinePromise;
  const blockGone = await invitationBlock
    .waitFor({ state: 'detached', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const stillNoTeam = await page.getByText("You're not part of any team.").count();
  step(
    'I4',
    declineRes.status() === 200 && blockGone && stillNoTeam === 1,
    `POST .../decline -> HTTP ${declineRes.status()}, bloc retiré = ${blockGone}, grille toujours vide = ${stillNoTeam === 1}`,
  );

  // FX-FOCUS — c'était la DERNIÈRE invitation : le bloc entier s'en va, titre compris.
  // Le repli est donc le titre de la page, pas celui de la section (qui n'existe plus).
  const afterDecline = await focusLanding();
  const declineAnnounced = afterDecline.live.some((line) => line.includes('was declined'));
  step(
    'I4-bis',
    afterDecline.tag === 'H1' && afterDecline.label === 'My teams' && declineAnnounced,
    `focus après refus de la DERNIÈRE invitation : <${afterDecline.tag}> « ${afterDecline.label} » (H1 « My teams » attendu, JAMAIS BODY) — annonce trouvée = ${declineAnnounced}`,
  );

  // ------------------------------------------------------------------ §5 deux invitations
  setPhase('5. deux équipes du même ladder invitent : deux lignes');
  const reinviteA = await inviteFrom(user, teamAId);
  const inviteB = await inviteFrom(rival, teamBId);
  // Rechargement ASSUMÉ : ces deux invitations sont nées hors du navigateur, aucune
  // invalidation de cache ne peut les faire apparaître. Le « sans rechargement » qui compte
  // est celui de l'acceptation, mesuré en §6.
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
  await invitationBlock.waitFor({ timeout: 15000 });
  const twoRows = await invitationRows.count();
  step(
    'I5',
    reinviteA.status === 201 && inviteB.status === 201 && twoRows === 2,
    `ré-invitation A -> HTTP ${reinviteA.status}, invitation B -> HTTP ${inviteB.status}, lignes affichées : ${twoRows} (2 attendues — plusieurs équipes peuvent solliciter le même joueur)`,
  );

  setPhase('5b. deux lignes d’invitation à 375 px');
  // Logo + nom d'équipe + ladder + deux boutons sur une même ligne : c'est la ligne la plus
  // chargée du bloc, et 375 px est la largeur où elle casse si elle doit casser.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(400);
  const narrowBlock = await invitationBlock.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  const narrowDocOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'I5b',
    narrowBlock.scroll <= narrowBlock.client && narrowDocOverflow <= 0,
    `bloc d’invitations à 375 px : scrollWidth=${narrowBlock.scroll} vs clientWidth=${narrowBlock.client}, débordement du document ${narrowDocOverflow}px`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);

  // ------------------------------------------------------------------ §6 acceptation
  setPhase('6. Accept -> la grille se met à jour SANS rechargement, l’autre ligne tombe');
  const acceptPromise = page.waitForResponse(
    (r) => /\/api\/teams\/invitations\/[^/]+\/accept$/.test(r.url()),
    { timeout: 20000 },
  );
  await pressEnterOn(page.getByRole('button', { name: `Accept the invitation from ${teamAName}` }));
  const acceptRes = await acceptPromise;
  // Aucune navigation entre le clic et cette assertion : c'est là toute la preuve.
  const cardAppeared = await page
    .locator('ul[role="list"] a', { hasText: teamAName })
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const confirmed = await page
    .locator('[role="status"]', { hasText: teamAName })
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step(
    'I6',
    acceptRes.status() === 200 && cardAppeared && confirmed,
    `POST .../accept -> HTTP ${acceptRes.status()}, carte d’équipe apparue dans la grille sans rechargement = ${cardAppeared}, confirmation annoncée (role="status") = ${confirmed}`,
  );

  // FX-FOCUS — ici le bloc SURVIT (il affiche « You joined … »), donc l'atterrissage est le
  // titre de section, exactement comme pour le roster.
  await awaitFocusRestored();
  const afterAccept = await focusLanding();
  step(
    'I6-bis',
    afterAccept.tag === 'H2' && afterAccept.label === 'Team invitations',
    `focus après acceptation : <${afterAccept.tag}> « ${afterAccept.label} » (H2 « Team invitations » attendu, JAMAIS BODY)`,
  );

  // L'invitation de l'équipe B n'a pas été refusée : le serveur l'a passée à `cancelled`
  // dans la MÊME transaction que l'acceptation, parce qu'un joueur n'a qu'une équipe par
  // ladder. Elle doit donc s'évaporer sans que l'invité y touche.
  const rowsLeft = await invitationRows.count();
  const blockLeft = await invitationBlock.count();
  step(
    'I7',
    rowsLeft === 0 && blockLeft === 1,
    `lignes restantes après acceptation : ${rowsLeft} (0 attendue — l’invitation de l’équipe B est annulée EN CASCADE par le serveur), bloc encore rendu pour porter la confirmation : ${blockLeft}`,
  );

  // ------------------------------------------------------------------ §7 filets transverses
  setPhase('7. filets transverses');
  // Une visite neuve, sans invitation en attente : plus rien ne doit être rendu.
  meCalls = await countRequests(
    async () => {
      await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
    },
    (url) => url.includes('/api/teams/invitations/me'),
  );
  const blockAfterReload = await invitationBlock.count();
  step(
    'I8',
    blockAfterReload === 0 && meCalls === 1,
    `bloc rendu après acceptation et rechargement : ${blockAfterReload} (0 attendu), appels GET /teams/invitations/me : ${meCalls} (1 attendu)`,
  );

  step(
    'I9',
    notFound.length === 0,
    `404 sur TOUT le parcours : ${notFound.length} (0 attendu)${notFound.length ? ` -> ${notFound.slice(0, 3).join(', ')}` : ''}`,
  );
  step(
    'I10',
    nativeDialogs === 0,
    `boîtes natives (window.confirm/alert) rencontrées : ${nativeDialogs} (0 attendu — répondre à une invitation ne demande PAS de confirmation)`,
  );
}
