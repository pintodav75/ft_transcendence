/**
 * `/solo` et `/solo/$ladderId` — [F-SOLO] : liste des ladders 1v1 et dossier de compétiteur.
 *
 * Le pendant solo de `/teams` + `/teams/$teamId`. Ce que ce scénario garde :
 *
 *   - `/solo` liste les ladders qui EXISTENT, pas ceux où je suis classé — un compte NEUF
 *     (celui du run l'est toujours) doit voir des tuiles et pouvoir entrer. C'est l'asymétrie
 *     centrale du ticket : une ligne de `rankings` naît du premier RÉSULTAT, il n'y a aucune
 *     adhésion, donc « mes ladders solo » serait une page vide sans porte d'entrée ;
 *   - `ladderId` malformé -> écran d'erreur **sans aucune requête** (même règle uuid que le
 *     back), uuid inconnu -> 404, et **ladder d'un autre format** -> écran dédié (cas absent
 *     de la carte : `/solo/<id-cs2-5v5>` répond 200, il n'y a donc aucune erreur à hériter) ;
 *   - **AUCUN bouton que l'API refuserait** : sans compte externe lié, `validateSide()` refuse
 *     le camp en 400 (§5.1), donc « Open a slot » ne doit pas exister. C'est le check central
 *     du ticket, et il est doublé de son POSITIF (on lie, il apparaît ; on délie, il repart) —
 *     un check négatif seul serait vert le jour où le bouton cesserait d'être rendu du tout ;
 *   - le cycle complet à la souris : ouvrir un créneau, le voir dans l'historique, l'annuler,
 *     focus rendu ;
 *   - `opponent: null` — les causes 1 et 2 (personne n'a accepté, créneau annulé) rendent un
 *     tiret, la cause 4 (**l'adversaire a supprimé son compte**) rend « Deleted player ».
 *
 * ⚠️ POURQUOI CE SCÉNARIO SORT DU NAVIGATEUR (une seule fois). La cause 4 de `opponent: null`
 * n'est atteignable par aucune séquence HTTP raisonnable : il faudrait qu'un compte parte
 * pendant un match, et `DELETE /users/me` refuse justement en 409 tant qu'un match engage le
 * compte. Or `match_participants.user_id` est en CASCADE depuis [BX-DEL] : supprimer la LIGNE
 * DE PARTICIPANT reproduit EXACTEMENT l'état que laisse une suppression de compte. C'est
 * l'usage sanctionné de `sql()` — forcer un état que l'API interdit, jamais constater un
 * comportement. Le comportement, lui, est lu à l'écran.
 *
 * ⚠️ CE SCÉNARIO NE DÉPEND PAS DU SEED : il fabrique ses deux comptes jetables. Seuls les
 * ladders **chess 1v1** et **rl 1v1** sont attendus en base — ils viennent des migrations.
 * Le choix des deux est délibéré : il me faut un jeu dont je lie le compte (chess) ET un dont
 * je ne le lie pas (rl), pour tenir les deux faces du check central sur un seul run.
 *
 * ⚠️ TEARDOWN OBLIGATOIRE. Le match monté en §9 est `in_progress`, donc il ENGAGE les deux
 * comptes et `DELETE /users/me` les refuserait en 409 `engaged_in_match` — `purgeUserMatches()`
 * du runner ne sait qu'annuler un slot encore `pending`. On force donc le match hors des
 * statuts engageants puis on efface la ligne, **même si un check a échoué**.
 */
import { assertUuid } from '../sql.mjs';

export const name = 'solo';
export const surface =
  '/solo + /solo/$ladderId — ladders 1v1, compte lié, ouverture et annulation de créneau (F-SOLO)';

/** Providers exigés par les deux jeux 1v1 (`games.required_provider`, migration 0008). */
const CHESS_PROVIDER = 'chess_com';
const EPIC_PROVIDER = 'epic';

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

export async function run({
  page,
  setPhase,
  step,
  countRequests,
  expectHttp,
  createUser,
  user,
  ORIGIN,
  sql,
  awaitAnnouncement,
  awaitFocusRestored,
  focusLanding,
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

  const link = (as, provider) =>
    api(as, '/users/me/external-accounts', {
      method: 'POST',
      body: JSON.stringify({ provider, externalId: `AUDIT-${provider}-${as.stamp}` }),
    });
  const unlink = (as, provider) =>
    api(as, `/users/me/external-accounts/${provider}`, { method: 'DELETE' });

  const main = page.locator('main');
  const openSlotButton = main.getByRole('button', { name: 'Open a slot' });

  // ------------------------------------------------------------- §0 mise en place
  setPhase('0. mise en place (API directe) : ladders 1v1 et compte chess.com lié');

  // ⚠️ Le statut se lit AVANT le corps. Sur un 429 (quota global par IP) ou un 500, `json()`
  // ne rend aucune clé `ladders` et `.find()` lèverait un TypeError opaque — le diagnostic
  // soigné juste en dessous ne serait jamais atteint.
  const laddersRes = await api(user, '/ladders');
  if (!laddersRes.ok) {
    throw new Error(`GET /ladders -> ${laddersRes.status} : ${await laddersRes.text()}`);
  }
  const { ladders } = await laddersRes.json();
  // Trouvés par leur DONNÉE (jeu + format), jamais par un uuid en dur : les ids viennent des
  // migrations et diffèrent d'une base à l'autre.
  const chess = ladders.find((l) => l.gameId === 'chess' && l.format === '1v1');
  const rocket = ladders.find((l) => l.gameId === 'rl' && l.format === '1v1');
  // Un ladder d'ÉQUIPE, pour le cas « bon uuid, mauvais format ».
  const teamLadder = ladders.find((l) => l.format !== '1v1');
  if (!chess || !rocket || !teamLadder) {
    // Erreur de HARNAIS (exit 2), pas un check rouge : sans ces ladders, tout ce qui suit
    // mesurerait le vide.
    throw new Error(
      `ladders manquants — chess 1v1: ${Boolean(chess)}, rl 1v1: ${Boolean(rocket)}, ` +
        `ladder d'équipe: ${Boolean(teamLadder)} (${ladders.length} ladder(s) vus)`,
    );
  }

  // §5.1 — chess.com est lié, Epic NE L'EST PAS. C'est cette asymétrie qui porte le check
  // central : deux ladders 1v1, deux réponses opposées, le même écran.
  const linkedChess = await link(user, CHESS_PROVIDER);
  step(
    'S0',
    linkedChess.status === 201,
    `compte ${CHESS_PROVIDER} lié -> HTTP ${linkedChess.status} (201 attendu) ; ${EPIC_PROVIDER} volontairement NON lié`,
  );

  const matchIds = [];
  try {
    // -------------------------------------------------- §1 l'index, pour un compte NEUF
    setPhase('1. /solo : la liste des ladders 1v1 pour un compte qui n’a jamais joué');
    await page.goto(`${ORIGIN}/solo`, { waitUntil: 'networkidle' });
    const indexTitle = await appears(main.locator('h1'));
    // ⚠️ Scopé à `<main>` : le rail gauche est monté sur toute page authentifiée et porte lui
    // aussi des liens — un balayage global compterait ses items (piège vécu sur `ladder-detail`).
    const tiles = main.locator('ul li a[href^="/solo/"]');
    const tileCount = await tiles.count();
    step(
      'S1',
      indexTitle && tileCount === 2,
      `titre rendu : ${indexTitle}, tuiles de ladder 1v1 : ${tileCount} (2 attendues — chess et rl)`,
    );

    // LE point de la carte : un compte neuf n'est classé NULLE PART, et la page doit rester
    // non vide et actionnable. Si `/solo` listait « mes ladders », ce compte verrait zéro tuile.
    const notRanked = await main.getByText('Not ranked yet').count();
    step(
      'S2',
      notRanked === 2 && tileCount === 2,
      `compte neuf : « Not ranked yet » sur ${notRanked} tuile(s) (2 attendues), et ${tileCount} tuile(s) cliquables — la page reste actionnable sans aucun classement`,
    );

    // ------------------------------------------ §2 id malformé -> écran d'erreur, 0 requête
    setPhase('2. ladderId malformé -> écran d’erreur, zéro requête');
    // Le back valide ses params par Zod : un id non-uuid ne peut répondre que 400. Le front
    // applique la même règle et ne tape donc pas l'API du tout — y compris
    // `/users/me/external-accounts`, qui ne dépend pourtant pas de l'id.
    const dataCalls = (url) =>
      url.includes('/api/ladders/') ||
      url.includes('/api/matches/me') ||
      url.includes('/api/users/me/external-accounts');

    const malformedCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/solo/not-a-uuid`, { waitUntil: 'networkidle' });
      await appears(main.locator('text=Invalid ladder link'));
    }, dataCalls);

    // ⚠️ LE CONTRÔLE POSITIF, et il n'est pas décoratif : « 0 requête » est aussi ce que
    // mesurerait un filtre qui ne matche RIEN (une route renommée, un `/api` oublié). Le même
    // filtre est donc rejoué sur une page VALIDE, où il doit compter les trois requêtes de
    // données. Sans lui, S3 serait vert par construction — le défaut trouvé trois fois sur
    // FX-ROW.
    const validCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/solo/${chess.id}`, { waitUntil: 'networkidle' });
      await appears(main.locator('h1'));
    }, dataCalls);

    step(
      'S3',
      malformedCalls === 0 && validCalls > 0 && page.url().includes('/solo/'),
      `requêtes de données sur un id malformé : ${malformedCalls} (0 attendue) ; le MÊME filtre sur un ladder valide : ${validCalls} (> 0 attendu — c’est ce qui prouve que le filtre matche vraiment quelque chose)`,
    );

    await page.goto(`${ORIGIN}/solo/not-a-uuid`, { waitUntil: 'networkidle' });
    step(
      'S3b',
      page.url().endsWith('/solo/not-a-uuid'),
      `pas de redirection silencieuse : ${new URL(page.url()).pathname}`,
    );

    // ------------------------------------------------------- §3 uuid inconnu -> écran 404
    setPhase('3. uuid inconnu -> écran 404');
    // Le 404 est L'OBJET du test : déclaré pour être listé à part au lieu d'être imputé au
    // ticket. Motif restreint à CET uuid, jamais à la route /ladders/.
    expectHttp(new RegExp(UNKNOWN_LADDER), 'ladder inexistant demandé volontairement -> 404');
    await page.goto(`${ORIGIN}/solo/${UNKNOWN_LADDER}`, { waitUntil: 'networkidle' });
    const notFound = await appears(main.locator('text=Ladder not found'));
    step(
      'S4',
      notFound && page.url().includes(UNKNOWN_LADDER),
      `écran 404 rendu = ${notFound}, URL conservée = ${page.url().includes(UNKNOWN_LADDER)}`,
    );

    // ------------------------------------------------ §4 bon uuid, MAUVAIS format (2v2+)
    setPhase('4. ladder d’équipe ouvert en /solo -> écran dédié');
    // Absent de la carte, trouvé à la lecture du contrat : l'API répond **200** ici, il n'y a
    // donc aucune erreur à hériter. Sans garde, la page rendrait « mon dossier » sur un ladder
    // 5v5, offrirait un créneau solo que `validateSide()` refuserait (il y exige une équipe et
    // une lineup) et surlignerait une ligne joueur sur un classement qui ne range que des
    // équipes.
    await page.goto(`${ORIGIN}/solo/${teamLadder.id}`, { waitUntil: 'networkidle' });
    const wrongFormat = await appears(main.locator('text=Not a solo ladder'));
    const wrongFormatButtons = await openSlotButton.count();
    step(
      'S5',
      wrongFormat && wrongFormatButtons === 0,
      `ladder ${teamLadder.format} (« ${teamLadder.name} ») ouvert en /solo : écran « Not a solo ladder » = ${wrongFormat}, bouton d’ouverture offert : ${wrongFormatButtons} (0 attendu)`,
    );

    // --------------------------- §5 le dossier chess : compte LIÉ, deux onglets, une région
    setPhase('5. /solo/$ladderId sur chess 1v1 : compte lié, Overview + Matches, pas de Manage');
    await page.goto(`${ORIGIN}/solo/${chess.id}`, { waitUntil: 'networkidle' });
    const heroShown = await appears(main.getByRole('heading', { level: 1, name: user.pseudo }));
    const tabs = await main.getByRole('tab').count();
    const manageTab = await main.getByRole('tab', { name: 'Manage' }).count();
    step(
      'S6',
      heroShown && tabs === 2 && manageTab === 0,
      `en-tête au pseudo du joueur = ${heroShown}, onglets : ${tabs} (2 attendus), onglet « Manage » : ${manageTab} (0 attendu — rien à renommer, pas de roster, pas de dissolution)`,
    );

    // Invariant #11 : UNE seule région live par écran, sinon deux se disputent la lecture et
    // un sélecteur `[role=status]` en `.first()` prend la première venue.
    const liveRegions = await main.locator('[role="status"]').count();
    step(
      'S7',
      liveRegions === 1,
      `régions live \`role="status"\` dans <main> : ${liveRegions} (exactement 1 attendue)`,
    );

    // -------------------------- §6 LE CHECK CENTRAL : aucun bouton que l'API refuserait
    setPhase('6. rl 1v1, compte Epic NON lié : le bouton d’ouverture n’existe pas');
    await page.goto(`${ORIGIN}/solo/${rocket.id}`, { waitUntil: 'networkidle' });
    const unlinkedNotice = await appears(main.locator('text=No Epic account linked'));
    const unlinkedButtons = await openSlotButton.count();
    step(
      'S8',
      unlinkedNotice && unlinkedButtons === 0,
      `sans compte Epic : avis « No Epic account linked » = ${unlinkedNotice}, bouton « Open a slot » : ${unlinkedButtons} (0 attendu — POST /matches répondrait 400 §5.1, et une ligne rouge en console est un motif de rejet)`,
    );

    // Le POSITIF du même check, et il n'est pas décoratif : S8 seul resterait vert le jour où
    // le bouton cesserait d'être rendu POUR TOUT LE MONDE (sélecteur périmé, en-tête cassé).
    // On ne casse pas le code pour le voir rouge, on retourne la DONNÉE : le compte est lié,
    // la même page doit offrir le bouton.
    const linkedEpic = await link(user, EPIC_PROVIDER);
    await page.goto(`${ORIGIN}/solo/${rocket.id}`, { waitUntil: 'networkidle' });
    const linkedNotice = await appears(main.locator('text=Your Epic account is linked'));
    const linkedButtons = await openSlotButton.count();
    step(
      'S9',
      linkedEpic.status === 201 && linkedNotice && linkedButtons === 1,
      `après liaison Epic (HTTP ${linkedEpic.status}) : avis « account is linked » = ${linkedNotice}, bouton « Open a slot » : ${linkedButtons} (1 attendu) — c’est ce qui prouve que S8 peut virer au rouge`,
    );

    // On délie : la suite du run doit retrouver l'état non lié sur rl, et le teardown un compte
    // propre.
    await unlink(user, EPIC_PROVIDER);

    // ------------------------------------------------- §7 ouvrir un créneau à la souris
    setPhase('7. ouverture d’un créneau sur chess 1v1, entièrement à la souris');
    await page.goto(`${ORIGIN}/solo/${chess.id}`, { waitUntil: 'networkidle' });
    await openSlotButton.click();
    const panelOpen = await appears(main.getByRole('heading', { name: 'Open a match slot' }));
    // ⚠️ COMPTER AVANT DE LIRE : `getAttribute()` sur un locator vide LÈVE -> exit 2
    // (« harnais en échec ») au lieu d'un rouge imputable au ticket.
    const openerCount = await openSlotButton.count();
    const expanded = openerCount === 1 ? await openSlotButton.getAttribute('aria-expanded') : null;

    // Le `<select>` des heures : on prend la première option réellement sélectionnable (valeur
    // non vide et non désactivée). Un compte neuf n'a aucun engagement, donc aucune n'est
    // grisée — mais lire l'état plutôt que le supposer est ce qui évite un faux rouge le jour
    // où le run tombe à une heure tardive.
    const timeSelect = main.getByLabel('Kick-off');
    const options = await timeSelect.locator('option').evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, disabled: node.disabled })),
    );
    const firstFree = options.find((option) => option.value !== '' && !option.disabled);
    if (!firstFree) {
      throw new Error(`aucun quart sélectionnable dans le menu (${options.length} option(s))`);
    }
    await timeSelect.selectOption(firstFree.value);
    await main.getByRole('button', { name: 'Open the slot' }).click();

    // ⚠️ La région live est MONTÉE EN PERMANENCE : attendre sa présence n'attend rien, on
    // lirait du vide ou l'annonce précédente. On attend le TEXTE (invariant #11).
    const openedAnnounced = await awaitAnnouncement('Slot opened for');
    const nextMatch = await main.getByRole('heading', { name: 'Next match' }).count();
    step(
      'S10',
      panelOpen && expanded === 'true' && openedAnnounced && nextMatch === 1,
      `panneau ouvert : ${panelOpen}, aria-expanded « ${expanded ?? '—'} » (true attendu), annonce « Slot opened for… » : ${openedAnnounced}, bloc « Next match » : ${nextMatch} (1 attendu)`,
    );

    // On récupère l'id par l'API pour le teardown — l'écran ne l'expose que dans un href.
    const mineRes = await api(user, `/matches/me?ladderId=${chess.id}`);
    const mine = mineRes.ok ? (await mineRes.json()).matches : [];
    const openedSlot = mine.find((m) => m.status === 'pending');
    if (!openedSlot) throw new Error('le créneau ouvert à la souris est introuvable via l’API');
    matchIds.push(assertUuid(openedSlot.id, 'matchId du créneau'));

    // --------------------------------------------------------- §8 l'annuler, focus rendu
    setPhase('8. annulation du créneau depuis l’onglet Matches');
    await main.getByRole('tab', { name: 'Matches' }).click();
    // ⚠️ Scopé au TABLEAU : l'onglet Overview reste monté (masqué) derrière celui-ci et porte
    // un bouton au MÊME `aria-label`. Un sélecteur non scopé attrape l'invisible et le clic
    // expire à 30 s -> exit 2 (piège vécu sur `TeamOverview`, FX-ROW).
    const historyRegion = main.getByRole('region', { name: /Match history/ });
    await historyRegion.locator('button[aria-label^="Cancel the slot of"]').click();
    const dialogOpened = await appears(page.locator('dialog[open]'));
    // ⚠️ Le clic est SOUS CONDITION : si la boîte cesse de s'ouvrir, un `.click()` nu expire à
    // 30 s et sort en exit 2, ce qui MASQUE le check au lieu de le rendre rouge.
    if (dialogOpened) {
      await page.locator('dialog[open] button:has-text("Cancel the slot")').click();
    }
    const cancelAnnounced = dialogOpened && (await awaitAnnouncement('cancelled'));
    const cancelledPill = await historyRegion.getByText('Cancelled', { exact: true }).count();
    step(
      'S11',
      dialogOpened && cancelAnnounced && cancelledPill === 1,
      `boîte de confirmation ouverte : ${dialogOpened}, annonce « … cancelled » : ${cancelAnnounced}, pastille « Cancelled » dans l’historique : ${cancelledPill} (1 attendue)`,
    );

    // FX-FOCUS — le bouton qui avait le focus vient d'être démonté. `<body>` est la mauvaise
    // réponse : l'utilisateur au clavier serait renvoyé en haut du document sans rien entendre.
    // ⚠️ `awaitFocusRestored` AVANT `focusLanding`, qui est un instantané synchrone.
    const focusRestored = await awaitFocusRestored();
    const landing = await focusLanding();
    step(
      'S12',
      focusRestored && landing.tag !== 'BODY',
      `focus après annulation : <${landing.tag ?? '—'}> « ${landing.label} » (pas BODY attendu — la région « Match history » nomme la liste quittée)`,
    );

    // Cause 2 de `opponent: null` : un créneau ANNULÉ n'a jamais eu d'adversaire. La colonne
    // doit rendre un tiret, et surtout PAS « Deleted player » — c'est le STATUT qui tranche,
    // jamais la nullité (piège FT-4A).
    //
    // ⚠️ CE CHECK A ÉTÉ VU VERT PAR CONSTRUCTION AVANT D'ÊTRE CORRIGÉ. Il comptait d'abord
    // `td span.text-text-muted` : or `Pill tone="muted"` porte AUSSI `text-text-muted`, donc la
    // pastille « Cancelled » de la même ligne suffisait à le satisfaire — il serait resté vert
    // après suppression du tiret qu'il surveille. On lit maintenant la CELLULE ADVERSAIRE
    // elle-même (2ᵉ colonne : Date, Opponent, Score, Elo, Status — pas de colonne Line-up en
    // solo) et on la compare exactement.
    const opponentCells = historyRegion.locator('tbody tr td:nth-child(2)');
    const cellCount = await opponentCells.count();
    // ⚠️ COMPTER AVANT DE LIRE : `innerText()` sur un locator vide LÈVE, ce qui sortirait en
    // exit 2 (« harnais en échec ») au lieu d'un rouge imputable au ticket.
    const opponentText = cellCount === 1 ? (await opponentCells.innerText()).trim() : null;
    step(
      'S13',
      cellCount === 1 && opponentText === '—',
      `créneau annulé : ${cellCount} ligne(s) d’historique (1 attendue), cellule « Opponent » = « ${opponentText ?? '—non lue—'} » (un tiret cadratin attendu : la pastille CANCELLED dit déjà pourquoi il n’y a personne, et « Deleted player » serait un mensonge)`,
    );

    // `SoloMatches` code en dur `canOpenSheet: true` et la note du tableau promet « Every row
    // opens its match sheet ». La règle est vraie côté serveur (`GET /matches/:id` autorise le
    // participant DIRECT, et en 1v1 j'en suis un), mais rien ne la gardait : si elle cessait
    // d'être vraie, la fiche répondrait 403 et laisserait une ligne rouge en console — motif
    // de rejet du projet. On passe par le lien de la DATE, pas par le clic de ligne : c'est
    // lui l'accès clavier et lecteur d'écran (FX-ROW), donc le seul qui doive exister.
    const dateLink = historyRegion.locator('tbody tr td:nth-child(1) a');
    // ⚠️ Compter avant de lire : `getAttribute()` sur un locator vide LÈVE → exit 2.
    const dateLinkCount = await dateLink.count();
    const sheetHref = dateLinkCount === 1 ? await dateLink.getAttribute('href') : null;
    let sheetOpened = false;
    if (sheetHref) {
      await dateLink.click();
      // ⚠️ Un motif suffirait à rendre la main IMMÉDIATEMENT si l'URL courante le satisfaisait
      // déjà : on exige le pathname EXACT de la cible.
      sheetOpened = await page
        .waitForURL((url) => url.pathname === sheetHref, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
    }
    const sheetHeading = sheetOpened
      ? await appears(main.getByRole('heading', { level: 1 }))
      : false;
    step(
      'S13b',
      dateLinkCount === 1 && sheetOpened && sheetHeading,
      `lien de date : ${dateLinkCount} (1 attendu) → fiche ouverte = ${sheetOpened}, titre rendu = ${sheetHeading} (un 403 laisserait une ligne rouge en console)`,
    );
    // Chaque groupe repart d'un état connu : sans ça un rouge ici ferait sortir les suivants
    // en exit 2 plutôt qu'en rouge imputable.
    await page.goto(`${ORIGIN}/solo/${chess.id}`, { waitUntil: 'networkidle' });

    // ------------------------------- §9 cause 4 : l'adversaire a supprimé son compte
    setPhase('9. adversaire disparu : « Deleted player », pas un tiret');
    const foe = await createUser();
    const foeLinked = await link(foe, CHESS_PROVIDER);
    if (foeLinked.status !== 201) throw new Error(`liaison de l’adversaire -> ${foeLinked.status}`);

    // Un créneau à une heure qui ne chevauche pas le précédent (annulé, donc libéré, mais
    // autant rester loin) : ouvert par `user`, accepté par `foe` -> `in_progress`.
    const created = await api(user, '/matches', {
      method: 'POST',
      body: JSON.stringify({ ladderId: chess.id, scheduledAt: futureQuarter(6) }),
    });
    if (created.status !== 201) {
      throw new Error(`POST /matches -> ${created.status} : ${await created.text()}`);
    }
    const playedId = assertUuid(
      await created.json().then(({ match }) => match.id),
      'matchId joué',
    );
    matchIds.push(playedId);
    const accepted = await api(foe, `/matches/${playedId}/accept`, { method: 'POST' });
    if (accepted.status !== 200) throw new Error(`accept -> ${accepted.status}`);

    // L'adversaire est VIVANT à cet instant : c'est la seule fenêtre où la branche « lien vers
    // la page joueur » de `MatchRow` existe, et elle est neuve (ce ticket l'a ajoutée pour
    // l'adversaire de type `user`). Deux lignes plus bas son compte disparaît et le libellé
    // devient du texte brut — S14 ne peut donc pas la couvrir.
    await page.goto(`${ORIGIN}/solo/${chess.id}`, { waitUntil: 'networkidle' });
    await main.getByRole('tab', { name: 'Matches' }).click();
    const liveHistory = main.getByRole('region', { name: /Match history/ });
    // ⚠️ PAS `{ name: foe.pseudo }` : Playwright matche le nom accessible en SOUS-CHAÎNE par
    // défaut, et le lien de la DATE porte « Match sheet against <pseudo>, <date> ». Le
    // sélecteur en attrapait donc deux. On vise le libellé exact du lien adversaire, ce qui
    // garde du même coup son `aria-label`.
    const foeLink = liveHistory.getByRole('link', {
      name: `Player page of ${foe.pseudo}`,
      exact: true,
    });
    // ⚠️ Compter avant de lire l'attribut : `getAttribute()` sur un locator vide LÈVE → exit 2.
    const foeLinkCount = await foeLink.count();
    const foeHref = foeLinkCount === 1 ? await foeLink.getAttribute('href') : null;
    step(
      'S13c',
      foeLinkCount === 1 && foeHref === `/players/${foe.pseudo}`,
      `adversaire vivant : ${foeLinkCount} lien (1 attendu) vers « ${foeHref ?? '—aucun—'} » (/players/${foe.pseudo} attendu)`,
    );

    // ⚠️ Sur un non-2xx la réponse n'a pas de clé `sides` et la lecture lèverait -> exit 2
    // « harnais en échec » au lieu d'un rouge imputable.
    const sheetRes = await api(user, `/matches/${playedId}`);
    if (!sheetRes.ok) throw new Error(`GET /matches/:id -> ${sheetRes.status}`);
    const { sides } = await sheetRes.json();
    const foeSide = sides.find((side) =>
      side.players.some((player) => player.pseudo === foe.pseudo),
    );
    const foeSideId = assertUuid(foeSide?.id, 'sideId adversaire');

    // 🚨 LA SEULE OPÉRATION QUE L'API INTERDIT. `DELETE /users/me` répond 409
    // `engaged_in_match` tant qu'un match engage le compte, donc « l'adversaire part pendant
    // un match » est inatteignable par HTTP. Mais `match_participants.user_id` est en CASCADE
    // depuis [BX-DEL] : supprimer la ligne de participant produit EXACTEMENT l'état laissé par
    // une suppression de compte. On force l'état, on ne constate rien ici — le comportement
    // est lu à l'écran, juste en dessous.
    sql(`delete from match_participants where match_side_id = '${foeSideId}';`);

    await page.goto(`${ORIGIN}/solo/${chess.id}`, { waitUntil: 'networkidle' });
    await main.getByRole('tab', { name: 'Matches' }).click();
    const history = main.getByRole('region', { name: /Match history/ });
    const ghost = await history.getByText('Deleted player').count();
    step(
      'S14',
      ghost === 1,
      `adversaire dont le compte a disparu sur un match in_progress : libellé « Deleted player » ${ghost} (1 attendu — un tiret effacerait en silence un adversaire qui a bel et bien joué)`,
    );

    // ------------------------------------------------------------------ §10 375 px
    setPhase('10. le dossier solo à 375 px');
    await page.setViewportSize({ width: 375, height: 900 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    step(
      'S15',
      overflow <= 0,
      `débordement horizontal du document à 375 px : ${overflow}px (≤ 0 attendu)`,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
  } finally {
    // ---------------------------------------------------------------- §11 teardown
    // Exécuté MÊME si un check a échoué : sinon le premier run raté laisserait deux comptes
    // indéracinables derrière lui (un match `in_progress` engage ses participants), et le
    // suivant hériterait de leur bruit.
    if (matchIds.length > 0) {
      setPhase('11. teardown : les matchs cessent d’engager les comptes');
      // ⚠️ La page est ENCORE OUVERTE ici (le runner ne ferme le navigateur qu'après `run()`).
      // On la vide avant de supprimer les matchs : une invalidation en vol ferait refetcher une
      // fiche disparue et écrirait un 404 dans la console, imputé à cette phase de nettoyage.
      await page.goto('about:blank').catch(() => {});
      const ids = matchIds.map((id) => `'${id}'`).join(', ');
      try {
        // 1) `cancelled` est, avec `completed`, l'un des deux seuls statuts hors
        //    `ENGAGING_STATUSES` : c'est ce qui rend les comptes supprimables par
        //    `deleteAuditUser()`. Étape LOAD-BEARING, donc faite en premier — si la suivante
        //    échoue, le nettoyage du runner passe quand même.
        sql(`update matches set status = 'cancelled', winner_side_id = null where id in (${ids});`);
        // 2) Puis les matchs. `DELETE /matches/:id` ne fait que passer le statut à
        //    `cancelled` : sans cette requête, chaque run laisserait des coquilles de plus.
        //    Sides et participants tombent en CASCADE.
        sql(`delete from matches where id in (${ids});`);
        // Ce check lit la BASE, et c'est légitime ici parce que la base EST le sujet : il garde
        // le teardown, pas un comportement de l'application (règle du docblock de `sql.mjs`).
        // ⚠️ Il compte AUSSI ce qui doit tomber en cascade : sur le seul `matches`, il ne
        // pourrait pas rougir (le `delete` lève avant d'y arriver s'il échoue).
        const left = sql(
          `select (select count(*) from matches where id in (${ids}))
                + (select count(*) from match_sides where match_id in (${ids}))
                + (select count(*) from match_participants where match_side_id in
                     (select id from match_sides where match_id in (${ids})));`,
        );
        step(
          'S16',
          left === '0',
          `lignes résiduelles (matchs + sides + participants) : ${left} (0 attendu)`,
        );
      } catch (err) {
        // ⚠️ Une exception de teardown ne doit JAMAIS écraser celle qui a interrompu le run : le
        // rapport afficherait « SQL refusé… » à la place de la vraie cause. On la rend visible
        // en ROUGE — donc en exit 1, imputable — sans la laisser remonter.
        step('S16', false, `teardown interrompu : ${err.message}`);
      }
    }
  }
}
