/**
 * `/admin/disputes` + l'onglet « Arbitration » du rail + le panneau d'arbitrage — [F-ADMIN].
 *
 * La file d'arbitrage était INVISIBLE : `GET /disputes` et `POST /disputes/{id}/resolve` existent
 * côté back depuis B7, et AUCUN écran ne les appelait. Le seul chemin vers `resolved` que le
 * produit savait prendre était donc le **timeout du job 24 h**, qui annule le match — autrement
 * dit, tout litige finissait en « ça ne compte pour rien », faute d'arbitre atteignable.
 *
 * Ce que ce scénario garde :
 *   - un joueur ORDINAIRE ne voit pas l'onglet (6 liens, exactement ceux de `f-nav`) et ne
 *     déclenche **jamais** `GET /disputes` ;
 *   - un non-admin sur `/admin/disputes` voit un écran dédié rendu **SANS AUCUNE REQUÊTE**
 *     (la route rend 403, et un 403 est une ligne rouge = motif de rejet du projet) ;
 *   - un ADMIN voit l'onglet en dernière position, peint avec le token `--color-arena-red`
 *     **lu depuis la page** (jamais une valeur en dur), et son badge de compte ;
 *   - la file : autant de lignes que l'API en rend, la plus ANCIENNE en tête, et une ligne qui
 *     nomme ses deux camps, son jeu, son format, ses preuves et son échéance ;
 *   - l'état VIDE, qui est le cas NOMINAL et ne doit pas être peint en rouge ;
 *   - le parcours file -> dossier -> arbitrage -> état résolu, avec l'annonce et le focus rendu
 *     au `<h1>` (le panneau disparaît sous l'utilisateur : FX-FOCUS) ;
 *   - l'invalidation croisée : la ligne quitte la file et le badge décroît ;
 *   - un participant NON-admin sur un dossier ouvert : **zéro contrôle d'arbitrage** ;
 *   - 375 px.
 *
 * 🚨🚨 LE PIÈGE N°1 DE CE TICKET, ET IL FRAPPE UN AUTRE SCÉNARIO. Ce fichier PROMEUT le compte du
 * run en admin (`update users set is_admin = true`), parce qu'aucune séquence HTTP ne le peut :
 * les comptes admin sont créés à la main en base, il n'existe et n'existera aucun écran de
 * promotion. Un flag laissé en base fait **7 liens** dans le rail, et `f-nav.mjs:51` assert qu'il
 * y en a exactement **6** avec une liste de libellés figée — donc `f-nav` sort ROUGE, sur un
 * scénario qui n'a rien à voir avec celui-ci. Le `finally` remet donc `is_admin = false` **quoi
 * qu'il arrive**, avant toute autre chose.
 *
 * 🚨 IL NE TOUCHE JAMAIS À LA DISPUTE SEMÉE. `match-detail` exige les 7 états cs2 et `dispute`
 * exige que la dispute de démo reste OUVERTE : la résoudre casserait les deux. Ce scénario
 * fabrique donc **ses deux** disputes chess 1v1 jetables (recette de `match-result` / `dispute`)
 * et n'en résout qu'une. Tous ses comptages sont **relatifs à ce que l'API répond au même
 * instant**, jamais des nombres absolus — la base de dev est partagée et porte des données de
 * démo posées à la main (leçon [FX-AUDIT]).
 *
 * ⚠️ IL NE DÉPEND PAS DU SEED : deux comptes jetables, comptes `chess_com` liés par API. Seul le
 * ladder **chess 1v1** est attendu, et il vient des migrations.
 *
 * ⚠️ DEUX disputes et pas une, et ce n'est pas du confort : la première est ARBITRÉE (elle prouve
 * le chemin d'écriture), la seconde reste OUVERTE pour éprouver le négatif — un participant qui
 * n'est pas admin ne doit voir aucun contrôle. Réutiliser la première, déjà résolue, aurait rendu
 * ce négatif vert pour la mauvaise raison (« le dossier est clos »), pas pour la bonne
 * (« ce compte n'arbitre pas »).
 */
import { assertUuid } from '../sql.mjs';

export const name = 'admin-disputes';
export const surface = '/admin/disputes + onglet Arbitration + panneau d’arbitrage (F-ADMIN)';

/** Provider exigé par le jeu `chess` (`games.required_provider`, migration 0008). */
const CHESS_PROVIDER = 'chess_com';

/** Les 6 items que TOUT LE MONDE voit — copie volontaire de `f-nav.mjs`, c'est ce qu'on garde. */
const PLAYER_ITEMS = ['Home', 'My teams', 'Solo', 'Games', 'Matchmaking', 'History'];

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
 * Un coup d'envoi VALIDE côté serveur : aligné sur le quart (`:00/:15/:30/:45`), secondes et ms à
 * zéro, à plus de 15 minutes. Depuis B5d le back refuse tout le reste en 400 — d'où l'arrondi AU
 * QUART SUPÉRIEUR, le même que `future()` dans `backend/tests/helpers.py`.
 */
function futureQuarter(hoursAhead = 1) {
  const at = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  at.setUTCSeconds(0, 0);
  at.setUTCMinutes(at.getUTCMinutes() + ((15 - (at.getUTCMinutes() % 15)) % 15));
  return at.toISOString();
}

export async function run({
  page,
  setPhase,
  step,
  countRequests,
  createUser,
  user,
  ORIGIN,
  sql,
  login,
  awaitAnnouncement,
  awaitFocusRestored,
  focusLanding,
}) {
  /**
   * Appel API direct, lu par NODE : ces requêtes ne traversent pas la console auditée. C'est la
   * source de vérité contre laquelle on compare l'écran ensuite.
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

  const main = page.locator('main');
  const rail = page.locator('aside:has(nav[aria-label="Primary navigation"])');
  const navLinks = rail.locator('nav[aria-label="Primary navigation"] a');
  const adminTab = rail.locator('nav[aria-label="Primary navigation"] a[href="/admin/disputes"]');
  const railBadge = adminTab.locator('span.rounded-full');

  /**
   * Le texte du badge, blancs normalisés — `''` quand il n'y en a pas.
   *
   * ⚠️ `textContent`, JAMAIS `innerText`, et c'est ce qui a fait rougir deux checks au premier
   * jet : `label-caps` met le RENDU en capitales (`innerText` rendait « 3\nOPEN DISPUTES ») là où
   * le DOM garde la casse et l'espacement d'origine. C'est le DOM qu'on veut — c'est lui que lit
   * un lecteur d'écran.
   */
  const readBadge = async () =>
    (await railBadge.count()) === 1
      ? railBadge.evaluate((el) => el.textContent.replace(/\s+/g, ' ').trim())
      : '';

  /**
   * La route de la file, et elle SEULE.
   *
   * ⚠️ `/api/` tout court ne conviendrait PAS : un `page.goto` recharge toute la SPA, qui rejoue
   * son bootstrap de session (`POST /auth/refresh` + `GET /users/me`) — deux requêtes légitimes,
   * sans rapport. Et `disputes` tout court ne conviendrait pas non plus : la NAVIGATION du
   * document vers `/admin/disputes` porte le mot elle-même (leçon MM10/D1). Le témoin positif
   * `A2b` rejoue EXACTEMENT ce filtre côté admin, parce que « 0 requête » est aussi ce que mesure
   * un filtre qui ne matche rien.
   */
  const queueCalls = (url) => url.includes('/api/disputes');

  /** Mon id, nécessaire à la promotion SQL — et lu AVANT le `try`, voir le `finally`. */
  const meRes = await api(user, '/users/me');
  if (!meRes.ok) throw new Error(`GET /users/me -> ${meRes.status}`);
  const myId = assertUuid((await meRes.json()).user.id, 'id du compte du run');

  /** Les matchs jetables de ce run, à effacer au teardown quoi qu'il arrive. */
  const ownMatchIds = [];
  let promoted = false;

  try {
    // ------------------------------------------- §0 deux disputes chess 1v1 jetables (API + SQL)
    setPhase('0. mise en place (API directe + SQL) : deux disputes chess 1v1 jetables');

    const foe = await createUser();
    const link = (as) =>
      api(as, '/users/me/external-accounts', {
        method: 'POST',
        body: JSON.stringify({ provider: CHESS_PROVIDER, externalId: `ADMIN-${as.stamp}` }),
      });
    // §5.1 — sans compte lié, `validateSide()` refuse le camp en 400 dès la création du créneau.
    await link(user);
    await link(foe);

    const laddersRes = await api(user, '/ladders');
    if (!laddersRes.ok) throw new Error(`GET /ladders -> ${laddersRes.status}`);
    const { ladders } = await laddersRes.json();
    const chess = ladders.find((l) => l.gameId === 'chess' && l.format === '1v1');
    if (!chess) {
      throw new Error('aucun ladder chess 1v1 en base — les migrations sont-elles passées ?');
    }

    /**
     * Fabrique UNE dispute : créneau créé par `user` (donc **side 0 = user**), accepté par `foe`,
     * coup d'envoi reculé, puis deux verdicts CONTRADICTOIRES.
     *
     * ⚠️ Le recul du coup d'envoi est l'usage sanctionné de `sql()` : `POST /matches` exige un
     * futur (≥ 15 min) et `POST /result` exige un passé (§5.3) — aucune séquence HTTP ne satisfait
     * les deux. Recette de `match-result.mjs`.
     *
     * ⚠️ Les deux créneaux sont posés à des heures DIFFÉRENTES et reculés à des heures
     * différentes : le serveur refuse deux matchs qui se chevauchent pour un même joueur.
     */
    const forgeDispute = async (hoursAhead, backdateHours) => {
      const created = await api(user, '/matches', {
        method: 'POST',
        body: JSON.stringify({ ladderId: chess.id, scheduledAt: futureQuarter(hoursAhead) }),
      });
      if (created.status !== 201) {
        throw new Error(`POST /matches -> ${created.status} : ${await created.text()}`);
      }
      const matchId = assertUuid(await created.json().then(({ match }) => match.id), 'matchId');
      ownMatchIds.push(matchId);

      const accepted = await api(foe, `/matches/${matchId}/accept`, { method: 'POST' });
      if (accepted.status !== 200) throw new Error(`accept -> ${accepted.status}`);
      sql(
        `update matches set scheduled_at = now() - interval '${backdateHours} hour' where id = '${matchId}';`,
      );

      const sheet = await api(user, `/matches/${matchId}`).then((r) => r.json());
      const [sideA, sideB] = sheet.sides;
      await api(user, `/matches/${matchId}/result`, {
        method: 'POST',
        body: JSON.stringify({ winnerSideId: sideA.id, scoreSelf: 2, scoreOpponent: 0 }),
      });
      const clash = await api(foe, `/matches/${matchId}/result`, {
        method: 'POST',
        body: JSON.stringify({ winnerSideId: sideB.id, scoreSelf: 2, scoreOpponent: 1 }),
      });
      if (clash.status !== 200) throw new Error(`2ᵉ soumission -> ${clash.status}`);

      return {
        matchId,
        disputeId: assertUuid(
          sql(`select id from disputes where match_id = '${matchId}';`),
          'disputeId jetable',
        ),
      };
    };

    const toSettle = await forgeDispute(1, 1);
    const toLeaveOpen = await forgeDispute(3, 3);

    // ------------------------------------------------- §1 joueur ORDINAIRE : pas d'onglet du tout
    setPhase('1. joueur ordinaire : aucun onglet Arbitration, aucune requête GET /disputes');
    const playerCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
      await page.goto(`${ORIGIN}/history`, { waitUntil: 'networkidle' });
    }, queueCalls);

    // `textContent` et non `innerText` : `label-caps` applique `text-transform: uppercase`, donc
    // le texte RENDU est en capitales alors que celui lu par un lecteur d'écran ne l'est pas.
    const playerLabels = await navLinks.evaluateAll((nodes) =>
      nodes.map((node) => node.textContent.trim()),
    );
    const playerTab = await adminTab.count();
    step(
      'A1',
      playerLabels.length === PLAYER_ITEMS.length &&
        playerLabels.every((label, i) => label === PLAYER_ITEMS[i]) &&
        playerTab === 0 &&
        playerCalls === 0,
      `rail d’un joueur ordinaire : ${JSON.stringify(playerLabels)} (les 6 de f-nav attendus), onglet Arbitration ${playerTab} (0 attendu), requêtes /api/disputes ${playerCalls} (0 attendu — la route rendrait 403, donc une ligne rouge sur CHAQUE page)`,
    );

    // ------------------------------------- §2 non-admin sur /admin/disputes : écran, 0 requête
    setPhase('2. non-admin sur /admin/disputes : écran dédié, AUCUNE requête');
    const deniedCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/admin/disputes`, { waitUntil: 'networkidle' });
    }, queueCalls);
    const deniedScreen = await appears(main.locator('h1:has-text("Reserved for admins")'));
    step(
      'A2',
      deniedScreen && deniedCalls === 0,
      `écran « Reserved for admins » : ${deniedScreen}, requêtes /api/disputes ${deniedCalls} (0 attendu — un 403 certain ne se paie pas en ligne rouge)`,
    );

    // ------------------------------------------------------------------- §3 promotion en admin
    /**
     * 🚨 L'USAGE SANCTIONNÉ DE `sql()` : forcer un état que l'API interdit d'atteindre. Les
     * comptes admin sont créés À LA MAIN EN BASE — il n'existe aucun écran d'inscription admin,
     * aucune promotion depuis l'UI, et il n'y en aura pas.
     *
     * ⚠️ Aucune reconnexion n'est nécessaire : `is_admin` n'est pas dans le JWT, la route le relit
     * en base, et le rechargement de la SPA rejoue `restoreSession()` -> `GET /users/me`, qui rend
     * le flag frais.
     */
    setPhase('3. promotion du compte en admin (SQL) puis rechargement');
    sql(`update users set is_admin = true where id = '${myId}';`);
    promoted = true;

    const queueBefore = await api(user, '/disputes');
    if (!queueBefore.ok) throw new Error(`GET /disputes -> ${queueBefore.status}`);
    const openBefore = (await queueBefore.json()).disputes;

    const adminCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/admin/disputes`, { waitUntil: 'networkidle' });
      await appears(main.locator('h1:has-text("Disputes to settle")'));
    }, queueCalls);
    step(
      'A2b',
      adminCalls > 0,
      `témoin positif : même filtre côté admin -> ${adminCalls} requête(s) /api/disputes (> 0 attendu — « 0 requête » est aussi ce que mesure un filtre qui ne matche rien)`,
    );

    // ------------------------------------------------------- §4 l'onglet, sa place, sa couleur
    setPhase('4. rail d’un admin : l’onglet, sa position, sa couleur, son badge');
    const adminLabels = await navLinks.evaluateAll((nodes) =>
      nodes.map((node) => node.textContent.trim()),
    );
    const lastLabel = adminLabels.at(-1) ?? '';
    step(
      'A3',
      adminLabels.length === PLAYER_ITEMS.length + 1 &&
        PLAYER_ITEMS.every((label, i) => adminLabels[i] === label) &&
        lastLabel.startsWith('Arbitration'),
      `rail d’un admin : ${adminLabels.length} liens (7 attendus), les 6 de tout le monde inchangés dans l’ordre, dernier = « ${lastLabel} » (Arbitration attendu, SOUS History)`,
    );

    /**
     * 🔑 LA COULEUR EST COMPARÉE AU TOKEN LU DANS LA PAGE, jamais à un `rgb(...)` en dur : une
     * valeur figée ici se périmerait au premier retouche du design system, et le check
     * deviendrait faux sans devenir rouge.
     *
     * ⚠️ `MenuItem` porte `transition` (150 ms sur les couleurs) : lire la couleur calculée juste
     * après la navigation rend la valeur INTERPOLÉE. Même attente que `N13` de `f-nav`.
     */
    await page.waitForTimeout(400);
    const colours = await page.evaluate(() => {
      const link = document.querySelector(
        'nav[aria-label="Primary navigation"] a[href="/admin/disputes"]',
      );
      if (!link) return null;
      // Sonde : on demande au navigateur de résoudre le token lui-même, donc la comparaison se
      // fait entre deux couleurs calculées, dans le même espace, sans conversion à la main.
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-arena-red)';
      document.body.appendChild(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      return { link: getComputedStyle(link).color, token };
    });
    step(
      'A3b',
      colours !== null && colours.link === colours.token,
      `couleur de l’onglet : ${colours?.link ?? '—'} vs token --color-arena-red résolu ${colours?.token ?? '—'} (identiques attendus — aucune couleur en dur)`,
    );

    /**
     * Le badge : comparé à ce que l'API répond, jamais à un nombre absolu.
     *
     * ⚠️ ON LIT `textContent`, PAS `innerText`, ET ON NORMALISE LES BLANCS. Le `sr-only` fait
     * partie du contenu — c'est tout son intérêt — donc le badge « vaut » « 3 open disputes » et
     * non « 3 » : un `=== '3'` était un check faux, pas un défaut du rail. Et `label-caps` met le
     * RENDU en capitales là où le DOM garde la casse d'origine, d'où `textContent`.
     */
    const badgeCount = await railBadge.count();
    const badgeText = await readBadge();
    const expectedBadge = `${openBefore.length} open dispute${openBefore.length === 1 ? '' : 's'}`;
    // Le NOM ACCESSIBLE du lien : c'est lui qui doit dire ce que le chiffre signifie, sinon un
    // lecteur d'écran annonce « Arbitration 3 » et le 3 ne veut rien dire.
    const tabName = await adminTab.evaluate((el) => el.textContent.replace(/\s+/g, ' ').trim());
    step(
      'A4',
      openBefore.length > 0 &&
        badgeCount === 1 &&
        badgeText === expectedBadge &&
        tabName === `Arbitration${expectedBadge}`,
      `badge : « ${badgeText || '—'} » (« ${expectedBadge} » attendu pour ${openBefore.length} dispute(s) ouverte(s) selon l’API), nom accessible du lien « ${tabName} »`,
    );

    // ------------------------------------------------------------------------- §5 la file
    setPhase('5. la file : autant de lignes que l’API, la plus ancienne en tête');
    const rows = main.locator('ul[aria-label="Disputes to settle"] > li');
    const rowCount = await rows.count();
    const hrefs = rowCount
      ? await rows
          .locator('a')
          .evaluateAll((els) => els.map((el) => el.getAttribute('href')))
      : [];
    const firstExpected = `/disputes/${openBefore[0]?.id}`;
    step(
      'A5',
      rowCount === openBefore.length &&
        hrefs[0] === firstExpected &&
        hrefs.every((href) => href?.startsWith('/disputes/')),
      `file : ${rowCount} ligne(s) pour ${openBefore.length} selon l’API, 1ʳᵉ ligne -> « ${hrefs[0] ?? '—'} » (${firstExpected} attendu — le back trie de la plus ANCIENNE à la plus récente, le front ne re-trie pas), toutes les lignes mènent à un dossier`,
    );

    // MA ligne, repérée par les deux pseudos du run : la base est partagée, on ne suppose jamais
    // être seul dessus.
    const myRow = rows.filter({ hasText: user.pseudo });
    const myRowCount = await myRow.count();
    const myRowText = myRowCount >= 1 ? await myRow.first().innerText() : '';
    const namesBothCamps = myRowText.includes(user.pseudo) && myRowText.includes(foe.pseudo);
    // `formatDuration` rend « 23 h 47 min » : l'unité est portée par les DEUX nombres, donc jamais
    // lisible comme l'horaire « 23:47 » posé sur la même ligne (le piège de F-HOME).
    const hasDeadline = /\d+\s(h|min|d)\b[^]*left/.test(myRowText);
    const hasAge = /Opened .* ago/.test(myRowText);
    const hasEvidence = /no evidence yet|piece(s)? of evidence/.test(myRowText);
    const hasGame = /chess/i.test(myRowText) && /1V1/i.test(myRowText);
    step(
      'A6',
      myRowCount === 2 &&
        namesBothCamps &&
        hasDeadline &&
        hasAge &&
        hasEvidence &&
        hasGame,
      `mes 2 disputes jetables : ${myRowCount} ligne(s) trouvée(s) (2 attendues) ; la 1ʳᵉ nomme ses deux camps ${namesBothCamps}, porte son échéance ${hasDeadline}, son âge ${hasAge}, ses preuves ${hasEvidence}, son jeu+format ${hasGame} — « ${myRowText.replace(/\s+/g, ' ').slice(0, 120)} »`,
    );

    // ------------------------------------------------------------------ §6 l'état VIDE
    /**
     * 🚨 L'ÉTAT VIDE EST LE CAS NOMINAL — « aucun litige à arbitrer » est ce qu'on veut d'une
     * plateforme qui tourne bien, pas une panne. Le peindre en rouge apprendrait à l'arbitre à
     * ignorer le rouge le jour où il compte.
     *
     * ⚠️ Fabriqué par `page.route` (idiome `H18` de `home`), PAS en vidant la base : la table des
     * disputes porte la dispute de démo dont `dispute` et `match-detail` dépendent. La réponse est
     * un 200, donc rien à déclarer en `expectHttp`.
     *
     * ⚠️ Le prédicat vise le CHEMIN EXACT : `/api/disputes/{id}` commence par `/api/disputes`, donc
     * un `startsWith` détournerait aussi les dossiers individuels.
     */
    setPhase('6. file vide : message neutre, jamais un ton d’alerte');
    const emptyRoute = (url) => url.pathname === '/api/disputes';
    await page.route(emptyRoute, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ disputes: [] }),
      }),
    );
    await page.goto(`${ORIGIN}/admin/disputes`, { waitUntil: 'networkidle' });
    const emptyBox = main.locator('p:has-text("No dispute is waiting on an arbiter")');
    const emptyShown = await appears(emptyBox);
    const emptyRows = await main.locator('ul[aria-label="Disputes to settle"]').count();
    const emptyBadge = await railBadge.count();
    // Le TON, mesuré sur la couleur rendue plutôt que sur une classe : `Callout tone="danger"`
    // pose la bordure `arena-red`, `muted` pose `border-subtle`. On compare au token résolu.
    const emptyBorder = emptyShown
      ? await page.evaluate(() => {
          const box = [...document.querySelectorAll('main p')].find((p) =>
            p.textContent.includes('No dispute is waiting on an arbiter'),
          );
          const probe = document.createElement('span');
          probe.style.color = 'var(--color-arena-red)';
          document.body.appendChild(probe);
          const red = getComputedStyle(probe).color;
          probe.remove();
          return { border: getComputedStyle(box).borderTopColor, red };
        })
      : null;
    const notAlarming = emptyBorder !== null && !emptyBorder.border.includes(emptyBorder.red.slice(4, -1));
    step(
      'A7',
      emptyShown && emptyRows === 0 && emptyBadge === 0 && notAlarming,
      `file vide : message neutre ${emptyShown}, ${emptyRows} liste rendue (0 attendue), badge du rail ${emptyBadge} (0 attendu — pas de « 0 » qui attire l’œil), bordure ${emptyBorder?.border ?? '—'} ≠ arena-red ${emptyBorder?.red ?? '—'} : ${notAlarming}`,
    );
    await page.unroute(emptyRoute);

    // --------------------------------------------- §7 file -> dossier -> arbitrage -> résolu
    setPhase('7. parcours : la file mène au dossier, et le dossier s’arbitre');
    await page.goto(`${ORIGIN}/admin/disputes`, { waitUntil: 'networkidle' });
    const settleRow = main
      .locator('ul[aria-label="Disputes to settle"] > li')
      .filter({ has: page.locator(`a[href="/disputes/${toSettle.disputeId}"]`) });
    const settleRowFound = await appears(settleRow);
    if (settleRowFound) await settleRow.locator('a').first().click();
    // ⚠️ Un PRÉDICAT sur la cible exacte, jamais un motif : `waitForURL(/\/disputes\//)` rend la
    // main immédiatement quand l’URL courante matche déjà (leçon FX-ROW) — or on VIENT de
    // `/admin/disputes`, qui contient le mot.
    const reachedFile =
      settleRowFound &&
      (await page
        .waitForURL((url) => url.pathname === `/disputes/${toSettle.disputeId}`, { timeout: 10000 })
        .then(() => true)
        .catch(() => false));

    /**
     * ⚠️ LE COMPTE DU RUN EST À LA FOIS ADMIN **ET** PARTIE PRENANTE (c'est lui qui a ouvert le
     * créneau), donc cette page porte DEUX formulaires : celui de dépôt de preuve d'`EvidenceForm`
     * et celui d'arbitrage. C'est un état parfaitement légitime — un admin reste un joueur
     * ordinaire — mais il rend `form textarea` AMBIGU : le premier jet de ce scénario est sorti en
     * **exit 2** dessus (« strict mode violation … resolved to 2 elements »). Les sélecteurs
     * visent donc le champ par son `name`, jamais par sa forme.
     */
    const outcomes = main.locator('form input[type="radio"]');
    const outcomesShown = await appears(outcomes.first());
    const outcomeCount = outcomesShown ? await outcomes.count() : 0;
    const evidenceStillOffered = await main.locator('textarea[name="message"]').count();
    // Les issues NOMMENT les camps : « side_0_wins » ne veut rien dire pour un lecteur. Le nom
    // vient de `sideName`, la règle partagée — et side 0 est le CRÉATEUR du créneau, donc `user`.
    const namedWinner = await main.locator(`text=${user.pseudo} wins`).count();
    const rawEnum = await main.locator('text=side_0_wins').count();
    step(
      'A8',
      reachedFile &&
        outcomeCount === 3 &&
        namedWinner === 1 &&
        rawEnum === 0 &&
        evidenceStillOffered === 1,
      `file -> dossier : arrivée sur /disputes/${toSettle.disputeId} ${reachedFile}, ${outcomeCount} issues offertes (3 attendues), issue qui NOMME le camp ${namedWinner} (1), enum brut à l’écran ${rawEnum} (0), et le formulaire de PREUVE toujours offert ${evidenceStillOffered} (1 — ce compte est admin ET partie prenante : le panneau d’arbitrage AJOUTE, il ne remplace rien)`,
    );

    setPhase('7b. arbitrage confirmé : verdict, annonce, focus rendu');
    const NOTE = 'The scoreboard in the thread settles it for the first camp.';
    await main.locator('input[value="side_0_wins"]').check();
    await main.locator('textarea[name="notes"]').fill(NOTE);
    await main.locator('button:has-text("Settle this dispute")').click();

    const dialog = page.locator('dialog[open]');
    const dialogShown = await appears(dialog);
    if (dialogShown) await dialog.getByRole('button', { name: 'Settle it', exact: true }).click();

    // ⚠️ La région live est MONTÉE EN PERMANENCE : attendre sa présence n’attend rien, on lirait
    // du vide ou l’annonce précédente. On attend le TEXTE (invariant #11).
    const announced = await awaitAnnouncement('Dispute settled');
    // ⚠️ Et le focus arrive APRÈS l’annonce : `focusLanding()` est un instantané, sans cette
    // attente il lirait `<body>` et le check rougirait sur une application correcte.
    await awaitFocusRestored();
    const landing = await focusLanding();

    const verdict = await main.locator('text=Settled by an admin').count();
    const noteShown = await main.locator(`text=${NOTE}`).count();
    const leftoverControls = await main.locator('form input[type="radio"]').count();
    step(
      'A9',
      dialogShown &&
        announced &&
        landing.tag === 'H1' &&
        verdict === 1 &&
        noteShown === 1 &&
        leftoverControls === 0,
      `arbitrage : confirmation demandée ${dialogShown}, annonce « Dispute settled » ${announced}, focus rendu sur <${landing.tag}> (H1 attendu — le panneau disparaît sous l’utilisateur, FX-FOCUS), « Settled by an admin » ${verdict} (1), note d’arbitre ${noteShown} (1), contrôles restants ${leftoverControls} (0 — ré-arbitrer répondrait 409)`,
    );

    // ------------------------------------------- §8 invalidation croisée : la file et le badge
    setPhase('8. après arbitrage : la ligne quitte la file et le badge décroît');
    const queueAfter = await api(user, '/disputes').then((r) => r.json());
    await page.goto(`${ORIGIN}/admin/disputes`, { waitUntil: 'networkidle' });
    await appears(main.locator('h1:has-text("Disputes to settle")'));
    const goneRow = await main.locator(`a[href="/disputes/${toSettle.disputeId}"]`).count();
    const stillThere = await main.locator(`a[href="/disputes/${toLeaveOpen.disputeId}"]`).count();
    const badgeAfter = await readBadge();
    const expectedAfter = `${queueAfter.disputes.length} open dispute${queueAfter.disputes.length === 1 ? '' : 's'}`;
    step(
      'A10',
      goneRow === 0 &&
        stillThere === 1 &&
        queueAfter.disputes.length === openBefore.length - 1 &&
        badgeAfter === expectedAfter,
      `dossier arbitré retiré de la file ${goneRow === 0}, l’autre dispute jetable toujours listée ${stillThere === 1}, API ${queueAfter.disputes.length} (${openBefore.length - 1} attendu), badge « ${badgeAfter || '—'} » (« ${expectedAfter} » attendu — l’invalidation croisée doit décrémenter le rail, pas seulement la page)`,
    );

    // ------------------------------------------------------------------ §9 largeur contrainte
    setPhase('9. 375 px : rien ne déborde');
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`${ORIGIN}/admin/disputes`, { waitUntil: 'networkidle' });
    const narrowOpened = await appears(main.locator('h1:has-text("Disputes to settle")'));
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // 🚨 LA LEÇON F-HOME : un conteneur qui CLIPPE ne déborde JAMAIS, donc mesurer le document
    // seul serait vert par construction. On mesure aussi LA LIGNE, qui porte cinq éléments.
    const rowOverflow = narrowOpened
      ? await main
          .locator('ul[aria-label="Disputes to settle"] > li a')
          .first()
          .evaluate((el) => el.scrollWidth - el.clientWidth)
      : -1;
    step(
      'A11',
      narrowOpened && docOverflow <= 0 && rowOverflow <= 0,
      `375 px : page rendue ${narrowOpened}, document ${docOverflow} px (≤ 0), ligne RENDUE ${rowOverflow} px (≤ 0)`,
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    // ------------------------------- §10 le NÉGATIF : un participant NON-admin n’arbitre pas
    /**
     * 🔑 SUR UNE DISPUTE ENCORE OUVERTE, ET C’EST TOUT L’INTÉRÊT. Rejouer le négatif sur le
     * dossier déjà arbitré l’aurait rendu vert pour la mauvaise raison (« le dossier est clos »)
     * au lieu de la bonne (« ce compte n’arbitre pas ») — il serait resté vert le jour où le
     * panneau cesserait d’être gardé par `isAdmin`.
     *
     * ⚠️ Bascule de compte : `/login` REDIRIGE vers `/home` tant qu’une session existe, donc
     * `login()` expirerait sur un `#email` introuvable — soit un exit 2 au lieu d’un rouge.
     */
    await page.context().clearCookies();
    await login(foe);

    setPhase('10. participant NON-admin sur un dossier ouvert : aucun contrôle d’arbitrage');
    await page.goto(`${ORIGIN}/disputes/${toLeaveOpen.disputeId}`, { waitUntil: 'networkidle' });
    const readerOpened = await appears(main.locator('h1'));
    // LES DEUX FACES : « 0 contrôle » serait vert même si le dossier entier avait cessé de se
    // rendre. Le fil de preuves, lui, DOIT être là — la lecture est un droit du participant.
    const readerClaims = await main.locator('ul[aria-label="Reported results"] > li').count();
    const readerOutcomes = await main.locator('form input[type="radio"]').count();
    const readerSettle = await main.locator('button:has-text("Settle this dispute")').count();
    const readerTab = await adminTab.count();
    step(
      'A12',
      readerOpened &&
        readerClaims === 2 &&
        readerOutcomes === 0 &&
        readerSettle === 0 &&
        readerTab === 0,
      `participant non-admin : dossier rendu ${readerOpened} avec ses ${readerClaims} déclarations (2 — il LIT) ; issues d’arbitrage ${readerOutcomes} (0), bouton d’arbitrage ${readerSettle} (0), onglet Arbitration ${readerTab} (0) — il n’ARBITRE pas`,
    );
  } finally {
    // ------------------------------------------------------------------------- §11 teardown
    /**
     * Exécuté MÊME si un check a échoué.
     *
     * 🚨🚨 `is_admin = false` EN PREMIER ET AVANT TOUT LE RESTE. Un flag laissé en base ferait
     * 7 liens dans le rail et rendrait `f-nav` ROUGE (il assert exactement 6 libellés), sur un
     * scénario sans aucun rapport. C’est le piège n°1 de ce ticket, et le compte du run n’est pas
     * garanti d’être supprimé derrière (`DELETE /users/me` refuse un compte engagé dans un match).
     */
    setPhase('11. teardown : is_admin remis à false, matchs jetables effacés');
    // ⚠️ La page est ENCORE OUVERTE ici (le runner ne ferme le navigateur qu’après `run()`) : on
    // la vide avant de supprimer quoi que ce soit, sinon une invalidation en vol refetche un
    // dossier disparu et écrit un 404 dans la console, imputé à cette phase de nettoyage.
    await page.goto('about:blank').catch(() => {});

    let adminCleared = false;
    try {
      sql(`update users set is_admin = false where id = '${myId}';`);
      adminCleared = true;
    } catch (err) {
      // Rendu ROUGE et non avalé : c’est la seule fuite de ce scénario qui casse un AUTRE fichier.
      step('A13', false, `🚨 is_admin NON remis à false pour ${myId} : ${err.message}`);
    }

    if (adminCleared) {
      try {
        let leftOwn = '0';
        if (ownMatchIds.length > 0) {
          const ids = ownMatchIds.map((id) => `'${id}'`).join(', ');
          // `cancelled` + `winner_side_id = null` d’abord : c’est ce qui rend les comptes
          // supprimables par `deleteAuditUser()` (`ENGAGING_STATUSES`), et
          // `matches.winner_side_id` -> `match_sides.id` est une référence CIRCULAIRE qu’il faut
          // casser avant le delete. Puis les notifications, qui n’ont AUCUNE FK vers `matches`.
          sql(`update matches set status = 'cancelled', winner_side_id = null where id in (${ids});`);
          sql(`delete from notifications where (data->>'matchId')::uuid in (${ids});`);
          sql(`delete from matches where id in (${ids});`);
          leftOwn = sql(
            `select (select count(*) from matches where id in (${ids}))
                  + (select count(*) from disputes where match_id in (${ids}))
                  + (select count(*) from notifications where (data->>'matchId')::uuid in (${ids}));`,
          );
        }
        const flag = sql(`select is_admin from users where id = '${myId}';`);
        step(
          'A13',
          leftOwn === '0' && flag !== 't',
          `teardown : is_admin = « ${flag || 'compte déjà supprimé'} » (jamais « t » — sinon f-nav rougit), ${leftOwn} ligne(s) jetable(s) résiduelle(s) (0 attendu)`,
        );
      } catch (err) {
        // ⚠️ Une exception de teardown ne doit JAMAIS écraser celle qui a interrompu le run : le
        // rapport afficherait « SQL refusé… » à la place de la vraie cause. On la rend visible en
        // ROUGE — donc en exit 1, imputable — sans la laisser remonter.
        step('A13', false, `teardown interrompu APRÈS le retrait du flag admin : ${err.message}`);
      }
    }
  }
}
