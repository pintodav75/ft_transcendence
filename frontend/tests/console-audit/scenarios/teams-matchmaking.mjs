/**
 * `/teams/$teamId` — FT-2C : ouvrir et annuler un créneau de match.
 *
 * Ce que le scénario vérifie :
 *   - **capitaine seul** : « Create match » n'existe que pour lui, et aucune ligne ne porte
 *     de bouton d'annulation pour un membre ordinaire ;
 *   - le panneau est un **disclosure** (`aria-expanded` sur le bouton), pas une modale, et
 *     l'ouvrir coûte **exactement une** requête — `GET /api/ladders`, la donnée de référence
 *     qui porte `lockoutMinutes` (mise en cache 1 h). Ce n'est pas « zéro », c'est « une, et
 *     la voici » ;
 *   - la liste d'heures **ne contient que des quarts** (`:00 :15 :30 :45`, secondes et ms à
 *     0) et **rien à moins de 15 min** — la borne que le serveur évalue à la réception ;
 *   - le membre **sans compte lié** est `disabled`, et la soumission reste bloquée tant que
 *     la lineup n'a pas la **taille exacte** du format : validation **client**, **0 requête** ;
 *   - **création (201)** : le bloc « Next match » et la ligne « Open slot » apparaissent
 *     **sans rechargement** ;
 *   - **PRÉ-EMPTION DU LOCKOUT** (le cœur du ticket) : après la création à `T`, les quarts à
 *     **moins de** `lockoutMinutes` de `T` sont **désactivés** dans le sélecteur, tandis que
 *     `T − lockout` et `T + lockout` **exactement** restent **sélectionnables**. C'est
 *     l'inégalité STRICTE du back (`gt`/`lt`) : deux matchs qui se touchent ne se chevauchent
 *     pas, et enchaîner sa soirée dos à dos doit rester possible. Inspecter et rouvrir le
 *     panneau n'émet **aucune** requête ;
 *   - **annulation** via `ConfirmDialog` : le pill passe `Cancelled`, le bouton disparaît, le
 *     bloc « Next match » disparaît, la ligne **reste** dans l'historique ;
 *   - **409 chevauchement** sur page périmée : le créneau en conflit est créé par **appel API
 *     direct** pendant que le panneau est ouvert (ses options ont été calculées avant), puis
 *     soumis. Le message affiché est comparé en **exact** — c'est ce check qui garde la
 *     désambiguïsation LOCALE des deux 409 (chevauchement vs plafond), le seul moyen de les
 *     distinguer sans parser la prose serveur, qui ne porte aucun `code` stable ;
 *   - **plafond de 5 slots** pré-empté : à 5 slots ouverts le formulaire n'est plus rendu,
 *     un `Callout` explique, et **aucune** requête ne part ;
 *   - **375 px**, deux fois : le panneau ouvert ne déborde pas (le `<select>` se dimensionne
 *     sur sa plus large option, c'est le vrai piège de la colonne étroite), et sur l'onglet
 *     Matches la table est REMPLACÉE par des cartes ([FX-TABLE]) — un seul arbre monté, jamais
 *     deux, le bouton « Cancel the slot » reste joignable au doigt, et le focus atterrit sur la
 *     LISTE après une annulation ;
 *   - le `position` non-`static` de la boîte de scroll du tableau (M11), qui est ce qui clippe
 *     le `sr-only` de l'en-tête Actions — asserté sur la propriété, plus sur son symptôme ;
 *   - **dissolution REFUSÉE** (409 `team_engaged_in_match`, déclaré) : les créneaux ouverts du
 *     §10 rendent l'état gratuit, et le message est comparé en **exact** — c'est ce check qui
 *     garde la traduction par `code` et la présence du REMÈDE dans la phrase ;
 *   - **aucun 404** et **aucune boîte native** sur tout le parcours.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - **Le 409 « plafond »**. Il est INATTEIGNABLE à la souris : à 5 slots le formulaire
 *     disparaît. Seul l'état PRÉ-EMPTÉ est testé (§10) ; la branche de message qui lui
 *     correspond dans `createMatchErrorMessage` n'est jamais exécutée. Même situation
 *     qu'`already_invited` dans `teams-manage.mjs`.
 *   - **403 (capitaine destitué), 429, et le 400 `unlinkedPlayers`** : mappés dans
 *     `team-mutations.ts`, jamais déclenchés — le joueur non lié est `disabled`, il faudrait
 *     qu'il délie son compte pendant que le panneau est ouvert.
 *   - **Le 409 `engaged_in_match` de l'EXCLUSION / du DÉPART** (`DELETE .../members/{userId}`).
 *     Il ne se déclenche que sur un match ACTIF (`in_progress` et au-delà) : un créneau
 *     `pending` laisse partir le joueur et s'annule tout seul. L'atteindre demanderait une
 *     ÉQUIPE ADVERSE complète (roster + comptes liés) qui accepte le créneau — un montage
 *     bien plus lourd que le refus qu'il garderait. Le mapping est donc couvert par la
 *     lecture du code, pas par ce scénario.
 *   - **Le 400 « ce créneau vient de passer »** : il demanderait de tenir le panneau ouvert
 *     ~5 minutes (la marge de sécurité du sélecteur), ce qui ferait exploser la durée du run.
 *   - **Un ladder 5v5** (lockout 60) : la règle stricte est vérifiée sur un 2v2 (lockout 30).
 *     C'est la même fonction, paramétrée par le ladder.
 *   - **Le rendu visuel** (contraste, liste déroulante native du `<select>` sur fond sombre,
 *     alignement de la colonne d'actions). ⚠️ La **restauration du focus** après annulation
 *     est désormais MESURÉE (check M8-bis, [FX-FOCUS]) — l'ancien angle mort était :
 *     la ligne qui portait le bouton perd son bouton, le focus retombe sur `<body>`.
 *
 * ⚠️ CE SCÉNARIO LAISSAIT DEUX COMPTES DERRIÈRE LUI — la TROUVAILLE qui a donné [BX-DEL].
 * `match_participants.user_id` était en `onDelete: 'restrict'` sans condition de statut, donc
 * `DELETE /users/me` rendait un 500 pour tout compte ayant été aligné une fois. Réglé le
 * 28/07 (FK en `cascade`). Le scénario ouvre 5 slots et crée une équipe, et la nouvelle garde
 * impose un ORDRE de sortie : annuler les matchs, dissoudre l'équipe, puis supprimer le
 * compte — sinon 409 `engaged_in_match` / `team_engaged_in_match`. `deleteAuditUser()` du
 * runner le fait maintenant, et ce scénario ne laisse plus rien en base.
 */
export const name = 'teams-matchmaking';
export const surface = '/teams/$teamId — ouvrir un créneau (POST /matches) et l’annuler (DELETE)';

// Le back tire ses quarts sur une grille de 15 min et exige 15 min d'avance.
const QUARTER_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export async function run({ page, setPhase, step, countRequests, expectHttp, createUser, user, ORIGIN, focusLanding, pressEnterOn }) {
  // Filet transverse : un seul 404 suffit à faire rougir la console d'un correcteur.
  const notFound = [];
  page.on('response', (res) => {
    if (res.status() === 404) notFound.push(res.url());
  });

  // Le runner a déjà un handler `dialog` (il rejette la boîte pour ne pas figer le
  // navigateur piloté) ; celui-ci ne fait que COMPTER. Zéro = aucun window.confirm.
  let nativeDialogs = 0;
  page.on('dialog', () => {
    nativeDialogs += 1;
  });

  /**
   * Appel API direct, pour fabriquer l'état que l'UI de ce scénario ne produit pas (les
   * coéquipiers, leurs comptes externes, et les créneaux concurrents du §9/§10).
   *
   * ⚠️ `content-type: application/json` UNIQUEMENT s'il y a un corps : Fastify refuse en 400
   * (`FST_ERR_CTP_EMPTY_JSON_BODY`) une requête qui annonce du JSON sans en envoyer.
   */
  const api = (as, path, init = {}) => {
    const headers = { authorization: `Bearer ${as.accessToken}`, ...(init.headers ?? {}) };
    if (init.body) headers['content-type'] = 'application/json';
    return fetch(`${ORIGIN}/api${path}`, { ...init, headers });
  };
  const json = (res) => res.json();

  /** Compte les requêtes `/api/` émises pendant `fn` et RETIENT lesquelles. */
  const apiCallsDuring = async (fn) => {
    const seen = [];
    const spy = (req) => {
      if (req.url().includes('/api/')) seen.push(req.url());
    };
    page.on('request', spy);
    try {
      await fn();
      // Laisse partir une requête déclenchée par le rendu qui suit l'interaction.
      await page.waitForTimeout(600);
    } finally {
      page.off('request', spy);
    }
    return seen;
  };

  // ------------------------------------------------------------- §0 mise en place
  setPhase('0. mise en place (API directe) : ladder 2v2, équipe, roster, comptes liés');

  // ⚠️ On choisit le ladder par son FORMAT, jamais par les boutons de jeu de l'UI de
  // création : le premier ladder d'un jeu peut être 1v1 (et un ladder 1v1 REFUSE la
  // création d'équipe) ou 5v5 (lockout 60, lineup de 5 joueurs à fabriquer).
  const { ladders } = await api(user, '/ladders').then(json);
  const ladder = ladders.find((entry) => entry.format === '2v2');
  if (!ladder) throw new Error('aucun ladder 2v2 dans la base de dev');
  const lockoutMs = ladder.lockoutMinutes * 60 * 1000;

  const teamName = `Audit FT2C ${user.stamp}`;
  const teamId = await api(user, '/teams', {
    method: 'POST',
    body: JSON.stringify({ ladderId: ladder.id, name: teamName }),
  })
    .then(json)
    .then(({ team }) => team.id);
  const { team: teamDetail } = await api(user, `/teams/${teamId}`).then(json);
  const provider = teamDetail.requiredProvider;

  const idOf = (as) =>
    api(as, '/users/me')
      .then(json)
      .then(({ user: me }) => me.id);
  const join = async (as) => {
    const id = await idOf(as);
    const { invitation } = await api(user, `/teams/${teamId}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ userId: id }),
    }).then(json);
    await api(as, `/teams/invitations/${invitation.id}/accept`, { method: 'POST' });
    return id;
  };
  // Un coéquipier LIÉ (alignable) et un NON LIÉ : le second est toute la démonstration du
  // §5.1 côté écran — il doit être grisé, pas absent.
  const teammate = await createUser();
  const benched = await createUser();
  const captainId = await idOf(user);
  const teammateId = await join(teammate);
  await join(benched);

  const link = (as) =>
    api(as, '/users/me/external-accounts', {
      method: 'POST',
      body: JSON.stringify({ provider, externalId: `AUDIT-${as.stamp}` }),
    });
  const linkedCaptain = await link(user);
  const linkedTeammate = await link(teammate);

  step(
    'M0',
    linkedCaptain.status === 201 && linkedTeammate.status === 201,
    `équipe « ${teamName} » sur ${ladder.name} (lockout ${ladder.lockoutMinutes} min), 3 membres, comptes ${provider} liés -> HTTP ${linkedCaptain.status}/${linkedTeammate.status} (le 3e joueur reste NON lié à dessein)`,
  );

  // ------------------------------------------------------- §1 le bouton du capitaine
  setPhase('1. le capitaine ouvre la page équipe');
  await page.goto(`${ORIGIN}/teams/${teamId}`, { waitUntil: 'networkidle' });
  const createButton = page.getByRole('button', { name: 'Create match' });
  await createButton.waitFor({ timeout: 15000 });
  const collapsed = await createButton.getAttribute('aria-expanded');
  step(
    'M1',
    collapsed === 'false',
    `bouton « Create match » rendu pour le capitaine, aria-expanded="${collapsed}" (« false » attendu : disclosure fermé, pas une modale)`,
  );

  // --------------------------------------------- §2 ouverture : le coût réseau exact
  setPhase('2. ouverture du panneau : une seule requête, et on dit laquelle');
  const daySelect = page.getByLabel('Day');
  const timeSelect = page.getByLabel('Kick-off');
  const openCalls = await apiCallsDuring(async () => {
    await createButton.click();
    await timeSelect.waitFor({ timeout: 10000 });
  });
  const expanded = await createButton.getAttribute('aria-expanded');
  step(
    'M2',
    openCalls.length === 1 && openCalls[0].includes('/api/ladders') && expanded === 'true',
    `requêtes à l’ouverture : ${openCalls.length} (1 attendue) -> ${openCalls.map((u) => new URL(u).pathname).join(', ') || 'aucune'} ; aria-expanded="${expanded}"`,
  );

  // ------------------------------------------------------ §3 la grille des créneaux
  setPhase('3. la liste d’heures : que des quarts, rien à moins de 15 min');
  const readTimes = () =>
    timeSelect.locator('option').evaluateAll((nodes) =>
      nodes
        .filter((node) => node.value !== '')
        .map((node) => ({
          value: Number(node.value),
          label: node.textContent.trim(),
          disabled: node.disabled,
        })),
    );
  const firstDayTimes = await readTimes();
  const floor = Date.now() + QUARTER_MS;
  const offGrid = firstDayTimes.filter((slot) => {
    const at = new Date(slot.value);
    return at.getUTCMinutes() % 15 !== 0 || at.getUTCSeconds() !== 0 || at.getUTCMilliseconds() !== 0;
  });
  const tooSoon = firstDayTimes.filter((slot) => slot.value < floor);
  step(
    'M3',
    firstDayTimes.length > 0 && offGrid.length === 0 && tooSoon.length === 0,
    `créneaux proposés : ${firstDayTimes.length}, hors quart fixe : ${offGrid.length} (0), à moins de 15 min : ${tooSoon.length} (0)`,
  );

  // ------------------------------------------------ §4 la lineup, validée CÔTÉ CLIENT
  setPhase('4. lineup : le non-lié est grisé, la taille exacte est exigée, 0 requête');
  // J+1 : toujours à plus de 20 min quelle que soit l'heure du run, et il reste de la place
  // des deux côtés de 14:00 pour vérifier la borne stricte du lockout au §6.
  const tomorrow = (
    await daySelect.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value))
  )[1];
  const submitButton = page.getByRole('button', { name: 'Open the slot' });
  // ⚠️ Le panneau est DÉMONTÉ à la fermeture : chaque réouverture repart d'une lineup vide.
  const boxOf = (as) => page.getByRole('checkbox', { name: as.pseudo });
  const pickLineup = async () => {
    await boxOf(user).click();
    await boxOf(teammate).click();
  };

  let benchedDisabled = false;
  let noneSelected = false;
  let oneSelected = false;
  let twoSelected = true;
  const lineupCalls = await apiCallsDuring(async () => {
    await daySelect.selectOption(tomorrow);
    const times = await readTimes();
    await timeSelect.selectOption(String(times[0].value));
    // Le créneau est choisi : ce qui bloque encore la soumission ne peut être que la lineup.
    noneSelected = await submitButton.isDisabled();
    benchedDisabled = await boxOf(benched).isDisabled();
    await boxOf(user).click();
    oneSelected = await submitButton.isDisabled();
    await boxOf(teammate).click();
    twoSelected = await submitButton.isDisabled();
  });
  const counter = await page.getByText('2/2 players selected').count();
  step(
    'M4',
    benchedDisabled &&
      noneSelected &&
      oneSelected &&
      !twoSelected &&
      counter === 1 &&
      lineupCalls.length === 0,
    `joueur sans compte ${provider} désactivé = ${benchedDisabled} ; soumission bloquée à 0/2 = ${noneSelected} et à 1/2 = ${oneSelected}, débloquée à 2/2 = ${!twoSelected}, compteur « 2/2 players selected » = ${counter === 1} ; requêtes émises par toute la saisie : ${lineupCalls.length} (0 attendue — validation 100 % client)`,
  );

  // -------------------------------------------------------------- §5 création (201)
  setPhase('5. création du créneau : 201, l’écran se met à jour sans rechargement');
  const dayTimes = await readTimes();
  const target = dayTimes.find((slot) => slot.label.startsWith('14:00'));
  if (!target) throw new Error('aucun créneau 14:00 sur J+1');
  await timeSelect.selectOption(String(target.value));

  const createResponse = page.waitForResponse(
    (res) => res.url().endsWith('/api/matches') && res.request().method() === 'POST',
    { timeout: 20000 },
  );
  await submitButton.click();
  const created = await createResponse;

  // Aucune navigation entre le clic et ces assertions : c'est là toute la preuve.
  const confirmed = await page
    .locator('[role="status"]', { hasText: 'Slot opened for' })
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const nextMatch = page.locator('section', {
    has: page.getByRole('heading', { name: 'Next match' }),
  });
  const nextMatchShown = await nextMatch
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  await page.getByRole('tab', { name: 'Matches' }).click();
  const openRows = await page.locator('tbody tr', { hasText: 'Open slot' }).count();
  step(
    'M5',
    created.status() === 201 && confirmed && nextMatchShown && openRows === 1,
    `POST /api/matches -> HTTP ${created.status()}, confirmation role="status" = ${confirmed}, bloc « Next match » apparu sans rechargement = ${nextMatchShown}, lignes « Open slot » dans l’historique : ${openRows} (1 attendue)`,
  );

  // --------------------------------------- §6 PRÉ-EMPTION DU LOCKOUT (le check central)
  setPhase('6. pré-emption du lockout : bornes STRICTES, et zéro requête pour le savoir');
  const reopenCalls = await apiCallsDuring(async () => {
    await page.getByRole('tab', { name: 'Overview' }).click();
    await createButton.click();
    await timeSelect.waitFor({ timeout: 10000 });
    await daySelect.selectOption(tomorrow);
  });
  const afterTimes = await readTimes();
  const stateAt = (offset) => {
    const slot = afterTimes.find((entry) => entry.value === target.value + offset);
    return slot ? (slot.disabled ? 'disabled' : 'enabled') : 'absent';
  };
  // 14:00 lui-même, ±1 quart : dans la fenêtre -> désactivés.
  const inside = [0, -QUARTER_MS, QUARTER_MS].map(stateAt);
  // ±lockout EXACTEMENT : les fenêtres se TOUCHENT, elles ne se chevauchent pas ->
  // toujours sélectionnables. C'est l'inégalité stricte du back (`gt`/`lt`, jamais
  // `gte`/`lte`) ; un `<=` côté client interdirait d'enchaîner deux matchs dos à dos.
  const edges = [-lockoutMs, lockoutMs].map(stateAt);
  step(
    'M6',
    inside.every((state) => state === 'disabled') &&
      edges.every((state) => state === 'enabled') &&
      reopenCalls.length === 0,
    `dans la fenêtre (T, T±15 min) : ${inside.join('/')} (disabled attendu) ; aux bornes T±${ladder.lockoutMinutes} min EXACTES : ${edges.join('/')} (enabled attendu — deux matchs qui se touchent ne se chevauchent pas) ; requêtes pour rouvrir et inspecter : ${reopenCalls.length} (0 attendue)`,
  );

  setPhase('6b. le panneau ouvert à 375 px');
  // Le vrai risque du panneau en colonne étroite : un `<select>` se dimensionne sur sa plus
  // large option (« 14:00 — already engaged »), et sans `min-w-0` sur sa colonne il pousse
  // la grille au lieu de se contraindre. On mesure, on ne regarde pas.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(400);
  const panelBox = await page
    .locator('section', { has: page.getByRole('heading', { name: 'Open a match slot' }) })
    .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  const panelDocOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'M6b',
    panelBox.scroll <= panelBox.client && panelDocOverflow <= 0,
    `panneau de création à 375 px : scrollWidth=${panelBox.scroll} vs clientWidth=${panelBox.client}, débordement du document ${panelDocOverflow}px (≤ 0 attendu)`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);

  // ------------------------------------------------------------ §7 le membre simple
  setPhase('7. un membre non-capitaine ne voit aucune des deux actions');
  await page.context().clearCookies();
  await page.context().addCookies(teammate.cookies);
  await page.goto(`${ORIGIN}/teams/${teamId}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Next match' }).waitFor({ timeout: 15000 });
  const memberCreate = await page.getByRole('button', { name: 'Create match' }).count();
  const memberCancels = await page.locator('button[aria-label^="Cancel the slot of"]').count();
  const memberSeesSlot = await page.getByText('Waiting for an opponent').count();
  step(
    'M7',
    memberCreate === 0 && memberCancels === 0 && memberSeesSlot === 1,
    `pour un membre : boutons « Create match » = ${memberCreate} (0), boutons d’annulation = ${memberCancels} (0), voit bien le créneau de son équipe = ${memberSeesSlot === 1}`,
  );

  // -------------------------------------------------- §8 annulation via ConfirmDialog
  setPhase('8. annulation du créneau : ConfirmDialog, puis la ligne passe « Cancelled »');
  await page.context().clearCookies();
  await page.context().addCookies(user.cookies);
  await page.goto(`${ORIGIN}/teams/${teamId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Matches' }).click();
  const slotRow = page.locator('tbody tr', { hasText: 'Open slot' });
  // AU CLAVIER : voir `pressEnterOn` dans runner.mjs.
  await pressEnterOn(slotRow.locator('button[aria-label^="Cancel the slot of"]'));

  const cancelResponse = page.waitForResponse(
    (res) => /\/api\/matches\/[0-9a-f-]{36}$/.test(res.url()) && res.request().method() === 'DELETE',
    { timeout: 20000 },
  );
  // `exact` : le bouton de la LIGNE s'appelle « Cancel the slot of … » et il est toujours
  // dans le DOM derrière la boîte — sans ça le sélecteur en trouverait deux.
  await pressEnterOn(page.getByRole('button', { name: 'Cancel the slot', exact: true }));
  const cancelled = await cancelResponse;

  const cancelledRows = await page
    .locator('tbody tr', { hasText: 'Cancelled' })
    .waitFor({ timeout: 15000 })
    .then(() => page.locator('tbody tr', { hasText: 'Cancelled' }).count())
    .catch(() => 0);
  const remainingButtons = await page.locator('button[aria-label^="Cancel the slot of"]').count();
  const nextMatchGone = await nextMatch.count();
  step(
    'M8',
    cancelled.status() === 200 && cancelledRows === 1 && remainingButtons === 0 && nextMatchGone === 0,
    `DELETE /api/matches/{id} -> HTTP ${cancelled.status()}, lignes « Cancelled » : ${cancelledRows} (1 — la ligne RESTE dans l’historique), boutons d’annulation restants : ${remainingButtons} (0), bloc « Next match » : ${nextMatchGone} (0)`,
  );

  // FX-FOCUS — ici DEUX choses disparaissent d'un coup : le bouton de la ligne et le bloc
  // « Next match » entier. Le repli est le PANNEAU d'onglet visible (nommé par son onglet),
  // faute d'un titre de section qui survive dans les deux onglets.
  const afterSlotCancel = await focusLanding();
  // ⚠️ On assert sur le RÔLE et le NOM, pas sur `tag === 'DIV'` : n'importe quel conteneur
  // de la page est un DIV, l'assertion ne prouverait que « pas BODY ».
  const slotAnnounced = afterSlotCancel.live.some((line) =>
    line.includes('cancelled. It stays in the history'),
  );
  step(
    'M8-bis',
    afterSlotCancel.role === 'region' &&
      afterSlotCancel.label.startsWith('Match history') &&
      slotAnnounced,
    `focus après annulation : <${afterSlotCancel.tag} role="${afterSlotCancel.role}"> « ${afterSlotCancel.label} » (la région « Match history », qui NOMME la liste ; JAMAIS BODY) — annonce trouvée = ${slotAnnounced}`,
  );

  // ------------------------------------------- §9 409 chevauchement sur page périmée
  setPhase('9. page périmée : le 409 de chevauchement, distingué SANS lire la prose serveur');
  await page.getByRole('tab', { name: 'Overview' }).click();
  await createButton.click();
  await timeSelect.waitFor({ timeout: 10000 });
  await daySelect.selectOption(tomorrow);
  const staleTimes = await readTimes();
  const rival = staleTimes.find((slot) => slot.label.startsWith('18:00'));
  if (!rival) throw new Error('aucun créneau 18:00 sur J+1');
  await timeSelect.selectOption(String(rival.value));
  // Panneau remonté à neuf : la lineup est repartie de zéro.
  await pickLineup();

  // Le créneau est ouvert DANS LE DOS de l'onglet : les options affichées ont été calculées
  // avant, et rien côté client ne peut le deviner. C'est exactement la page périmée que le
  // 409 doit rattraper.
  const behindTheBack = await api(user, '/matches', {
    method: 'POST',
    body: JSON.stringify({
      ladderId: ladder.id,
      scheduledAt: new Date(rival.value).toISOString(),
      lineup: [captainId, teammateId],
    }),
  });

  // ⚠️ Le motif est confronté à « <url> <texte> » : un `$` après l’URL ne matcherait jamais.
  // Le `(:\d+)?` couvre la variante « /api/matches:0 » du flux console.
  expectHttp(
    /\/api\/matches(:\d+)?(\s|$)/,
    'POST 409 : chevauchement provoqué par une page périmée',
  );
  const conflictResponse = page.waitForResponse(
    (res) => res.url().endsWith('/api/matches') && res.request().method() === 'POST',
    { timeout: 20000 },
  );
  await submitButton.click();
  const conflict = await conflictResponse;
  // Comparaison EXACTE : c'est ce qui garde la désambiguïsation locale des deux 409. Les
  // deux réponses du back sont `{ error }` sans `code` stable — si un jour ce message
  // devenait celui du plafond, ce check tomberait.
  // ⚠️ `waitFor`, pas `count()` : le `onError` du hook réinvalide l'historique et le message
  // n'est peint qu'au rendu suivant — `count()` ne patiente pas et lirait 0.
  const shown = await page
    .getByText(
      'This team is already engaged around that time. The list of times has just been refreshed.',
      { exact: true },
    )
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'M9',
    behindTheBack.status === 201 && conflict.status() === 409 && shown,
    `créneau concurrent ouvert par API -> HTTP ${behindTheBack.status}, soumission de l’option périmée -> HTTP ${conflict.status()}, message « chevauchement » (et non « plafond ») affiché en exact = ${shown}`,
  );

  // ------------------------------------------------ §10 le plafond, PRÉ-EMPTÉ côté client
  setPhase('10. cinq slots ouverts : le formulaire disparaît, aucune requête ne part');
  // Quatre créneaux de plus, espacés d'une heure (> lockout de 30 min) : aucun ne se
  // chevauche, ils comptent donc tous les cinq dans le plafond.
  for (let index = 1; index <= 4; index += 1) {
    const response = await api(user, '/matches', {
      method: 'POST',
      body: JSON.stringify({
        ladderId: ladder.id,
        scheduledAt: new Date(rival.value + index * HOUR_MS).toISOString(),
        lineup: [captainId, teammateId],
      }),
    });
    if (response.status !== 201) throw new Error(`slot ${index} refusé : HTTP ${response.status}`);
  }
  await page.goto(`${ORIGIN}/teams/${teamId}`, { waitUntil: 'networkidle' });
  const cappedCalls = await apiCallsDuring(async () => {
    await createButton.click();
    await page.getByText('already holds 5 open slots').first().waitFor({ timeout: 10000 });
  });
  const cappedSubmit = await page.getByRole('button', { name: 'Open the slot' }).count();
  // La donnée de référence `GET /ladders` repart après ce `page.goto` (le cache TanStack
  // meurt avec la page) : ce qui doit rester à ZÉRO, c'est `/matches` — le plafond est
  // pré-empté, aucune tentative ne part vers un 409 déjà connu.
  const cappedMatchCalls = cappedCalls.filter((url) => url.includes('/api/matches'));
  step(
    'M10',
    cappedSubmit === 0 && cappedMatchCalls.length === 0,
    `à 5 slots ouverts : bouton de soumission rendu = ${cappedSubmit} (0 — le formulaire n’est plus monté), requêtes vers /api/matches : ${cappedMatchCalls.length} (0 attendue) ; autres requêtes du panneau : ${cappedCalls.map((u) => new URL(u).pathname).join(', ') || 'aucune'}`,
  );

  // ------------------------------------------------------------- §11 375 px et filets
  setPhase('11. largeur étroite et filets transverses');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: 'Matches' }).click();
  // Les deux moitiés de l'historique depuis [FX-TABLE] : le TABLEAU à partir de `sm`, les
  // CARTES en dessous. Les deux largeurs se mesurent, parce qu'elles gardent deux pièges
  // différents.
  const historyBox = page.locator('[role="region"][aria-label^="Match history"]');
  const wideRows = await historyBox.locator('tbody tr').count();
  const wideCancels = await historyBox.locator('button[aria-label^="Cancel the slot of"]').count();

  // 🔑 LE PIÈGE DU `relative`, ASSERTÉ SUR SA CAUSE ET NON SUR SON EFFET DE BORD. Le
  // `<span class="sr-only">` de l'en-tête Actions est en `position:absolute` : il n'est ramené
  // sous l'`overflow` de la boîte que si celle-ci est un BLOC CONTENEUR, donc positionnée.
  // Sinon il se résout contre le bloc conteneur initial et élargit le DOCUMENT.
  //
  // ⚠️ Ce filet se mesurait jusqu'ici par son symptôme — le débordement du document à 375 px —
  // et [FX-TABLE] l'a fait disparaître (à 375 px il n'y a plus de table du tout). Le déplacer à
  // 640 px l'aurait tué EN SILENCE : mesuré, le `sr-only` échappé atterrit à x=626 quelle que
  // soit la largeur, donc à 640 px il tombe DANS le viewport (débordement -13, check vert) là
  // où il donnait +252 à 375 px. On assert donc la propriété portante elle-même : elle ne peut
  // pas mourir sans que la ligne rougisse.
  const boxPosition = await historyBox
    .evaluate((el) => getComputedStyle(el).position)
    .catch(() => '—introuvable—');
  const scroller = await historyBox
    .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
    .catch(() => ({ scroll: -1, client: -1 }));
  step(
    'M11',
    boxPosition !== 'static' && boxPosition !== '—introuvable—' && scroller.scroll > scroller.client,
    `position calculée de la boîte du tableau : « ${boxPosition} » (autre que « static » attendu — c'est ce qui clippe le <span class="sr-only"> de l'en-tête Actions et garde le DOCUMENT de déborder) ; la boîte défile bien elle-même (scrollWidth=${scroller.scroll} > clientWidth=${scroller.client})`,
  );

  // 375 px : la table est REMPLACÉE par des cartes — un seul arbre monté, jamais deux. Et
  // l'action d'annulation, qui n'existe que sur cet écran, doit rester joignable au doigt :
  // c'est elle qui disparaissait derrière le défilement horizontal.
  await page.setViewportSize({ width: 375, height: 900 });
  const cardList = page.getByRole('list', { name: /Match history/ });
  const cardsShown = await cardList
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const cards = cardsShown ? await cardList.locator('> li').count() : 0;
  const cardCancels = cardsShown
    ? await cardList.locator('button[aria-label^="Cancel the slot of"]').count()
    : 0;
  const regionsAt375 = await historyBox.count();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'M11b',
    overflow <= 0 &&
      cards === wideRows &&
      cards > 0 &&
      regionsAt375 === 0 &&
      cardCancels === wideCancels &&
      wideCancels > 0,
    `débordement horizontal du document à 375 px : ${overflow}px (≤ 0 attendu) ; cartes rendues : ${cards} (${wideRows} attendues — autant que de lignes à 1280 px), région défilante résiduelle : ${regionsAt375} (0 attendue — la table est démontée, pas masquée), boutons « Cancel the slot » dans les cartes : ${cardCancels} (${wideCancels} attendus)`,
  );

  // 🔑 LE FOCUS APRÈS ANNULATION, À 375 PX. M8-bis ne garde que la version 1280 px, où le point
  // d'atterrissage est la région défilante. Sous `sm` cette région n'existe plus : c'est la
  // LISTE (`<ul tabIndex={-1}>`) qui reçoit le focus, et le bouton qui l'avait vient d'être
  // démonté — sans ce check, le seul mobile serait garanti par la lecture du code.
  //
  // ⚠️ On attend le focus SUR LA BALISE VISÉE, pas « autre chose que BODY » : juste après
  // l'Entrée, `activeElement` est encore le bouton de la boîte de dialogue, donc déjà différent
  // de BODY — une attente générique rendrait la main trop tôt et lirait le mauvais élément.
  // Et rien n'est lu dans la région live ici : l'annonce de l'annulation du §8 y est toujours
  // écrite, `awaitAnnouncement` matcherait la PRÉCÉDENTE (invariant #11).
  await pressEnterOn(cardList.locator('button[aria-label^="Cancel the slot of"]').first());
  await pressEnterOn(page.getByRole('button', { name: 'Cancel the slot', exact: true }));
  const landedOnList = await page
    .waitForFunction(() => document.activeElement?.tagName === 'UL', null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const narrowLanding = await focusLanding();
  step(
    'M11c',
    landedOnList && narrowLanding.label.startsWith('Match history'),
    `focus après annulation à 375 px : <${narrowLanding.tag ?? '—'}> « ${narrowLanding.label} » (le <ul> nommé « Match history… » attendu ; ni BODY, ni un bouton démonté)`,
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);

  // 🔑 LE RETOUR EN GRAND. Cette largeur n'était gardée par rien alors que c'est celle du
  // correcteur : le tableau doit revenir, les cartes disparaître (un seul arbre monté), et le
  // DOCUMENT ne pas déborder — la table, elle, défile dans sa propre boîte.
  const backToTable = await historyBox.count();
  const wideCards = await page.getByRole('list', { name: /Match history/ }).count();
  const wideOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'M11d',
    backToTable === 1 && wideCards === 0 && wideOverflow <= 0,
    `débordement horizontal du document à 1280 px : ${wideOverflow}px (≤ 0 attendu) ; région du tableau revenue : ${backToTable} (1 attendue), liste de cartes résiduelle : ${wideCards} (0 attendue)`,
  );

  // ------------------------------------------ §12 dissolution refusée : le 409 par `code`
  // L'état coûteux est DÉJÀ construit : l'équipe porte les créneaux `pending` du §10, donc
  // le back refuse la dissolution en 409 `team_engaged_in_match`. C'est le seul endroit de
  // la campagne où ce refus est atteignable À LA SOURIS, et un refus doit porter son remède.
  setPhase('12. dissolution refusée : l’équipe a des créneaux ouverts');
  await page.getByRole('tab', { name: 'Manage' }).click();
  await page.getByLabel('Team name').waitFor({ timeout: 10000 });
  // Le dialogue est monté en permanence mais fermé (`<dialog>` = display:none), donc hors
  // arbre d'accessibilité : `.first()` ne peut désigner que le bouton de la Danger zone.
  await page.getByRole('button', { name: 'Dissolve team' }).first().click();
  const dissolveDialog = page.locator('dialog[open]');
  await dissolveDialog.waitFor({ timeout: 5000 });

  // ⚠️ Le motif est confronté à « <url> <texte> » ; le `(:\d+)?` couvre la variante
  // « /api/teams/<id>:0 » du flux console. Ancré sur l'id de CETTE équipe, et la
  // déclaration ne vaut que dans CETTE phase (garde-fou du runner).
  expectHttp(
    new RegExp(`/api/teams/${teamId}(:\\d+)?(\\s|$)`),
    'DELETE 409 : dissolution refusée, l’équipe a des créneaux ouverts',
  );
  const refusalPromise = page.waitForResponse(
    (res) => res.url().endsWith(`/api/teams/${teamId}`) && res.request().method() === 'DELETE',
    { timeout: 20000 },
  );
  await dissolveDialog.getByRole('button', { name: 'Dissolve team' }).click();
  const refusal = await refusalPromise;
  // Comparaison EXACTE, comme le 409 du §9 : c'est elle qui garde la traduction du `code`
  // `team_engaged_in_match`. La prose du back est autre (« cancel or finish the team
  // matches before dissolving it ») — la réafficher telle quelle ferait rougir ce check, et
  // le message générique « Could not dissolve the team. » aussi.
  const refusalShown = await dissolveDialog
    .getByText(
      'You cannot dissolve this team while it has an open or ongoing match — cancel it or finish it first.',
      { exact: true },
    )
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  // Un refus ne navigue pas : `leaveTeamPage()` n'est appelé que par `onSuccess`.
  const stillOnTeamPage = page.url().includes(teamId);
  step(
    'M14',
    refusal.status() === 409 && refusalShown && stillOnTeamPage,
    `DELETE /api/teams/{id} -> HTTP ${refusal.status()} (409 attendu), message dérivé du \`code\` affiché en exact = ${refusalShown}, page de l’équipe conservée = ${stillOnTeamPage}`,
  );
  await page.keyboard.press('Escape');

  step(
    'M12',
    notFound.length === 0,
    `404 sur TOUT le parcours : ${notFound.length} (0 attendu)${notFound.length ? ` -> ${notFound.slice(0, 3).join(', ')}` : ''}`,
  );
  step(
    'M13',
    nativeDialogs === 0,
    `boîtes natives (window.confirm/alert) rencontrées : ${nativeDialogs} (0 attendu — la confirmation passe par ConfirmDialog)`,
  );
}
