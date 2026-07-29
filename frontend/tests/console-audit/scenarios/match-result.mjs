/**
 * `/matches/$matchId` — [FT-4B] : saisie du score, confirmation, litige.
 *
 * Le seul écran où le cycle challenge/accept peut se TERMINER : sans lui aucun score ne
 * s'entre à la souris et l'Elo ne bouge jamais en démo. Le scénario déroule le cycle complet
 * sur deux matchs — accord (soumission puis confirmation, Elo appliqué) et désaccord
 * (contestation, litige) — plus le négatif qui garde le motif de rejet : **avant l'heure, la
 * fiche n'offre aucun bouton**, parce que l'API répondrait 400 et qu'une ligne rouge dans la
 * console Chrome fait rejeter le projet.
 *
 * ⚠️ POURQUOI CE SCÉNARIO SORT DU NAVIGATEUR. L'API interdit d'atteindre l'état de départ :
 * `POST /matches` et `POST /matches/:id/accept` exigent un `scheduledAt` **dans le futur**
 * (≥ 15 min), tandis que `POST /matches/:id/result` exige `now() >= scheduled_at` (§5.3).
 * Aucune séquence d'appels HTTP ne les satisfait tous les deux. On recule donc
 * `scheduled_at` en SQL, exactement comme `backend/tests/test_matches_result.py`
 * (`start_match()` + `backdate_sched()`). Le helper vit dans `../sql.mjs` et porte la règle :
 * **forcer un état, jamais constater un comportement**.
 *
 * ⚠️ POURQUOI DU 1v1 ET PAS DU 5v5 (décision prise avec la mesure le 29/07, ne pas la
 * ré-arbitrer). Un match d'équipe demanderait deux équipes, deux rosters de 5, dix comptes
 * externes liés et deux invitations acceptées — soit une vingtaine de comptes jetables et
 * autant de quotas d'inscription à attendre. Le ladder **chess 1v1** demande **2 comptes**
 * avec **1 compte externe** chacun : le joueur EST le camp, il n'y a pas de lineup.
 *
 * ⚠️ CE SCÉNARIO NE DÉPEND PAS DU SEED. Contrairement à `match-detail`, il fabrique sa propre
 * donnée avec des comptes jetables : il reste rejouable sur une base non semée, et deux runs
 * consécutifs ne se marchent pas dessus. Seul le ladder chess 1v1 est attendu en base — il
 * vient des migrations (`0009`), pas du seed.
 *
 * ⚠️ TEARDOWN OBLIGATOIRE, et c'est la partie qu'on oublie. Trois pièges, tous payés :
 *   1. `DELETE /users/me` refuse en 409 `engaged_in_match` tout compte aligné dans un match
 *      `pending`/`in_progress`/`awaiting_confirmation`/`disputed` (`ENGAGING_STATUSES`), et
 *      `purgeUserMatches()` du runner ne sait qu'annuler un slot **encore pending**.
 *   2. `matches.winner_side_id` -> `match_sides.id` est une référence **circulaire** : sur un
 *      match `completed` il faut la casser avant de supprimer la ligne (piège du 20/07 côté
 *      Python, où le ROLLBACK silencieux a laissé s'accumuler 270 users).
 *   3. `dispute_needs_admin` notifie **TOUS les comptes `is_admin`** — donc de VRAIS comptes
 *      de la base de dev, qui ne partent pas avec nos comptes jetables. Le payload jsonb
 *      n'a **aucune clé étrangère** vers `matches` : supprimer le match laisserait ces
 *      notifications pointer dans le vide. On les purge par `(data->>'matchId')::uuid`,
 *      exactement comme `backend/tests/helpers.py:cleanup()`.
 */
import { assertUuid } from '../sql.mjs';

export const name = 'match-result';
export const surface = '/matches/$matchId — saisie du score, confirmation, litige (FT-4B)';

/** Provider exigé par le jeu `chess` (`games.required_provider`, migration 0008). */
const CHESS_PROVIDER = 'chess_com';

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
 * ms à zéro, et à plus de 15 minutes. Depuis B5d le back refuse tout le reste en 400 — d'où
 * l'arrondi AU QUART SUPÉRIEUR, le même que `future()` dans `backend/tests/helpers.py`.
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

  // ------------------------------------------------- §0 les deux joueurs, comptes liés
  setPhase('0. mise en place (API directe) : deux joueurs, comptes chess.com liés');

  // ⚠️ Des comptes JETABLES, jamais les comptes semés (`alice`/`bob`) : un scénario doit
  // rester rejouable sans relancer le seed, et deux runs ne doivent pas se disputer le même
  // joueur (§5.2 : un camp déjà engagé ne peut pas ouvrir un second créneau qui chevauche).
  const opponent = await createUser();

  const link = (as) =>
    api(as, '/users/me/external-accounts', {
      method: 'POST',
      body: JSON.stringify({ provider: CHESS_PROVIDER, externalId: `AUDIT-${as.stamp}` }),
    });
  // §5.1 — sans compte lié, `validateSide()` refuse le camp en 400 dès la création du slot.
  const linkedCreator = await link(user);
  const linkedOpponent = await link(opponent);
  step(
    'R0',
    linkedCreator.status === 201 && linkedOpponent.status === 201,
    `comptes ${CHESS_PROVIDER} liés pour les deux joueurs -> HTTP ${linkedCreator.status}/${linkedOpponent.status} (201/201 attendus)`,
  );

  // Le ladder est trouvé par sa DONNÉE (jeu + format), jamais par un uuid en dur : les ids
  // sont générés par la migration et diffèrent d'une base à l'autre.
  // ⚠️ Le statut se lit AVANT le corps. Sur un 429 (quota global 100/min, partagé par IP) ou un
  // 500, `json()` ne rend aucune clé `ladders` et `.find()` lèverait un TypeError opaque — le
  // message de diagnostic soigné juste en dessous ne serait jamais atteint.
  const laddersRes = await api(user, '/ladders');
  if (!laddersRes.ok) {
    throw new Error(`GET /ladders -> ${laddersRes.status} : ${await laddersRes.text()}`);
  }
  const { ladders } = await laddersRes.json();
  const ladder = ladders.find((entry) => entry.gameId === 'chess' && entry.format === '1v1');
  if (!ladder) {
    // Erreur de HARNAIS (exit 2), pas un check rouge : sans ce ladder, tout ce qui suit
    // mesurerait le vide.
    throw new Error(
      'aucun ladder chess 1v1 en base — les migrations sont-elles passées ? ' +
        `(${ladders.length} ladder(s) vus)`,
    );
  }

  /**
   * Un match prêt à recevoir un score : créneau ouvert par `user`, accepté par `opponent`.
   * Rend l'id du match ET les deux sides — leurs ids pilotent les boutons radio de l'écran,
   * et `winnerSideId` n'est JAMAIS l'id du match.
   */
  const openMatch = async (scheduledAt) => {
    const created = await api(user, '/matches', {
      method: 'POST',
      body: JSON.stringify({ ladderId: ladder.id, scheduledAt }),
    });
    if (created.status !== 201) {
      throw new Error(`POST /matches -> ${created.status} : ${await created.text()}`);
    }
    // Interpolé en SQL plus bas : on refuse tout ce qui n'est pas un uuid.
    const id = assertUuid(await created.json().then(({ match }) => match.id), 'matchId');

    const accepted = await api(opponent, `/matches/${id}/accept`, { method: 'POST' });
    // ⚠️ Sur un 403/500, la réponse n'a pas de clé `match` et `sheet.status` lèverait ->
    // **exit 2 « harnais en échec »** au lieu d'un rouge imputable au ticket. C'est le piège
    // du `getAttribute()` de FT-4A, transposé au réseau.
    const detail = await api(user, `/matches/${id}`);
    const sheet = detail.ok ? await detail.json() : null;

    return { id, accepted: accepted.status, detailStatus: detail.status, sheet };
  };

  /** Le coup d'envoi est reculé : la seule opération que l'API ne peut pas rendre. */
  const backdate = (id, interval) =>
    sql(`update matches set scheduled_at = now() - interval '${interval}' where id = '${id}';`);

  const matchIds = [];
  try {
    // --------------------------------------- §1 créneau ouvert puis accepté -> in_progress
    setPhase('1. création du créneau puis acceptation (API directe)');
    const first = await openMatch(futureQuarter(1));
    matchIds.push(first.id);
    step(
      'R1',
      first.accepted === 200 && first.sheet?.match?.status === 'in_progress',
      `accept -> HTTP ${first.accepted} (200), GET /matches/:id -> HTTP ${first.detailStatus}, statut « ${first.sheet?.match?.status ?? '—'} » (in_progress attendu)`,
    );

    // ⚠️ `winnerSideId` est l'id d'un `match_sides`, JAMAIS celui du match : c'est cette
    // valeur qui pilote les boutons radio de l'écran, et c'est elle qu'on coche plus bas.
    const mySideId = assertUuid(first.sheet?.sides?.[0]?.id, 'sideId créateur');

    const main = page.locator('main');
    const sheetUrl = (id) => `${ORIGIN}/matches/${id}`;
    // Les trois boutons d'action de l'écran, nommés une fois : chaque libellé est DISTINCT
    // (« Apply the result » est celui de la boîte de confirmation) — deux libellés qui se
    // contiennent rendraient tout comptage ambigu, et un check qui compte mal ne garde rien.
    const reportButton = main.locator('button:has-text("Report the result")');
    const contestReportButton = main.locator('button:has-text("Report my result")');
    const confirmButton = main.locator('button:has-text("Confirm the result")');
    const contestButton = main.locator('button:has-text("Contest")');

    // ------------------------------- §2 AVANT l'heure : aucune action n'est offerte
    setPhase('2. avant le coup d’envoi : la fiche n’offre AUCUNE saisie');
    // Le négatif est fait ICI parce qu'il est GRATUIT : l'état existe déjà (match accepté,
    // coup d'envoi à +1 h) et il disparaîtra au backdate de la phase suivante.
    await page.goto(sheetUrl(first.id), { waitUntil: 'networkidle' });
    const openedEarly = await appears(main.locator('h1'));
    // ⚠️ On vérifie les DEUX faces, sinon le check ne garde rien : « 0 bouton » serait vert
    // même si la fiche entière avait cessé de se rendre. La phrase prouve qu'on est bien dans
    // la branche « je suis le déclarant, mais pas encore », et les compteurs qu'aucune action
    // n'est offerte — l'API répondrait 400 « match not started yet », et une ligne rouge dans
    // la console est un motif de rejet du projet.
    const earlyHint = await main.locator('text=The form opens at kick-off').count();
    const earlyReport = await reportButton.count();
    const earlyConfirm = await confirmButton.count();
    step(
      'R2',
      openedEarly && earlyHint === 1 && earlyReport === 0 && earlyConfirm === 0,
      `fiche rendue : ${openedEarly}, avis « form opens at kick-off » ${earlyHint} (1 attendu), boutons de saisie ${earlyReport + earlyConfirm} (0 attendu)`,
    );

    // ------------------------------------------------- §3 le coup d'envoi est reculé
    setPhase('3. backdate SQL : le coup d’envoi devient passé');
    backdate(first.id, '1 hour');
    // ⚠️ Ce check garde l'EXISTENCE de la ligne, pas la sémantique : la requête précédente vient
    // d'écrire ce passé, la comparaison ne peut être fausse que si l'`update` n'a touché aucune
    // ligne (id périmé). La vraie preuve du backdate est R4, lue à l'écran.
    const [isPast, storedAt] = sql(
      `select scheduled_at < now(), scheduled_at from matches where id = '${first.id}';`,
    ).split('|');
    step(
      'R3',
      isPast === 't',
      `scheduled_at = ${storedAt} -> déjà passé : ${isPast === 't' ? 'oui' : `non (« ${isPast} »)`}`,
    );

    // ------------------------------------------------------- §4 la fiche, au navigateur
    setPhase('4. la fiche du match préparé s’ouvre pour un participant');
    await page.goto(sheetUrl(first.id), { waitUntil: 'networkidle' });
    const opened = await appears(main.locator('h1'));
    // ⚠️ Scopé au `<header>` de `<main>`, pour deux raisons : le rail de navigation gauche est
    // monté sur toute page authentifiée (un balayage global compterait ses nœuds), et
    // `text=` cherche une SOUS-CHAÎNE insensible à la casse — sur `main` entier, « In
    // progress » matcherait aussi la phrase d'avis si elle reprenait ces mots.
    const pill = await main.locator('header').locator('text=In progress').count();
    step(
      'R4',
      // `=== 1`, pas `>= 1` : un double rendu de la pastille resterait vert sous un `>=`, et
      // « compter avant de lire » ne vaut que si on regarde vraiment le nombre compté.
      opened && pill === 1,
      `fiche rendue pour un participant : ${opened}, pastille « In progress » dans l’en-tête : ${pill} (1 attendu)`,
    );

    // La preuve, LUE SUR L'ÉCRAN, que le backdate a bien produit l'état visé : la fiche
    // annonce un coup d'envoi passé au lieu d'un compte à rebours. C'est l'instant où
    // `POST /matches/:id/result` devient acceptable côté serveur.
    const started = await main.locator('text=/Kick-off was/').count();
    const stillCounting = await main.locator('text=/Kick-off .* — in /').count();
    step(
      'R5',
      started === 1 && stillCounting === 0,
      `avis « Kick-off was… » ${started} (1 attendu), compte à rebours résiduel ${stillCounting} (0 attendu)`,
    );

    // Le pendant POSITIF de R2 : le même écran, la même identité, la seule chose qui a changé
    // est l'heure — et le formulaire apparaît. Sans ce check, R2 serait vert pour n'importe
    // quelle raison (panneau jamais rendu, sélecteur périmé).
    const winnerRadios = await main.locator('input[type="radio"]').count();
    const scoreSelects = await main.locator('form select').count();
    const reportOffered = await reportButton.count();
    step(
      'R6',
      winnerRadios === 2 && scoreSelects === 1 && reportOffered === 1,
      `formulaire offert après le coup d’envoi : ${winnerRadios} radios (2), ${scoreSelects} sélecteur de score (1), bouton « Report the result » ${reportOffered} (1)`,
    );

    // -------------------------------------------------------- §5 première soumission
    setPhase('5. le créateur déclare le score (2 – 0 pour lui)');
    await main.locator(`input[type="radio"][value="${mySideId}"]`).check();
    await main.locator('form select').selectOption('0');
    await reportButton.click();
    // ⚠️ La région live est MONTÉE EN PERMANENCE : attendre sa présence n'attend rien, on
    // lirait du vide ou l'annonce précédente. On attend le TEXTE (invariant #11).
    const reportedAnnounced = await awaitAnnouncement('Result reported');
    const awaitingPill = await main.locator('header').locator('text=Awaiting result').count();
    step(
      'R7',
      reportedAnnounced && awaitingPill === 1,
      `annonce « Result reported… » : ${reportedAnnounced}, pastille « Awaiting result » ${awaitingPill} (1 attendue)`,
    );

    // Mon camp a parlé : plus AUCUN formulaire pour moi (la re-soumission est hors périmètre,
    // décision assumée du ticket), et l'écran dit ce qu'on attend maintenant.
    const formGone = await reportButton.count();
    const waitNotice = await main.locator('text=/left to confirm or contest/').count();
    step(
      'R8',
      formGone === 0 && waitNotice === 1,
      `formulaire résiduel côté déclarant ${formGone} (0 attendu), avis d’attente « … left to confirm or contest » ${waitNotice} (1 attendu)`,
    );

    // FX-FOCUS — le bouton qui avait le focus vient d'être démonté. `<body>` est la mauvaise
    // réponse : l'utilisateur au clavier serait renvoyé en haut du document sans rien entendre.
    // ⚠️ `awaitFocusRestored` AVANT `focusLanding`, qui est un instantané synchrone.
    const focusRestored = await awaitFocusRestored();
    const landing = await focusLanding();
    step(
      'R9',
      focusRestored && landing.tag === 'H1',
      `focus après soumission : <${landing.tag ?? '—'}> « ${landing.label} » (H1 = le titre du match attendu)`,
    );

    // ------------------------------------------------------- §6 l'adversaire confirme
    // ⚠️ Bascule de compte : `/login` REDIRIGE vers `/home` tant qu'une session existe, donc
    // `login()` échouerait sur un `#email` introuvable — et un sélecteur qui expire sort en
    // exit 2. On vide les cookies d'abord (même idiome que `match-detail` et `teams-detail`).
    // Connexion par l'UI ensuite, étiquetée hors périmètre par le runner lui-même.
    await page.context().clearCookies();
    await login(opponent);

    setPhase('6. l’adversaire ouvre la fiche : confirmer ou contester');
    await page.goto(sheetUrl(first.id), { waitUntil: 'networkidle' });
    const choiceShown = await appears(confirmButton);
    const confirmCount = await confirmButton.count();
    const contestCount = await contestButton.count();
    step(
      'R10',
      choiceShown && confirmCount === 1 && contestCount === 1,
      `camp adverse : « Confirm the result » ${confirmCount} (1), « Contest » ${contestCount} (1)`,
    );

    setPhase('7. confirmation : le match se clôt et l’Elo est appliqué');
    await confirmButton.click();
    // La confirmation est irréversible et applique l'Elo : elle passe par `ConfirmDialog`,
    // dont le bouton porte un libellé DIFFÉRENT de celui qui l'a ouverte.
    // ⚠️ Le clic est SOUS CONDITION : si la boîte cesse de s'ouvrir, un `.click()` nu expire
    // à 30 s et sort en exit 2 (« harnais en échec »), ce qui masque R11 au lieu de le rendre
    // rouge — exactement le défaut que `appears()` existe pour éviter.
    const dialogOpened = await appears(page.locator('dialog[open]'));
    if (dialogOpened) {
      await page.locator('dialog[open] button:has-text("Apply the result")').click();
    }
    const settledAnnounced = dialogOpened && (await awaitAnnouncement('Result settled'));

    const completedPill = await main.locator('header').locator('text=Completed').count();
    const board = main.locator('section[aria-label="Score"]');
    const winnerPills = await board.locator('text=Winner').count();
    // ⚠️ COMPTER AVANT DE LIRE : `getAttribute()` sur un locator vide LÈVE, ce qui sortirait
    // en exit 2 (« harnais en échec ») au lieu d'un rouge imputable au ticket — le défaut
    // trouvé en 2ᵉ review de FT-4A.
    const scoreNodes = board.locator('p[role="img"]');
    const scoreCount = await scoreNodes.count();
    const scoreLabel = scoreCount === 1 ? await scoreNodes.getAttribute('aria-label') : null;
    step(
      'R11',
      dialogOpened &&
        settledAnnounced &&
        completedPill === 1 &&
        winnerPills === 1 &&
        / 2, .* 0$/.test(scoreLabel ?? ''),
      `boîte de confirmation ouverte : ${dialogOpened}, annonce « Result settled… » : ${settledAnnounced}, pastille « Completed » ${completedPill} (1), « Winner » ${winnerPills} (1), score annoncé « ${scoreLabel ?? '—'} » (2 – 0 attendu)`,
    );

    /**
     * FX-FOCUS sur le chemin DIALOGUE — le pendant de R9, et le plus exposé des deux.
     *
     * R9 garde la soumission directe, où le bouton disparaît sans qu'aucune boîte ne soit
     * ouverte. Ici deux mécanismes de restitution se croisent : la plateforme rend le focus à
     * l'ouvrant à la fermeture du `<dialog>`, et l'ouvrant est démonté par le refetch qui
     * suit. Si la fermeture gagne, le focus atterrit sur un bouton qui n'existe déjà plus,
     * donc sur `<body>` — sans que rien ne le signale.
     *
     * ⚠️ Ce check ne pouvait pas être déduit de R9 : ce sont deux ordonnancements différents.
     */
    const focusRestoredAfterDialog = await awaitFocusRestored();
    const dialogLanding = await focusLanding();
    step(
      'R11b',
      focusRestoredAfterDialog && dialogLanding.tag === 'H1',
      `focus après la boîte de confirmation : <${dialogLanding.tag ?? '—'}> « ${dialogLanding.label} » (H1 = le titre du match attendu)`,
    );

    // L'Elo est écrit sur les DEUX sides à la clôture, jamais avant : c'est la preuve que le
    // cycle est allé jusqu'au bout. Un camp gagne, l'autre perd — jamais deux fois le même
    // signe, jamais un tiret (`formatEloDelta(null)`).
    const eloLines = main.locator('p:has-text("Elo change:")');
    const eloCount = await eloLines.count();
    const eloTexts = eloCount === 2 ? await eloLines.allTextContents() : [];
    const gained = eloTexts.some((text) => text.includes('+'));
    // « − » est U+2212 (vrai signe moins), posé par `formatEloDelta` — pas un trait d'union.
    const lost = eloTexts.some((text) => text.includes('−'));
    step(
      'R12',
      eloCount === 2 && gained && lost,
      `Elo par camp : ${eloCount} ligne(s) (2 attendues) « ${eloTexts.join(' | ') || '—'} » — un gain : ${gained}, une perte : ${lost}`,
    );

    // --------------------------------------------------------- §8 désaccord -> litige
    setPhase('8. second match : les deux camps déclarent des résultats DIFFÉRENTS');
    // Un second créneau à une heure qui ne chevauche pas le premier (§5.2 : les fenêtres se
    // comparent par inégalités STRICTES). Les deux comptes sont libres : un match `completed`
    // n'engage plus personne (`ENGAGING_STATUSES`).
    const second = await openMatch(futureQuarter(5));
    matchIds.push(second.id);
    if (second.accepted !== 200) {
      throw new Error(`accept du 2ᵉ match -> ${second.accepted}`);
    }
    backdate(second.id, '30 minutes');

    const secondFoeSideId = assertUuid(second.sheet?.sides?.[1]?.id, 'sideId adversaire (2)');
    // Le CRÉATEUR déclare sa victoire, par API : ce chemin-là est déjà prouvé à l'écran par
    // R7, le rejouer à la souris ne garderait rien de plus et coûterait une reconnexion.
    const firstClaim = await api(user, `/matches/${second.id}/result`, {
      method: 'POST',
      body: JSON.stringify({ winnerSideId: second.sheet.sides[0].id, scoreSelf: 2, scoreOpponent: 0 }),
    });
    if (firstClaim.status !== 200) {
      throw new Error(`1ʳᵉ soumission du 2ᵉ match -> ${firstClaim.status} : ${await firstClaim.text()}`);
    }

    await page.goto(sheetUrl(second.id), { waitUntil: 'networkidle' });
    const contestShown = await appears(contestButton);
    await contestButton.click();
    // Disclosure INLINE, jamais un `<dialog>` : le formulaire apparaît sous le bouton, qui
    // porte l'`aria-expanded`.
    const contestFormShown = await appears(contestReportButton);
    const contestButtons = await contestButton.count();
    const expanded = contestButtons === 1 ? await contestButton.getAttribute('aria-expanded') : null;
    step(
      'R13',
      contestShown && contestFormShown && expanded === 'true',
      `« Contest » ouvre le formulaire en place : ${contestFormShown}, aria-expanded « ${expanded ?? '—'} » (true attendu)`,
    );

    // Ma version : je me déclare vainqueur, l'adversaire s'était déclaré vainqueur -> litige.
    await main.locator(`input[type="radio"][value="${secondFoeSideId}"]`).check();
    await main.locator('form select').selectOption('0');
    await contestReportButton.click();
    const disputeAnnounced = await awaitAnnouncement('now in dispute');

    const disputedPill = await main.locator('header').locator('text=Disputed').count();
    // ⚠️ L'unicité vient du MOTEUR `text=` (il rend le plus petit élément contenant le texte,
    // ici le `<strong>` de l'avis), pas d'un scoping écrit ici — le commentaire d'origine
    // annonçait une protection absente du code, ce qui est précisément ce qui fait qu'on ne la
    // revérifie plus. La phrase est distincte de la pastille « Disputed », donc le piège de
    // FT-4A (un `text=Mot` qui compte la pastille ET le mot dans une phrase) ne s'applique pas.
    const disputeNotice = await main.locator('text=The two sides disagree').count();
    const formAfterDispute = await contestReportButton.count();
    step(
      'R14',
      disputeAnnounced && disputedPill === 1 && disputeNotice === 1 && formAfterDispute === 0,
      `annonce de litige : ${disputeAnnounced}, pastille « Disputed » ${disputedPill} (1), avis « The two sides disagree » ${disputeNotice} (1), formulaire résiduel ${formAfterDispute} (0)`,
    );
  } finally {
    // --------------------------------------------------------------- §9 teardown
    // Exécuté MÊME si un check a échoué : sinon le premier run raté laisserait deux comptes
    // indéracinables derrière lui, et le suivant hériterait de leur bruit.
    if (matchIds.length > 0) {
      setPhase('9. teardown : les matchs cessent d’engager les deux comptes');
      // ⚠️ La page est ENCORE OUVERTE ici (le runner ne ferme le navigateur qu'après `run()`).
      // On la vide avant de supprimer les matchs : une invalidation en vol ferait refetcher
      // une fiche disparue et écrirait un 404 dans la console, imputé à cette phase de
      // nettoyage. Zéro coût, une classe entière de faux rouges en moins.
      await page.goto('about:blank').catch(() => {});
      const ids = matchIds.map((id) => `'${id}'`).join(', ');
      try {
        // 1) `cancelled` est, avec `completed`, l'un des deux seuls statuts hors
        //    `ENGAGING_STATUSES` (`backend/src/utils/match-status.ts`) : c'est ce qui rend les
        //    comptes supprimables par `deleteAuditUser()`. Étape LOAD-BEARING, donc faite en
        //    premier — si la suivante échoue, le nettoyage du runner passe quand même.
        //    ⚠️ `winner_side_id` est remis à NULL dans le même geste : `matches.winner_side_id`
        //    -> `match_sides.id` et `match_sides.match_id` -> `matches.id` forment une
        //    référence CIRCULAIRE, et le match confirmé en §7 pointe sur un de ses propres
        //    sides. C'est le piège qui, côté Python, faisait ROLLBACK toute la transaction de
        //    nettoyage EN SILENCE.
        sql(`update matches set status = 'cancelled', winner_side_id = null where id in (${ids});`);
        // 2) Les notifications AVANT le match. Elles n'ont aucune FK vers `matches` (une notif
        //    est un fait passé, elle survit à ce qu'elle raconte) et `dispute_needs_admin`
        //    vise TOUS les admins — de vrais comptes de la base de dev, que la suppression de
        //    nos comptes jetables ne touche pas. Sans cette ligne, chaque run laisse des
        //    notifications pointant sur un match qui n'existe plus.
        sql(`delete from notifications where (data->>'matchId')::uuid in (${ids});`);
        // 3) Puis les matchs. `DELETE /matches/:id` ne fait que passer le statut à
        //    `cancelled` : sans cette requête, chaque run laisserait des matchs orphelins de
        //    plus. Sides, participants et disputes tombent en CASCADE.
        sql(`delete from matches where id in (${ids});`);
        // Ce check lit la BASE, et c'est légitime ici parce que la base EST le sujet : il garde
        // le teardown, pas un comportement de l'application (règle du docblock de `sql.mjs`).
        // ⚠️ Il compte AUSSI ce qui doit tomber en cascade : sur le seul `matches`, il ne
        // pouvait pas rougir (le `delete` lève avant d'y arriver s'il échoue), donc il ne
        // gardait rien. Ainsi, le jour où une FK cesserait d'être `cascade`, il passe au rouge.
        const left = sql(
          `select (select count(*) from matches where id in (${ids}))
                + (select count(*) from match_sides where match_id in (${ids}))
                + (select count(*) from match_participants where match_side_id in
                     (select id from match_sides where match_id in (${ids})))
                + (select count(*) from disputes where match_id in (${ids}))
                + (select count(*) from notifications where (data->>'matchId')::uuid in (${ids}));`,
        );
        step(
          'R15',
          left === '0',
          `lignes résiduelles (matchs + sides + participants + disputes + notifs) : ${left} (0 attendu)`,
        );
      } catch (err) {
        // ⚠️ Une exception de teardown ne doit JAMAIS écraser celle qui a interrompu le run : le
        // rapport afficherait « SQL refusé… » à la place de la vraie cause (un `goto` expiré,
        // par exemple), sur un chemin déjà pénible à diagnostiquer. On la rend visible en ROUGE
        // — donc en exit 1, imputable — sans la laisser remonter.
        step('R15', false, `teardown interrompu : ${err.message}`);
      }
    }
  }
}
