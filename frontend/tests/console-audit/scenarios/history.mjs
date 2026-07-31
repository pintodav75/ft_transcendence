/**
 * `/history` — [F-HIST] : tous mes matchs, tous jeux et tous ladders confondus.
 *
 * La seule vue transversale de l'app : avant elle, savoir ce qu'on avait joué demandait de
 * visiter une page par équipe ET un `/solo/$ladderId` par ladder. Ce que ce scénario garde :
 *
 *   - **la section « Matches on the clock »**, qui est la vraie valeur de la page : rien d'autre ne
 *     regroupe les `awaiting_confirmation` / `disputed`, et le job d'auto-confirmation les
 *     ferme à **24 h** — ne pas les voir coûte des matchs. Elle lit l'historique COMPLET, donc
 *     un filtre ne doit jamais pouvoir la vider ;
 *   - **la colonne Ladder est OPT-IN** : elle apparaît sur `/history` (les lignes viennent de
 *     ladders différents, la table serait illisible sans elle) et **doit rester absente** de
 *     l'historique solo, dont le DOM ne bouge pas d'un nœud. Les deux faces sont vérifiées sur
 *     le même run — un check qui ne regarderait que `/history` resterait vert le jour où la
 *     colonne se mettrait à s'afficher partout ;
 *   - **les filtres sont 100 % côté client** : la route rend TOUT en un appel, donc changer un
 *     `<select>` ne doit émettre **aucune** requête ;
 *   - **les options sont dérivées de la DONNÉE, jamais des enums du contrat** (piège [F-MM]) :
 *     le contrat connaît 4 formats, l'écran n'en propose que ceux qui existent dans mes matchs ;
 *   - les deux états vides, qui ne disent pas la même chose : « tu n'as jamais joué » (avec une
 *     porte vers `/matchmaking`) et « tes filtres ne laissent rien passer ».
 *
 * ⚠️ CE SCÉNARIO NE DÉPEND PAS DU SEED : il fabrique ses deux comptes jetables et ses quatre
 * matchs. Seuls les ladders **chess 1v1** et **rl 1v1** sont attendus en base — ils viennent
 * des migrations (`0009`), pas du seed. Le choix de DEUX jeux est délibéré : c'est ce qui rend
 * le filtre Jeu et la colonne Ladder observables sur un run.
 *
 * ⚠️ POURQUOI CE SCÉNARIO SORT DU NAVIGATEUR. Pour obtenir un `awaiting_confirmation` et un
 * `completed` il faut soumettre un score, or `POST /matches/:id/result` exige
 * `now() >= scheduled_at` tandis que `POST /matches` exige un `scheduledAt` **futur** : aucune
 * séquence HTTP ne satisfait les deux. On recule `scheduled_at` en SQL, comme
 * `match-result.mjs` et `backend/tests/test_matches_result.py`. `sql()` sert à **forcer un
 * état**, jamais à constater un comportement — le comportement est lu à l'écran.
 *
 * ⚠️ TEARDOWN OBLIGATOIRE, trois pièges déjà payés (hérités de `match-result.mjs`) :
 *   1. `DELETE /users/me` répond 409 `engaged_in_match` tant qu'un match `pending` /
 *      `in_progress` / `awaiting_confirmation` / `disputed` engage le compte ;
 *   2. `matches.winner_side_id` -> `match_sides.id` est une référence **circulaire** : sur un
 *      match `completed` il faut la casser avant de supprimer la ligne ;
 *   3. les notifications n'ont **aucune FK** vers `matches` : sans purge elles pointeraient
 *      dans le vide (et `dispute_needs_admin` vise de VRAIS comptes admin de la base de dev).
 */
import { assertUuid } from '../sql.mjs';

export const name = 'history';
export const surface =
  '/history — mes matchs tous ladders confondus : section « à traiter », colonne Ladder, filtres client (F-HIST)';

/** Providers exigés par les deux jeux 1v1 (`games.required_provider`, migration 0008). */
const CHESS_PROVIDER = 'chess_com';
const EPIC_PROVIDER = 'epic';

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
 * Un coup d'envoi VALIDE côté serveur : aligné sur le quart (`:00/:15/:30/:45`), secondes et
 * ms à zéro, et à plus de 15 minutes — d'où l'arrondi AU QUART SUPÉRIEUR, le même que
 * `future()` dans `backend/tests/helpers.py`.
 */
function futureQuarter(hoursAhead) {
  const at = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  at.setUTCSeconds(0, 0);
  at.setUTCMinutes(at.getUTCMinutes() + ((15 - (at.getUTCMinutes() % 15)) % 15));
  return at.toISOString();
}

/** Libellés des `<option>` d'un `<select>`, dans l'ordre du DOM. */
const optionsOf = (select) =>
  select
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()))
    .catch(() => []);

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
   * la source de vérité contre laquelle on compare l'écran ensuite.
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
  const historyRegion = main.getByRole('region', { name: /Match history/ });
  const headersOf = (region) =>
    region
      .locator('thead th')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()))
      .catch(() => []);

  // ------------------------------------------------------- §1 l'état vide, GRATUIT
  // Fait EN PREMIER parce que le compte du run vient de naître : il n'a aucun match, donc
  // l'état vide est là sans rien fabriquer. Après la mise en place il faudrait un 3ᵉ compte
  // jetable (et un créneau de plus dans le quota de `register`) pour le revoir.
  setPhase('1. compte neuf : l’état vide ouvre une porte, il ne dit pas juste « aucun match »');
  await page.goto(`${ORIGIN}/history`, { waitUntil: 'networkidle' });
  const emptyTitle = await appears(main.getByRole('heading', { level: 1, name: 'My matches' }));
  // ⚠️ Compter avant de lire : `getAttribute()` sur un locator vide LÈVE -> exit 2
  // (« harnais en échec ») au lieu d'un rouge imputable au ticket.
  const wayIn = main.getByRole('link', { name: 'Find a match' });
  const wayInCount = await wayIn.count();
  const wayInHref = wayInCount === 1 ? await wayIn.getAttribute('href') : null;
  // Les filtres n'ont rien à filtrer : quatre contrôles à une option chacun seraient l'élément
  // le plus bruyant d'une page vide.
  const emptyFilters = await main.locator('select').count();
  const emptyTables = await main.locator('table').count();
  step(
    'H1',
    emptyTitle && wayInCount === 1 && wayInHref === '/matchmaking' && emptyFilters === 0 && emptyTables === 0,
    `titre rendu : ${emptyTitle}, porte de sortie « Find a match » : ${wayInCount} (1 attendue) vers « ${wayInHref ?? '—aucune—'} » (/matchmaking attendu), sélecteurs de filtre : ${emptyFilters} (0 attendu), tableau : ${emptyTables} (0 attendu)`,
  );

  // ⚠️ Invariant #11 : EXACTEMENT UNE région live par écran — ni zéro, ni deux. Deux régions se
  // disputent la lecture et un sélecteur `[role=status]` en `.first()` prend la première venue ;
  // zéro laisserait les filtres muets (voir H12b). Elle est montée en PERMANENCE et vide : une
  // région insérée en même temps que son texte n'est pas annoncée de façon fiable.
  const liveRegions = await main.locator('[role="status"]').count();
  step(
    'H2',
    liveRegions === 1,
    `régions live \`role="status"\` dans <main> : ${liveRegions} (exactement 1 attendue — celle des filtres, montée vide dès le premier rendu)`,
  );

  // --------------------------------------------------- §0 mise en place (API directe)
  setPhase('0. mise en place (API directe) : 2 jeux, 4 matchs, 4 statuts différents');

  const foe = await createUser();
  const link = (as, provider) =>
    api(as, '/users/me/external-accounts', {
      method: 'POST',
      body: JSON.stringify({ provider, externalId: `AUDIT-${provider}-${as.stamp}` }),
    });

  // §5.1 — sans compte lié, `validateSide()` refuse le camp en 400 dès la création du créneau.
  const linked = await Promise.all([
    link(user, CHESS_PROVIDER),
    link(user, EPIC_PROVIDER),
    link(foe, CHESS_PROVIDER),
  ]);
  step(
    'H3',
    linked.every((res) => res.status === 201),
    `comptes externes liés -> HTTP ${linked.map((r) => r.status).join('/')} (201/201/201 attendus : chess.com + Epic pour moi, chess.com pour l’adversaire)`,
  );

  // ⚠️ Le statut se lit AVANT le corps : sur un 429 (quota global par IP) `json()` ne rend
  // aucune clé `ladders` et `.find()` lèverait un TypeError opaque.
  const laddersRes = await api(user, '/ladders');
  if (!laddersRes.ok) {
    throw new Error(`GET /ladders -> ${laddersRes.status} : ${await laddersRes.text()}`);
  }
  const { ladders } = await laddersRes.json();
  // Trouvés par leur DONNÉE (jeu + format), jamais par un uuid en dur : les ids viennent des
  // migrations et diffèrent d'une base à l'autre.
  const chess = ladders.find((l) => l.gameId === 'chess' && l.format === '1v1');
  const rocket = ladders.find((l) => l.gameId === 'rl' && l.format === '1v1');
  if (!chess || !rocket) {
    // Erreur de HARNAIS (exit 2), pas un check rouge : sans ces ladders tout ce qui suit
    // mesurerait le vide.
    throw new Error(
      `ladders 1v1 manquants — chess: ${Boolean(chess)}, rl: ${Boolean(rocket)} (${ladders.length} vus)`,
    );
  }

  const openSlot = async (ladderId, hoursAhead) => {
    const created = await api(user, '/matches', {
      method: 'POST',
      body: JSON.stringify({ ladderId, scheduledAt: futureQuarter(hoursAhead) }),
    });
    if (created.status !== 201) {
      throw new Error(`POST /matches -> ${created.status} : ${await created.text()}`);
    }
    // Interpolé en SQL au teardown : on refuse tout ce qui n'est pas un uuid.
    return assertUuid(await created.json().then(({ match }) => match.id), 'matchId');
  };

  const matchIds = [];
  try {
    // Quatre créneaux à des heures largement disjointes (§5.2 compare des fenêtres de
    // ±30 min autour de `scheduled_at`, en inégalités STRICTES).
    const pendingChess = await openSlot(chess.id, 3);
    const awaiting = await openSlot(chess.id, 7);
    const pendingRocket = await openSlot(rocket.id, 11);
    const completed = await openSlot(chess.id, 15);
    matchIds.push(pendingChess, awaiting, pendingRocket, completed);

    // Les deux matchs qui doivent recevoir un score sont acceptés AVANT tout backdate : les
    // gardes de chevauchement se jouent à cet instant, sur les heures futures.
    for (const id of [awaiting, completed]) {
      const accepted = await api(foe, `/matches/${id}/accept`, { method: 'POST' });
      if (accepted.status !== 200) {
        throw new Error(`accept de ${id} -> ${accepted.status} : ${await accepted.text()}`);
      }
    }

    // 🚨 La SEULE opération que l'API interdit : `POST /matches` veut un futur,
    // `POST /matches/:id/result` veut un passé.
    sql(`update matches set scheduled_at = now() - interval '2 hours' where id = '${awaiting}';`);
    sql(`update matches set scheduled_at = now() - interval '5 hours' where id = '${completed}';`);

    const sidesOf = async (id) => {
      const res = await api(user, `/matches/${id}`);
      // ⚠️ Sur un non-2xx la réponse n'a pas de clé `sides` et la lecture lèverait -> exit 2.
      if (!res.ok) throw new Error(`GET /matches/${id} -> ${res.status}`);
      const { sides } = await res.json();
      return sides;
    };

    // (a) L'ADVERSAIRE soumet seul -> `awaiting_confirmation` : c'est MOI qu'on attend.
    const awaitingSides = await sidesOf(awaiting);
    const foeSide = awaitingSides.find((side) =>
      side.players.some((player) => player.pseudo === foe.pseudo),
    );
    const foeClaim = await api(foe, `/matches/${awaiting}/result`, {
      method: 'POST',
      body: JSON.stringify({
        winnerSideId: assertUuid(foeSide?.id, 'sideId adversaire'),
        scoreSelf: 2,
        scoreOpponent: 0,
      }),
    });

    // (b) Les DEUX camps soumettent le même verdict -> `completed`, et j'y gagne un résultat
    //     (c'est lui qui peuple le filtre « Result »).
    const completedSides = await sidesOf(completed);
    const mySide = completedSides.find((side) =>
      side.players.some((player) => player.pseudo === user.pseudo),
    );
    const winnerSideId = assertUuid(mySide?.id, 'sideId joueur');
    const mine = await api(user, `/matches/${completed}/result`, {
      method: 'POST',
      body: JSON.stringify({ winnerSideId, scoreSelf: 2, scoreOpponent: 0 }),
    });
    const mirror = await api(foe, `/matches/${completed}/result`, {
      method: 'POST',
      // Le miroir EXACT vu de l'autre camp : même vainqueur, scores croisés.
      body: JSON.stringify({ winnerSideId, scoreSelf: 0, scoreOpponent: 2 }),
    });
    step(
      'H4',
      foeClaim.status === 200 && mine.status === 200 && mirror.status === 200,
      `soumissions -> HTTP ${foeClaim.status}/${mine.status}/${mirror.status} (200×3 attendus) : 1 match laissé en attente de MA confirmation, 1 match clos d’accord`,
    );

    // ------------------------------------------------ §2 la page, un seul appel réseau
    setPhase('2. /history : un seul GET /matches/me, SANS aucun paramètre');
    // 🔑 La route rend TOUT en un appel — pas de curseur, pas de pagination. `?ladderId=`
    // existe mais serait exactement le contraire de ce que cette page demande (il est
    // load-bearing sur `/solo/$ladderId`, dont les compteurs de créneaux miroitent des
    // compteurs serveur scopés à UN ladder).
    const historyCalls = [];
    const spy = (req) => {
      if (req.url().includes('/api/matches/me')) historyCalls.push(req.url());
    };
    page.on('request', spy);
    await page.goto(`${ORIGIN}/history`, { waitUntil: 'networkidle' });
    await appears(historyRegion);
    page.off('request', spy);
    const queryless = historyCalls.every((url) => !url.includes('?'));
    step(
      'H5',
      historyCalls.length === 1 && queryless,
      `GET /matches/me au chargement : ${historyCalls.length} (1 attendu), sans query : ${queryless} (${historyCalls.map((u) => u.replace(ORIGIN, '')).join(', ') || '—aucun—'})`,
    );

    const rows = historyRegion.locator('tbody tr');
    const rowCount = await rows.count();
    step(
      'H6',
      rowCount === 4,
      `lignes rendues : ${rowCount} (4 attendues — 2 créneaux ouverts, 1 en attente de confirmation, 1 terminé, sur DEUX jeux)`,
    );

    // ---------------------------------------- §3 « Matches on the clock », la valeur de la page
    setPhase('3. la section « Matches on the clock » et son lien vers la fiche');
    const attention = main.getByRole('list', { name: 'Matches on the clock' });
    const attentionShown = await appears(attention);
    const attentionLinks = attention.getByRole('link');
    const attentionCount = await attentionLinks.count();
    // ⚠️ Compter avant de lire : `getAttribute()` sur un locator vide LÈVE -> exit 2.
    const attentionHref = attentionCount === 1 ? await attentionLinks.getAttribute('href') : null;
    step(
      'H7',
      attentionShown && attentionCount === 1 && attentionHref === `/matches/${awaiting}`,
      `entrées « à traiter » : ${attentionCount} (1 attendue — le match en attente de MA confirmation ; le terminé et les créneaux ouverts n’y sont pas) vers « ${attentionHref ?? '—aucune—'} »`,
    );

    // ---------------------------------- §4 la colonne Ladder : présente ICI, absente AILLEURS
    setPhase('4. colonne Ladder — opt-in sur /history, absente de l’historique solo');
    const historyHeaders = await headersOf(historyRegion);
    // Les DEUX jeux sont nommés dans la colonne, depuis les caches `GET /games` / `GET /ladders`
    // (aucune requête par ligne) : sans ça la table mélangerait des ladders sans le dire.
    const ladderCells = await historyRegion
      .locator('tbody tr td:nth-child(2)')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()))
      .catch(() => []);
    const namesChess = ladderCells.some((text) => text.startsWith('Chess'));
    const namesRocket = ladderCells.some((text) => text.startsWith('Rocket League'));
    const namesFormat = ladderCells.every((text) => text.endsWith('1v1'));
    step(
      'H8',
      historyHeaders[1] === 'Ladder' && namesChess && namesRocket && namesFormat,
      `en-têtes de /history : ${JSON.stringify(historyHeaders)} (« Ladder » en 2ᵉ attendu) ; cellules : ${JSON.stringify(ladderCells)} — nomme Chess : ${namesChess}, Rocket League : ${namesRocket}, format sur chaque ligne : ${namesFormat}`,
    );

    // 🔑 LA FACE QUI COMPTE VRAIMENT. La colonne est dérivée de la donnée (`row.ladder !== undefined`)
    // exactement comme `showLineup` : les deux écrans qui consommaient déjà cette table sont
    // scopés à UN ladder et ne la demandent pas, donc leur DOM ne doit pas bouger d’un nœud.
    // Sans ce check, rendre la colonne partout resterait vert.
    await page.goto(`${ORIGIN}/solo/${chess.id}`, { waitUntil: 'networkidle' });
    await main.getByRole('tab', { name: 'Matches' }).click();
    const soloShown = await appears(historyRegion);
    const soloHeaders = await headersOf(historyRegion);
    step(
      'H9',
      soloShown && soloHeaders.length > 0 && !soloHeaders.includes('Ladder'),
      `en-têtes de l’historique solo : ${JSON.stringify(soloHeaders)} (aucune colonne « Ladder » attendue — la page est déjà scopée à un ladder)`,
    );

    // ------------------------------- §5 les options des filtres viennent de la DONNÉE
    setPhase('5. options dérivées des matchs présents, jamais des enums du contrat');
    await page.goto(`${ORIGIN}/history`, { waitUntil: 'networkidle' });
    await appears(historyRegion);
    const gameSelect = main.getByLabel('Game');
    const formatSelect = main.getByLabel('Format');
    const resultSelect = main.getByLabel('Result');
    const gameOptions = await optionsOf(gameSelect);
    const formatOptions = await optionsOf(formatSelect);
    const resultOptions = await optionsOf(resultSelect);
    step(
      'H10',
      // 🚨 LE PIÈGE [F-MM] : le contrat connaît QUATRE formats et l'app CINQ jeux. Mes matchs
      // n'en contiennent que deux jeux et un seul format, donc c'est tout ce qui doit être
      // offert — sinon on propose une combinaison qui rend un tableau vide, et le lecteur ne
      // peut pas distinguer « je n'ai pas joué ça » de « la page est cassée ».
      gameOptions.length === 3 &&
        gameOptions.includes('Chess') &&
        gameOptions.includes('Rocket League') &&
        formatOptions.length === 2 &&
        formatOptions.includes('1v1') &&
        resultOptions.length === 2 &&
        resultOptions.includes('Wins'),
      `Jeu : ${JSON.stringify(gameOptions)} (3 attendues) · Format : ${JSON.stringify(formatOptions)} (2 attendues — le contrat en connaît 4) · Résultat : ${JSON.stringify(resultOptions)} (2 attendues — aucune défaite dans l’historique)`,
    );

    // ------------------------------------- §6 filtrer ne redemande RIEN au serveur
    setPhase('6. filtrer est 100 % côté client : zéro requête');
    const isHistoryCall = (url) => url.includes('/api/matches/me');
    const filterCalls = await countRequests(async () => {
      await gameSelect.selectOption('rl');
      await page.waitForTimeout(500);
    }, isHistoryCall);
    const filteredRows = await historyRegion.locator('tbody tr').count();
    // ⚠️ LE CONTRÔLE POSITIF, et il n'est pas décoratif : « 0 requête » est aussi ce que
    // mesurerait un filtre qui ne matche RIEN (route renommée, `/api` oublié). Le MÊME
    // prédicat est donc rejoué sur un rechargement, où il doit compter la requête de la page.
    // Sans lui, H11 serait vert par construction — le défaut trouvé trois fois sur FX-ROW.
    const reloadCalls = await countRequests(async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await appears(historyRegion);
    }, isHistoryCall);
    step(
      'H11',
      filterCalls === 0 && filteredRows === 1 && reloadCalls > 0,
      `GET /matches/me après changement de filtre : ${filterCalls} (0 attendu — la route a déjà tout rendu) ; lignes restantes : ${filteredRows} (1 attendue — le seul créneau Rocket League) ; le MÊME prédicat sur un rechargement : ${reloadCalls} (> 0 attendu — c’est ce qui prouve qu’il matche vraiment quelque chose)`,
    );

    // Le rechargement a remis les filtres à zéro (l'état est local au composant) : on rétablit
    // la sélection dont la phase suivante a besoin, sinon elle partirait d'un tableau complet.
    await gameSelect.selectOption('rl');

    // ------------------------------ §7 un filtrage qui ne rend rien le DIT, et se défait
    setPhase('7. filtres vides : c’est bien LES FILTRES qui vident la liste');
    await resultSelect.selectOption('win');
    const noResultNotice = await appears(main.locator('text=None of your 4 matches match these filters'));
    const tablesLeft = await main.locator('table').count();
    const clearButton = main.getByRole('button', { name: 'Clear the filters' });
    const clearCount = await clearButton.count();
    step(
      'H12',
      noResultNotice && tablesLeft === 0 && clearCount === 1,
      `avis « None of your 4 matches match these filters » : ${noResultNotice}, tableau résiduel : ${tablesLeft} (0 attendu), bouton « Clear the filters » : ${clearCount} (1 attendu) — l’écran dit que ce sont les FILTRES qui vident, pas l’historique`,
    );

    // ⚠️ L'ANNONCE EST LE SEUL RETOUR QU'UN LECTEUR D'ÉCRAN OBTIENT ICI : changer un `<select>`
    // lui dit l'option choisie et RIEN de son effet, alors que les quatre contrôles de cet
    // écran n'ont pas d'autre effet que de refaire la table (WCAG 4.1.3). ⚠️ On attend le
    // TEXTE, jamais la présence de la région : elle est montée en permanence, donc un
    // `waitFor()` sur `[role=status]` rendrait la main tout de suite et lirait du vide ou
    // l'annonce précédente (invariant #11). `awaitAnnouncement` fait exactement ça.
    const heardEmpty = await awaitAnnouncement('0 of 4 matches shown');
    step(
      'H12b',
      heardEmpty,
      `annonce « 0 of 4 matches shown » après le filtre qui vide la table : ${heardEmpty} (la ligne visible dit la même chose, les deux lisent \`historySummary\`)`,
    );

    // 🔑 LU MAINTENANT, PENDANT QUE LE FILTRE VIDE LE TABLEAU — et c'est tout le check.
    // ⚠️ La première version le lisait APRÈS « Clear the filters », donc sur un écran non
    // filtré : elle est restée VERTE sur un code volontairement cassé (section branchée sur la
    // liste filtrée). Un check qui mesure après avoir défait la condition qu'il teste ne garde
    // rien. La section doit être INSENSIBLE aux filtres : c'est ce qui fait qu'on ne peut pas
    // rater un match sur lequel court une échéance de 24 h.
    const attentionWhileFiltered = await attention.getByRole('link').count();

    if (clearCount === 1) await clearButton.click();
    const restored = await appears(historyRegion);
    const restoredRows = restored ? await historyRegion.locator('tbody tr').count() : 0;
    step(
      'H13',
      restoredRows === 4 && attentionWhileFiltered === 1,
      `entrées « à traiter » PENDANT le filtrage qui vide le tableau : ${attentionWhileFiltered} (1 attendue — la section lit l’historique COMPLET) ; après « Clear the filters » : ${restoredRows} ligne(s) (4 attendues)`,
    );

    // -------------------------------------------- §8 « Still in play » écarte le terminé
    setPhase('8. « Still in play » : les créneaux et les matchs en cours, pas les terminés');
    // ⚠️ ON FABRIQUE UN `cancelled` ICI, ET C'EST LE POINT DU CHECK. La fixture n'en contenait
    // aucun : le critère d'acceptation « les annulés restent listés » n'était gardé par RIEN,
    // et retirer `cancelled` de l'exclusion d'`isOngoing` (`lib/history.ts`) serait resté vert.
    // `DELETE /matches/{id}` passe le slot à `cancelled` SANS effacer la ligne — c'est
    // exactement l'état que la page doit continuer de lister par défaut, et écarter derrière
    // le filtre. Fait au §8 parce que c'est le seul check qui le lit : plus tôt, ça
    // déplacerait les comptes de H11 (« le seul créneau Rocket League ») et de H13.
    const withdrawn = await api(user, `/matches/${pendingRocket}`, { method: 'DELETE' });
    if (!withdrawn.ok) {
      throw new Error(`DELETE /matches/${pendingRocket} -> ${withdrawn.status}`);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await appears(historyRegion);

    const ongoing = main.getByRole('checkbox', { name: 'Still in play' });
    await ongoing.check();
    await page.waitForTimeout(300);
    const ongoingRows = await historyRegion.locator('tbody tr').count();
    await ongoing.uncheck();
    await page.waitForTimeout(300);
    const allRows = await historyRegion.locator('tbody tr').count();
    step(
      'H14',
      ongoingRows === 2 && allRows === 4,
      `« Still in play » coché : ${ongoingRows} ligne(s) (2 attendues — le TERMINÉ et l’ANNULÉ sortent tous les deux) ; décoché : ${allRows} (4 attendues — l’annulé n’est pas effacé, il reste dans l’historique)`,
    );

    // ------------------------------------- §9 chaque ligne ouvre sa fiche (pas de 403)
    setPhase('9. la date ouvre la fiche du match — l’accès clavier de la ligne');
    // `canOpenSheet` est codé `true` : `GET /matches/me` ne rend que MES matchs, donc la garde
    // de `GET /matches/:id` (participant direct OU membre d'une équipe engagée) ne peut pas me
    // refuser. Rien ne le gardait ; un 403 laisserait une ligne rouge en console — motif de
    // rejet. On passe par le lien de la DATE, l'accès clavier et lecteur d'écran (FX-ROW).
    const dateLink = historyRegion.locator('tbody tr').first().locator('td:nth-child(1) a');
    const dateLinkCount = await dateLink.count();
    const sheetHref = dateLinkCount === 1 ? await dateLink.getAttribute('href') : null;
    let sheetOpened = false;
    if (sheetHref) {
      await dateLink.click();
      // ⚠️ Un motif rendrait la main IMMÉDIATEMENT si l'URL courante le satisfaisait déjà : on
      // exige le pathname EXACT de la cible.
      sheetOpened = await page
        .waitForURL((url) => url.pathname === sheetHref, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
    }
    const sheetHeading = sheetOpened ? await appears(main.getByRole('heading', { level: 1 })) : false;
    step(
      'H15',
      dateLinkCount === 1 && sheetOpened && sheetHeading,
      `lien de date sur la 1ʳᵉ ligne : ${dateLinkCount} (1 attendu) -> fiche ouverte = ${sheetOpened}, titre rendu = ${sheetHeading} (un 403 laisserait une ligne rouge en console)`,
    );

    // ------------------------------------------------------------------ §10 375 px
    // 🚨 RÉÉCRIT PAR [FX-TABLE]. Ce check exigeait l'inverse : que la table DÉBORDE dans sa
    // propre boîte à 375 px (426 px hors champ sur cet écran), ce qui était vrai et illisible —
    // l'adversaire et le statut passaient derrière un défilement horizontal. Sous `sm` la table
    // est désormais REMPLACÉE par une liste de cartes, et c'est ce remplacement qu'on garde.
    setPhase('10. /history à 375 px : la table cède la place aux cartes');
    await page.goto(`${ORIGIN}/history`, { waitUntil: 'networkidle' });
    await appears(historyRegion);
    await page.setViewportSize({ width: 375, height: 900 });
    // La bascule lit `matchMedia` en synchrone (pas d'effet, pas de flash), mais React doit
    // tout de même rendre : on attend la LISTE elle-même plutôt qu'un délai arbitraire.
    const cardList = main.getByRole('list', { name: /Match history/ });
    const cardsShown = await appears(cardList);
    const cards = cardsShown ? await cardList.locator('> li').count() : 0;
    // 🚨 UN SEUL ARBRE DANS LE DOM, jamais deux. Un double rendu CSS (`sm:hidden` /
    // `hidden sm:block`) ferait remonter DEUX nœuds à chaque `getByText` — ici, et à 1280 px
    // sur les huit scénarios qui assertent ce tableau. La table doit avoir disparu, pas être
    // masquée : `main.locator('table')` compte aussi ce qui est en `display:none`.
    const tablesAt375 = await main.locator('table').count();
    const regionsAt375 = await main.getByRole('region', { name: /Match history/ }).count();
    // Plus d'en-tête de colonne : un chiffre nu ne veut plus rien dire, chaque valeur porte
    // donc son étiquette (`<dt>`), et la règle produit tient toujours — la date ouvre la fiche.
    const cardLabels = await cardList.locator('dt').evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => node.textContent.trim()))].sort(),
    );
    const cardSheetLinks = await cardList.locator('a[href^="/matches/"]').count();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const labelsExpected = ['Elo', 'Ladder', 'Score'];
    step(
      'H16',
      overflow <= 0 &&
        cards === 4 &&
        tablesAt375 === 0 &&
        regionsAt375 === 0 &&
        cardSheetLinks === 4 &&
        labelsExpected.every((label) => cardLabels.includes(label)),
      `débordement horizontal du DOCUMENT à 375 px : ${overflow}px (≤ 0 attendu) ; cartes rendues : ${cards} (4 attendues), tableau résiduel : ${tablesAt375} (0 attendu — un seul arbre monté), région défilante résiduelle : ${regionsAt375} (0 attendue — plus rien ne déborde), liens vers une fiche : ${cardSheetLinks} (4 attendus), étiquettes : ${JSON.stringify(cardLabels)} (${labelsExpected.join(', ')} attendues)`,
    );

    // ------------------------------------------------------- §10b retour à 1280 px
    // 🔑 LA LARGEUR QUE PERSONNE NE GARDAIT. Seul 375 px était mesuré : le `<span class="sr-only">`
    // de l'en-tête Actions avait déjà élargi le DOCUMENT de 253 px, et rien n'aurait vu la même
    // faute revenir en grand. Le critère est le débordement du DOCUMENT — la table, elle, a le
    // droit de défiler dans sa propre boîte.
    setPhase('10b. /history à 1280 px : la table revient, le document ne déborde pas');
    await page.setViewportSize({ width: 1280, height: 900 });
    const backToTable = await appears(historyRegion);
    const wideRows = backToTable ? await historyRegion.locator('tbody tr').count() : 0;
    const wideCards = await main.getByRole('list', { name: /Match history/ }).count();
    const wideOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    step(
      'H16b',
      backToTable && wideRows === 4 && wideCards === 0 && wideOverflow <= 0,
      `débordement horizontal du DOCUMENT à 1280 px : ${wideOverflow}px (≤ 0 attendu) ; tableau revenu = ${backToTable} avec ${wideRows} ligne(s) (4 attendues), liste de cartes résiduelle : ${wideCards} (0 attendue)`,
    );

    // ------------------------------------- §11 les deux pannes que la doc PROMET de tenir
    // ⚠️ CES DEUX ÉTATS ÉTAIENT REVENDIQUÉS DANS `docs/frontend.md` ET GARDÉS PAR RIEN — c'est
    // exactement le genre d'affirmation qui devient fausse en silence. `page.route` fabrique la
    // panne ; c'est le pendant de `sql.mjs`, certains états ne s'atteignent pas par l'API.
    setPhase('11. GET /matches/me en panne : le Callout remplace la table');
    expectHttp(/\/api\/matches\/me/, 'panne de GET /matches/me provoquée par le scénario');
    await page.route('**/api/matches/me', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal error' }),
      }),
    );
    await page.goto(`${ORIGIN}/history`, { waitUntil: 'networkidle' });
    // ⚠️ ON ATTEND LE MESSAGE, on ne le compte pas à `networkidle` : `retryServerErrorsOnly`
    // réessaie sur un 500, et pendant les réessais l'écran est encore légitimement en
    // chargement. Compter trop tôt rendrait ce check rouge sur un front correct.
    const brokenNotice = await appears(main.getByText('Your match history could not be loaded'), 20000);
    const brokenTables = await main.locator('table').count();
    const brokenFilters = await main.locator('select').count();
    // Le résumé ne doit PAS répéter le Callout : deux phrases pour un seul fait.
    const brokenEcho = await main.getByText('Your history could not be loaded.').count();
    step(
      'H18',
      brokenNotice && brokenTables === 0 && brokenFilters === 0 && brokenEcho === 0,
      `panne de GET /matches/me : Callout d’erreur = ${brokenNotice}, tableau résiduel ${brokenTables} (0 attendu), filtres résiduels ${brokenFilters} (0 attendu), redite du message sous les filtres ${brokenEcho} (0 attendu — le Callout porte déjà le remède)`,
    );
    await page.unroute('**/api/matches/me');

    // 🔑 LE REPLI DU NOM DE LADDER — l'affirmation la plus fragile de la doc : « une ligne dont
    // le ladder est introuvable reste LISIBLE ». `ladderName` et `gameName` ne sont pas dans la
    // réponse, ils viennent des deux caches de référence ; si les deux tombent, la ligne doit
    // se rabattre sur le slug du jeu + le `format` du payload, et jamais rendre « undefined ».
    setPhase('11b. GET /ladders et GET /games en panne : la ligne reste lisible');
    expectHttp(/\/api\/(ladders|games)/, 'panne des données de référence provoquée par le scénario');
    for (const route of ['**/api/ladders', '**/api/games']) {
      await page.route(route, (r) =>
        r.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal error' }),
        }),
      );
    }
    await page.goto(`${ORIGIN}/history`, { waitUntil: 'networkidle' });
    const degradedShown = await appears(historyRegion, 20000);
    const degradedCells = degradedShown
      ? await historyRegion
          .locator('tbody tr td:nth-child(2)')
          .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()))
          .catch(() => [])
      : [];
    // Le SLUG (`chess`, `rl`) remplace le nom du jeu, le format vient du payload et ne bouge
    // pas. Ce qu'on interdit, c'est le mot « undefined » et la cellule vide.
    const readable =
      degradedCells.length === 4 &&
      degradedCells.every((text) => text.includes('1v1') && !text.toLowerCase().includes('undefined'));
    step(
      'H19',
      readable,
      `cellules « Ladder » quand les 2 caches de référence tombent : ${JSON.stringify(degradedCells)} (4 attendues, chacune portant son format et JAMAIS « undefined » — repli sur le slug du jeu)`,
    );
    for (const route of ['**/api/ladders', '**/api/games']) await page.unroute(route);
  } finally {
    // ---------------------------------------------------------------- §11 teardown
    // Exécuté MÊME si un check a échoué : sinon le premier run raté laisserait deux comptes
    // indéracinables derrière lui (un match non terminé engage ses participants), et le suivant
    // hériterait de leur bruit.
    if (matchIds.length > 0) {
      setPhase('11. teardown : les matchs cessent d’engager les deux comptes');
      // ⚠️ La page est ENCORE OUVERTE ici (le runner ne ferme le navigateur qu'après `run()`).
      // On la vide avant de supprimer les matchs : une invalidation en vol ferait refetcher une
      // fiche disparue et écrirait un 404 dans la console, imputé à cette phase de nettoyage.
      await page.goto('about:blank').catch(() => {});
      const ids = matchIds.map((id) => `'${id}'`).join(', ');
      try {
        // 1) `cancelled` est, avec `completed`, l'un des deux seuls statuts hors
        //    `ENGAGING_STATUSES` : c'est ce qui rend les comptes supprimables. Étape
        //    LOAD-BEARING, donc faite en premier.
        //    ⚠️ `winner_side_id` remis à NULL dans le même geste : `matches.winner_side_id` ->
        //    `match_sides.id` et `match_sides.match_id` -> `matches.id` forment une référence
        //    CIRCULAIRE, et le match clos en §0 pointe sur un de ses propres sides.
        sql(`update matches set status = 'cancelled', winner_side_id = null where id in (${ids});`);
        // 2) Les notifications AVANT les matchs : aucune FK vers `matches` (une notif est un
        //    fait passé), donc rien ne les emporterait en cascade.
        sql(`delete from notifications where (data->>'matchId')::uuid in (${ids});`);
        // 3) Puis les matchs. Sides, participants et disputes tombent en CASCADE.
        sql(`delete from matches where id in (${ids});`);
        // Ce check lit la BASE, et c'est légitime ici parce que la base EST le sujet : il garde
        // le teardown, pas un comportement de l'application. Il compte AUSSI ce qui doit tomber
        // en cascade — sur le seul `matches` il ne pourrait pas rougir.
        const left = sql(
          `select (select count(*) from matches where id in (${ids}))
                + (select count(*) from match_sides where match_id in (${ids}))
                + (select count(*) from match_participants where match_side_id in
                     (select id from match_sides where match_id in (${ids})))
                + (select count(*) from notifications where (data->>'matchId')::uuid in (${ids}));`,
        );
        step(
          'H17',
          left === '0',
          `lignes résiduelles (matchs + sides + participants + notifs) : ${left} (0 attendu)`,
        );
      } catch (err) {
        // ⚠️ Une exception de teardown ne doit JAMAIS écraser celle qui a interrompu le run : le
        // rapport afficherait « SQL refusé… » à la place de la vraie cause. On la rend visible en
        // ROUGE — donc en exit 1, imputable — sans la laisser remonter.
        step('H17', false, `teardown interrompu : ${err.message}`);
      }
    }
  }
}
