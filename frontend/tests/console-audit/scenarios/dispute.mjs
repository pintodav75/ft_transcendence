/**
 * `/disputes/$disputeId` — [F-DISPUTE] : le dossier de litige.
 *
 * Avant ce ticket, un litige était un CUL-DE-SAC : FT-4B permet d'en ouvrir un, puis plus aucun
 * écran n'existait — le mot « dispute » n'apparaissait dans le front que comme pastille. Or une
 * dispute que personne n'arbitre est ANNULÉE au bout de 24 h : qui ne peut pas déposer sa preuve
 * perd son match par forfait de fait.
 *
 * Ce que ce scénario garde :
 *   - id malformé -> écran d'erreur et **zéro requête** (le front applique la même règle uuid que
 *     le back : un 400 certain ne se paie pas en ligne rouge), avec son témoin positif ;
 *   - uuid inconnu -> écran 404 (déclaré par `expectHttp`) ;
 *   - **non-participant** -> écran 403 dédié (déclaré par `expectHttp`) ;
 *   - une dispute **RÉSOLUE PAR UN ADMIN** est en lecture seule : verdict nommé, note d'arbitre,
 *     **zéro contrôle** — et le repli « no note » quand `resolutionNotes` est `null` ;
 *   - une dispute **CLOSE PAR LE JOB** (le cas COURANT, voir plus bas) n'attribue rien à un
 *     arbitre et ne sert **jamais** la ligne de log française que le job écrit ;
 *   - le dossier OUVERT : en-tête, pastille, **les deux déclarations contradictoires**, échéance
 *     des 24 h, fil **vide lisible** ;
 *   - le **capitaine** voit le formulaire, le **non-capitaine aligné** ne le voit pas (paire de
 *     checks : chacun empêche l'autre d'être vert par construction) ;
 *   - refus CLIENT d'un type non supporté et d'un fichier > 5 Mo, **sans aucune requête** ;
 *   - un dépôt réel **image** (vignette) puis **PDF** (lien seul, JAMAIS d'`<img>` — un PDF dans
 *     un `<img>` écrit une ligne rouge, motif de rejet du projet) ;
 *   - les **portes d'entrée** : depuis la fiche de match et depuis `ActionRequired` de `/history` ;
 *   - « Next up » de `/home` mène TOUJOURS à la fiche (la généralisation de `MatchLineLink` ne
 *     doit rien changer pour lui) ;
 *   - 375 px : débordement du document **et** largeur rendue du `<h1>` (leçon F-HOME : un
 *     conteneur qui CLIPPE ne déborde jamais).
 *
 * ⚠️ IL EXIGE LA BASE SEMÉE (`docker compose exec backend npm run seed:dev`). La dispute de démo
 * (cs2 5v5, Alpha vs Bravo) est le seul état qui donne un camp de 5 joueurs — donc un
 * **non-capitaine aligné**, que 1v1 ne peut pas produire par construction. Sans seed, le scénario
 * lève : c'est une erreur de HARNAIS (exit 2), jamais un check vert par accident.
 *
 * ⚠️ ET LE SEED SE PÉRIME TOUT SEUL : le job B7 annule la dispute 24 h après son ouverture, semée
 * à `kick-off − 8 h + 82 min`, soit ~17 h de marge. Reséminer avant toute campagne.
 *
 * ⚠️ DEUX USAGES SANCTIONNÉS DE `sql()` — forcer un état que l'API interdit d'atteindre, jamais
 * constater un comportement (le comportement, lui, est lu à l'écran) :
 *   1. **le mot de passe de `dave`**. Le seed ne donne un hash qu'à `alice`/`bob`/`carol` et le
 *      RETIRE activement aux figurants : le seul non-capitaine aligné de la dispute est donc
 *      inconnectable. On lui recopie le hash d'alice, on le remet à `NULL` au teardown **même si
 *      un check échoue**.
 *   2. **la résolution**. `POST /disputes/:id/resolve` est **admin only** et il n'existe AUCUN
 *      compte admin dans les fixtures : aucune séquence HTTP ne mène à `resolved`. On force la
 *      ligne — et on repasse le match dans le statut correspondant avec elle, parce qu'une dispute
 *      `resolved` sur un match resté `disputed` est un état que le domaine ne produit jamais.
 *      🚨 **TROIS états sont forgés, pas un** : arbitrage admin AVEC note, arbitrage admin SANS
 *      note, puis **le timeout du job**, écrit exactement comme `timeoutDisputes()` l'écrit
 *      (`resolution: 'cancelled'`, la note française, `resolved_by_user_id` à **NULL** — c'est de
 *      lui que le back dérive `settledBy`). Le troisième est le CAS COURANT : [F-ADMIN] n'existe
 *      pas, donc rien n'appelle `resolve`, et le timeout est **le seul chemin vers `resolved`**
 *      que le produit sache prendre aujourd'hui. La 1ʳᵉ version ne forgeait que le cas rare, avec
 *      sa propre note anglaise et sans `resolved_by_user_id` — donc `D4`/`D6` étaient verts sur un
 *      état que le produit ne fabrique jamais, pendant que l'écran mentait sur celui qu'il fabrique.
 *
 * 🚨 IL NE TOUCHE JAMAIS À LA DISPUTE SEMÉE AUTREMENT QU'EN Y DÉPOSANT DES PREUVES (nettoyées au
 * teardown). La résoudre casserait `match-detail`, qui exige les 7 états cs2 — c'est pour ça que
 * l'état `resolved` est fabriqué sur une dispute chess 1v1 jetable.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertUuid } from '../sql.mjs';

export const name = 'dispute';
export const surface = '/disputes/$disputeId — dossier, déclarations, fil de preuves, dépôt (F-DISPUTE)';

const UNKNOWN_DISPUTE = '44444444-4444-4444-8444-444444444444';
const MALFORMED_DISPUTE = 'not-a-uuid';

/** Provider exigé par le jeu `chess` (`games.required_provider`, migration 0008). */
const CHESS_PROVIDER = 'chess_com';

/** Comptes semés par `seed-dev.ts`. Mot de passe versionné, le même que `backend/tests/helpers.py`. */
const CAPTAIN = { email: 'alice@dev.local', password: 'Test1234!' };
/**
 * Joueur **ALIGNÉ** dans la dispute semée (compo de Team Alpha) et capitaine de **ni l'un ni
 * l'autre** des deux camps de ce match.
 *
 * ⚠️ IL N'EST PAS SUR LE BANC, et le nom compte : le roster d'Alpha compte 5 joueurs et sa compo
 * en compte 5 aussi, donc **le seed ne produit AUCUN banc**. Ce compte éprouve la même garde
 * (« ni capitaine ni joueur 1v1 d'un camp »), mais qui lirait `BENCHED` croirait le banc couvert.
 */
const ALIGNED_NON_CAPTAIN = { email: 'dave@dev.local', password: 'Test1234!' };

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

/**
 * Le plus petit PDF valide qui soit : catalogue, arbre de pages, une page vide.
 *
 * ⚠️ Écrit dans `fixtures.dir`, le `mkdtemp` du runner — **JAMAIS sous `frontend/`** : Vite y
 * surveille toute l'arborescence et l'écriture d'un fichier, même hors du graphe de modules,
 * déclenche un rechargement complet qui ferait sortir la campagne en exit 2, imputé à un ticket
 * innocent (invariant #10). Le runner supprime le dossier en fin de run.
 *
 * ⚠️ L'extension compte doublement : Playwright dérive le `type` du `File` du NOM du fichier
 * (donc `application/pdf`, ce que valide l'écran), et le serveur range l'objet sous cette
 * extension — c'est elle que la page relit pour refuser de rendre un `<img>`.
 */
function writePdfFixture(dir) {
  const path = join(dir, 'evidence.pdf');
  writeFileSync(
    path,
    '%PDF-1.4\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
  );
  return path;
}

export async function run({
  page,
  setPhase,
  step,
  countRequests,
  expectHttp,
  fixtures,
  createUser,
  user,
  ORIGIN,
  sql,
  login,
  awaitAnnouncement,
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
  /** Toute requête d’API — sert aux refus CLIENT, qui ne doivent en déclencher AUCUNE. */
  const apiCalls = (url) => url.includes('/api/');
  /**
   * La route du dossier, et elle SEULE.
   *
   * ⚠️ `/api/` tout court ne convient PAS pour « l’id malformé ne coûte rien » : un `page.goto`
   * recharge toute la SPA, qui rejoue son bootstrap de session (`POST /auth/refresh` +
   * `GET /users/me`) — deux requêtes légitimes, sans rapport avec la page. Vu ROUGE à 2 avant
   * d’être scopé. Le témoin positif (`D1b`) rejoue EXACTEMENT ce filtre sur un dossier valide,
   * parce que « 0 requête » est aussi ce que mesure un filtre qui ne matche rien (leçon MM10).
   */
  const disputeCalls = (url) => url.includes('/api/disputes');
  const pdfPath = writePdfFixture(fixtures.dir);

  // ------------------------------------------------- §0 la fixture semée + la fixture jetable
  setPhase('0. mise en place (API directe + SQL) : la dispute semée, puis une dispute résolue');

  // Connexion API d'alice : c'est par SES matchs qu'on trouve la dispute de démo. On ne code en
  // dur ni l'uuid du match ni celui de la dispute — ils sont régénérés à chaque seed.
  const captainLogin = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(CAPTAIN),
  });
  if (!captainLogin.ok) {
    throw new Error(
      `login ${CAPTAIN.email} -> ${captainLogin.status} : base de dev non semée ? ` +
        '(docker compose exec backend npm run seed:dev)',
    );
  }
  const captain = { ...CAPTAIN, accessToken: (await captainLogin.json()).accessToken };

  const mine = await api(captain, '/matches/me');
  if (!mine.ok) throw new Error(`GET /matches/me -> ${mine.status}`);
  const { matches } = await mine.json();
  // 🚨 On ne suppose JAMAIS être seul sur la base de dev (leçon [FX-AUDIT]) : on prend la dispute
  // OUVERTE la plus récente d'alice, pas « la première ligne qui contient le mot dispute ».
  const seeded = matches
    .filter((m) => m.status === 'disputed' && m.disputeId && m.disputeStatus === 'open')
    .sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt)))[0];
  if (!seeded) {
    throw new Error(
      "aucun match en litige pour alice : base non semée, ou le job 24 h a déjà annulé la dispute de démo " +
        '(docker compose exec backend npm run seed:dev)',
    );
  }
  const seededDisputeId = assertUuid(seeded.disputeId, 'disputeId semé');
  const seededMatchId = assertUuid(seeded.id, 'matchId semé');

  const ownMatchIds = [];
  /**
   * Les preuves DÉJÀ présentes sur le dossier de démo.
   *
   * 🔑 TOUS LES COMPTAGES DU FIL SONT DES **DELTAS** CONTRE CETTE VALEUR, jamais des nombres
   * absolus : la base de dev est partagée et un coéquipier peut parfaitement avoir déposé une
   * pièce sur ce même dossier (leçon [FX-AUDIT]). Le teardown efface déjà prudemment le delta —
   * des comptages absolus à côté auraient été la contradiction exacte de cette prudence.
   */
  let evidenceBefore = '';
  let preCount = 0;
  // ⚠️ « lu et vide » et « jamais lu » ne se distinguent PAS sur `evidenceBefore` seul, et le
  // teardown en dépend : sans ce drapeau, un `sql()` qui jette avant la lecture laisse la liste
  // vide, donc la suppression du delta part SANS clause d'exclusion et efface le fil entier de
  // la dispute de démo — les preuves d'un coéquipier comprises. On préfère ne rien nettoyer
  // plutôt que de nettoyer ce qui ne nous appartient pas.
  let preCountKnown = false;
  let resolvedDisputeId = null;

  /**
   * ⚠️ LE `try` OUVRE **AVANT** LE `sql()` QUI POSE LE HASH DE `dave`. Il était après : tout ce
   * qui jetait entre les deux (création de compte, ladder introuvable, quota) laissait `dave`
   * **connectable à demeure** sur la base partagée — précisément ce que le teardown jure de ne
   * jamais faire.
   */
  try {
    // Le hash d'alice recopié sur `dave` : le seed ne donne un mot de passe qu'aux 3 capitaines,
    // or le seul NON-capitaine aligné de cette dispute est un figurant. Remis à `NULL` au teardown.
    sql(
      `update users set password_hash = (select password_hash from users where pseudo = 'alice') where pseudo = 'dave';`,
    );

    evidenceBefore = sql(
      `select coalesce(string_agg(id::text, ','), '') from dispute_evidence where dispute_id = '${seededDisputeId}';`,
    );
    preCount = evidenceBefore ? evidenceBefore.split(',').length : 0;
    preCountKnown = true;

    // --- la dispute jetable, chess 1v1, qu'on forcera en `resolved`
    const foe = await createUser();
    const link = (as) =>
      api(as, '/users/me/external-accounts', {
        method: 'POST',
        body: JSON.stringify({ provider: CHESS_PROVIDER, externalId: `AUDIT-${as.stamp}` }),
      });
    // §5.1 — sans compte lié, `validateSide()` refuse le camp en 400 dès la création du slot.
    await link(user);
    await link(foe);

    const laddersRes = await api(user, '/ladders');
    if (!laddersRes.ok) throw new Error(`GET /ladders -> ${laddersRes.status}`);
    const { ladders } = await laddersRes.json();
    const chess = ladders.find((l) => l.gameId === 'chess' && l.format === '1v1');
    if (!chess) {
      throw new Error('aucun ladder chess 1v1 en base — les migrations sont-elles passées ?');
    }

    const created = await api(user, '/matches', {
      method: 'POST',
      body: JSON.stringify({ ladderId: chess.id, scheduledAt: futureQuarter(1) }),
    });
    if (created.status !== 201) {
      throw new Error(`POST /matches -> ${created.status} : ${await created.text()}`);
    }
    const ownMatchId = assertUuid(await created.json().then(({ match }) => match.id), 'matchId');
    ownMatchIds.push(ownMatchId);

    const accepted = await api(foe, `/matches/${ownMatchId}/accept`, { method: 'POST' });
    if (accepted.status !== 200) throw new Error(`accept -> ${accepted.status}`);
    // Le coup d'envoi reculé : `POST /matches` exige un futur, `POST /result` exige un passé —
    // aucune séquence HTTP ne satisfait les deux (recette de `match-result.mjs`).
    sql(`update matches set scheduled_at = now() - interval '1 hour' where id = '${ownMatchId}';`);

    const sheet = await api(user, `/matches/${ownMatchId}`).then((r) => r.json());
    const [sideA, sideB] = sheet.sides;
    // Deux verdicts CONTRADICTOIRES : chacun se déclare vainqueur -> le serveur ouvre la dispute.
    await api(user, `/matches/${ownMatchId}/result`, {
      method: 'POST',
      body: JSON.stringify({ winnerSideId: sideA.id, scoreSelf: 2, scoreOpponent: 0 }),
    });
    const clash = await api(foe, `/matches/${ownMatchId}/result`, {
      method: 'POST',
      body: JSON.stringify({ winnerSideId: sideB.id, scoreSelf: 2, scoreOpponent: 1 }),
    });
    if (clash.status !== 200) throw new Error(`2ᵉ soumission -> ${clash.status}`);

    resolvedDisputeId = assertUuid(
      sql(`select id from disputes where match_id = '${ownMatchId}';`),
      'disputeId jetable',
    );
    /**
     * 🚨 L'usage sanctionné n°2 : `resolve` est admin only et **aucun compte admin n'existe dans
     * les fixtures**. Le match repasse `completed` DANS LE MÊME GESTE — une dispute `resolved` sur
     * un match resté `disputed` est un état que le domaine ne produit jamais, et la page mentirait
     * sur une donnée impossible.
     *
     * 🔑 `resolved_by_user_id` EST POSÉ, ET C'EST LOAD-BEARING. C'est de lui que le back dérive
     * `settledBy` : le laisser à `NULL` — ce que faisait la 1ʳᵉ version — fabriquait un dossier
     * que le contrat lit comme un **timeout**, donc `D4`/`D6` auditaient l'arbitrage humain sur
     * une donnée qui n'en est pas un. N'importe quel utilisateur fait l'affaire (l'écran ne lit
     * que le champ dérivé), alice est simplement la plus proche.
     */
    sql(
      `update disputes set status = 'resolved', resolution = 'side_0_wins', ` +
        `resolution_notes = 'Scoreboard confirms the first camp took the series.', resolved_at = now(), ` +
        `resolved_by_user_id = (select id from users where pseudo = 'alice') ` +
        `where id = '${resolvedDisputeId}';`,
    );
    sql(`update matches set status = 'completed' where id = '${ownMatchId}';`);

    // ------------------------------------------------------------- §1 id malformé : 0 requête
    setPhase('1. id malformé : écran d’erreur et AUCUNE requête');
    const malformedCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/disputes/${MALFORMED_DISPUTE}`, { waitUntil: 'networkidle' });
    }, disputeCalls);
    const malformedScreen = await appears(main.locator('h1:has-text("Invalid dispute link")'));
    step(
      'D1',
      malformedScreen && malformedCalls === 0,
      `écran « Invalid dispute link » : ${malformedScreen}, requêtes /api/disputes ${malformedCalls} (0 attendu — un 400 certain ne se paie pas en ligne rouge)`,
    );

    // ⚠️ Témoin POSITIF : « 0 requête » est aussi ce que mesure un filtre qui ne matche rien
    // (route renommée, `/api` oublié). Le même filtre sur une page valide doit compter > 0.
    setPhase('1b. témoin positif du filtre de comptage');
    const controlCalls = await countRequests(async () => {
      await page.goto(`${ORIGIN}/disputes/${resolvedDisputeId}`, { waitUntil: 'networkidle' });
    }, disputeCalls);
    step(
      'D1b',
      controlCalls > 0,
      `même filtre sur un dossier valide : ${controlCalls} requête(s) /api/disputes (> 0 attendu)`,
    );

    // ------------------------------------------------------------------ §2 uuid inconnu -> 404
    setPhase('2. uuid inconnu : écran 404');
    expectHttp(new RegExp(`/api/disputes/${UNKNOWN_DISPUTE}`), 'écran 404 : c’est l’état testé');
    await page.goto(`${ORIGIN}/disputes/${UNKNOWN_DISPUTE}`, { waitUntil: 'networkidle' });
    const notFound = await appears(main.locator('h1:has-text("Dispute not found")'));
    step('D2', notFound, `écran « Dispute not found » rendu : ${notFound}`);

    // -------------------------------------------------------- §3 non-participant -> écran 403
    setPhase('3. non-participant : écran 403 dédié');
    expectHttp(new RegExp(`/api/disputes/${seededDisputeId}`), 'écran 403 : c’est l’état testé');
    await page.goto(`${ORIGIN}/disputes/${seededDisputeId}`, { waitUntil: 'networkidle' });
    const forbidden = await appears(main.locator('h1:has-text("Reserved for the two camps")'));
    step(
      'D3',
      forbidden,
      `compte tiers sur un dossier qui ne le concerne pas : écran « Reserved for the two camps » ${forbidden} (une erreur ATTENDUE se rend, elle ne laisse pas de ligne rouge)`,
    );

    // ------------------------------------------- §4 dispute RÉSOLUE : lecture seule + verdict
    setPhase('4. dispute résolue : verdict nommé, note d’admin, AUCUN contrôle');
    await page.goto(`${ORIGIN}/disputes/${resolvedDisputeId}`, { waitUntil: 'networkidle' });
    const resolvedOpened = await appears(main.locator('h1'));
    const settledPill = await main.locator('header').locator('text=Settled').count();
    // ⚠️ Le verdict est NOMMÉ, jamais l'enum brut : « side_0_wins » ne veut rien dire pour un
    // lecteur. Le nom du camp vient de `sideName`, la règle partagée.
    const verdictText = await main.locator('text=/was ruled the winner/').count();
    const rawEnum = await main.locator('text=side_0_wins').count();
    const adminNote = await main.locator('text=Scoreboard confirms the first camp').count();
    step(
      'D4',
      resolvedOpened && settledPill === 1 && verdictText === 1 && rawEnum === 0 && adminNote === 1,
      `pastille « Settled » ${settledPill} (1), verdict nommé ${verdictText} (1), enum brut à l’écran ${rawEnum} (0), note d’admin ${adminNote} (1)`,
    );

    // 🚨 LE NÉGATIF QUI GARDE LE MOTIF DE REJET : sur une dispute close, `POST /evidence` répond
    // 409. Un formulaire ici offrirait un bouton dont la requête est certaine d’échouer.
    const closedTextarea = await main.locator('form textarea').count();
    const closedSubmit = await main.locator('button:has-text("File this evidence")').count();
    const closedAttach = await main.locator('button:has-text("Attach a file")').count();
    step(
      'D5',
      closedTextarea === 0 && closedSubmit === 0 && closedAttach === 0,
      `contrôles offerts sur un dossier RÉSOLU : ${closedTextarea} textarea, ${closedSubmit} bouton d’envoi, ${closedAttach} bouton de pièce jointe (0/0/0 attendus)`,
    );

    // Le repli « pas de note » — `resolution_notes` est nullable ET le champ est optionnel sur la
    // route d’arbitrage : un arbitrage sans note est ordinaire. Rien d’autre ne le garde : on
    // retourne la DONNÉE, on ne casse pas le code.
    setPhase('4b. dispute résolue par un ADMIN, sans note');
    sql(`update disputes set resolution_notes = null where id = '${resolvedDisputeId}';`);
    await page.goto(`${ORIGIN}/disputes/${resolvedDisputeId}`, { waitUntil: 'networkidle' });
    const noteFallback = await main.locator('text=The admin left no note with this decision').count();
    const staleNote = await main.locator('text=Scoreboard confirms the first camp').count();
    step(
      'D6',
      noteFallback === 1 && staleNote === 0,
      `repli « no note » ${noteFallback} (1 attendu), ancienne note résiduelle ${staleNote} (0)`,
    );

    /**
     * 🚨 LE CAS COURANT, ET C'EST CELUI QUE LA PAGE RENDAIT FAUX — bloquant de review.
     *
     * `POST /disputes/{id}/resolve` est admin only et **[F-ADMIN] n'existe pas** : aucun écran ne
     * l'appelle. Le **timeout est donc aujourd'hui le SEUL chemin vers `resolved`**, et la dispute
     * de démo l'emprunte toute seule 24 h après un `seed:dev`. Or le job écrit les MÊMES colonnes
     * qu'un arbitre — plus une `resolution_notes` qui est une **ligne de log interne en français**.
     * La page annonçait « Settled by an admin », « the admin could not separate the two camps »,
     * puis servait cette ligne sous le libellé « Admin's note ».
     *
     * On forge donc l'état **exactement comme `timeoutDisputes()` l'écrit**
     * (`backend/src/jobs/index.ts`) : `cancelled`, la note française, et surtout
     * `resolved_by_user_id` à **NULL** — c'est lui dont le back dérive `settledBy`.
     *
     * ⚠️ Le check vise le **bloc de verdict**, pas `<main>` entier : le pied de page dit
     * légitimement « Only an admin can settle a dispute », donc un balayage global de « admin »
     * rougirait sur une copie irréprochable.
     */
    setPhase('4c. dossier clos par le JOB (timeout) : aucun arbitre, aucune note de log');
    sql(
      `update disputes set resolution = 'cancelled', ` +
        `resolution_notes = 'auto-résolu : aucun arbitrage admin sous 24 h', ` +
        `resolved_by_user_id = null where id = '${resolvedDisputeId}';`,
    );
    sql(`update matches set status = 'cancelled' where id = '${ownMatchIds[0]}';`);
    await page.goto(`${ORIGIN}/disputes/${resolvedDisputeId}`, { waitUntil: 'networkidle' });

    const timeoutBox = main.locator('p:has-text("Cancelled automatically")');
    // COMPTER AVANT DE LIRE : `innerText()` sur un locator vide LÈVE -> exit 2.
    const timeoutCount = await timeoutBox.count();
    const timeoutText = timeoutCount === 1 ? await timeoutBox.innerText() : '';
    const blamesAdmin = /admin/i.test(timeoutText);
    const noteBlock = await main.getByText(/admin.s note/i).count();
    const frenchLog = await main.getByText(/aucun arbitrage admin/i).count();
    const autoSentence = await main.getByText(/Nobody settled this dispute within 24 hours/i).count();
    step(
      'D6b',
      timeoutCount === 1 &&
        !blamesAdmin &&
        noteBlock === 0 &&
        frenchLog === 0 &&
        autoSentence === 1,
      `dossier clos par le job : encadré « Cancelled automatically » ${timeoutCount} (1 attendu), il attribue à un admin : ${blamesAdmin} (false attendu), bloc « Admin's note » ${noteBlock} (0 attendu), ligne de log française à l’écran ${frenchLog} (0 attendu), phrase « Nobody settled this dispute… » ${autoSentence} (1 attendu)`,
    );

    // ------------------------------------------------- §5 le dossier OUVERT, vu par un capitaine
    // ⚠️ Bascule de compte : `/login` REDIRIGE vers `/home` tant qu’une session existe, donc
    // `login()` échouerait sur un `#email` introuvable — et un sélecteur qui expire sort en
    // exit 2. On vide les cookies d’abord (même idiome que `match-detail`).
    await page.context().clearCookies();
    await login(captain);

    setPhase('5. le dossier ouvert : déclarations, échéance, fil vide');
    await page.goto(`${ORIGIN}/disputes/${seededDisputeId}`, { waitUntil: 'networkidle' });
    const opened = await appears(main.locator('h1'));
    const openPill = await main.locator('header').locator('text=Open dispute').count();
    step('D7', opened && openPill === 1, `dossier rendu : ${opened}, pastille « Open dispute » ${openPill} (1 attendue)`);

    // Les DEUX déclarations, face à face, et chacune NOMME le camp qu’elle dit vainqueur.
    const claimCards = await main.locator('ul[aria-label="Reported results"] > li').count();
    const claims = await main.locator('ul[aria-label="Reported results"] > li p:has-text("Claims")').count();
    const contradiction = await main.locator('text=The two camps named different winners').count();
    step(
      'D8',
      claimCards === 2 && claims === 2 && contradiction === 1,
      `déclarations : ${claimCards} camps (2), ${claims} verdicts annoncés (2), phrase de contradiction ${contradiction} (1)`,
    );

    // L’échéance des 24 h — la seule information qui dise qu’attendre COÛTE le match. On lit le
    // texte et on y cherche une DURÉE, pas juste la présence d’une phrase.
    // ⚠️ `count()` avant `innerText()` : lire un locator vide LÈVE, ce qui sortirait en exit 2
    // (« harnais en échec ») au lieu d’un rouge imputable au ticket.
    const deadlineBox = main.locator('p:has-text("cancelled automatically and counts for nothing")');
    const deadlineCount = await deadlineBox.count();
    const deadlineText = deadlineCount === 1 ? await deadlineBox.innerText() : '';
    // `formatDuration` rend « 17 h 22 min » / « 3 d 5 h » — l’unité est portée par les DEUX
    // nombres, donc jamais lisible comme l’horaire « 17:22 » (le piège de F-HOME).
    const hasDuration = /\d+\s(h|min|d)\b/.test(deadlineText) && /left\./.test(deadlineText);
    step(
      'D9',
      deadlineCount === 1 && hasDuration,
      `échéance des 24 h : ${deadlineCount} encadré (1 attendu), durée lisible dans « ${deadlineText.slice(-70) || '—'} » : ${hasDuration}`,
    );

    /**
     * Le fil VIDE est l’état de départ NORMAL d’une dispute, pas une panne : il doit se lire.
     *
     * ⚠️ COMPTÉ EN DELTA, pas en absolu. Le dossier de démo est sur la base PARTAGÉE et un
     * coéquipier peut y avoir déposé une pièce (leçon [FX-AUDIT]) ; un `=== 0` en dur aurait
     * contredit le teardown, qui n’efface justement que le delta. L’encadré « rien n’a encore été
     * déposé » n’est alors attendu que si le fil est réellement vide — la branche exercée est
     * imprimée dans le message pour qu’un run reste lisible dans les deux cas.
     */
    const emptyThread = await main.locator('text=Nothing has been filed yet').count();
    const threadItems = await main.locator('ul[aria-label="Evidence filed"] > li').count();
    const expectedEmptyNotice = preCount === 0 ? 1 : 0;
    step(
      'D10',
      emptyThread === expectedEmptyNotice && threadItems === preCount,
      `fil au départ : ${threadItems} ligne(s) (${preCount} préexistante(s) attendue(s)), encadré « rien n’a été déposé » ${emptyThread} (${expectedEmptyNotice} attendu${preCount === 0 ? ' — fil réellement vide' : ' — le dossier porte déjà des preuves d’un coéquipier'})`,
    );

    // Le POSITIF de la paire capitaine / non-capitaine (D16 en est le négatif).
    const textarea = await main.locator('form textarea').count();
    const attachButton = await main.locator('button:has-text("Attach a file")').count();
    const fileButton = await main.locator('button:has-text("File this evidence")').count();
    step(
      'D11',
      textarea === 1 && attachButton === 1 && fileButton === 1,
      `formulaire offert au CAPITAINE : ${textarea} textarea (1), ${attachButton} bouton de pièce jointe (1), ${fileButton} bouton d’envoi (1)`,
    );

    // ------------------------------------------------ §6 refus CLIENT : aucune requête réseau
    setPhase('6. refus client : type non supporté, puis fichier > 5 Mo');
    const fileInput = main.locator('input[type="file"]');

    const badCalls = await countRequests(async () => {
      await fileInput.setInputFiles(fixtures.bad);
      await appears(main.locator('text=Attach a PNG, JPEG or WebP image, or a PDF'));
    }, apiCalls);
    const badMessage = await main.locator('text=Attach a PNG, JPEG or WebP image, or a PDF').count();
    step(
      'D12',
      badMessage === 1 && badCalls === 0,
      `GIF refusé côté client : message ${badMessage} (1 attendu), requêtes /api/ ${badCalls} (0 attendu)`,
    );

    const bigCalls = await countRequests(async () => {
      await fileInput.setInputFiles(fixtures.big);
      await appears(main.locator('text=This file is too large'));
    }, apiCalls);
    const bigMessage = await main.locator('text=This file is too large').count();
    step(
      'D13',
      bigMessage === 1 && bigCalls === 0,
      `fichier > 5 Mo refusé côté client : message ${bigMessage} (1 attendu), requêtes /api/ ${bigCalls} (0 attendu)`,
    );

    // ------------------------------------------------------ §7 dépôt réel : une image, un PDF
    setPhase('7. dépôt d’une IMAGE : vignette dans le fil');
    await fileInput.setInputFiles(fixtures.ok);
    await main.locator('form textarea').fill('Scoreboard screenshot from the third map.');
    await main.locator('button:has-text("File this evidence")').click();
    // ⚠️ La région live est MONTÉE EN PERMANENCE : attendre sa présence n’attend rien, on lirait
    // du vide ou l’annonce précédente. On attend le TEXTE (invariant #11).
    const filedAnnounced = await awaitAnnouncement('Evidence filed');
    // Delta, jamais un absolu : voir `D10`. Ce qui est prouvé ici est « UNE ligne de plus ».
    const imageRows = await main.locator('ul[aria-label="Evidence filed"] > li').count();
    // Scopée à MA ligne : une preuve laissée par un coéquipier serait une image elle aussi.
    const myImageRow = main
      .locator('ul[aria-label="Evidence filed"] > li')
      .filter({ hasText: 'Scoreboard screenshot from the third map' });
    const myImageRows = await myImageRow.count();
    const imageThumb = myImageRows === 1 ? await myImageRow.locator('img').count() : -1;
    const imageLink =
      myImageRows === 1
        ? await myImageRow.locator('a:has-text("Open the attachment (PNG)")').count()
        : 0;
    step(
      'D14',
      filedAnnounced &&
        imageRows === preCount + 1 &&
        myImageRows === 1 &&
        imageThumb === 1 &&
        imageLink === 1,
      `annonce « Evidence filed » : ${filedAnnounced}, fil à ${imageRows} ligne(s) (${preCount + 1} attendues = préexistantes + 1), ma ligne ${myImageRows} (1), vignette ${imageThumb} (1), lien « Open the attachment (PNG) » ${imageLink} (1)`,
    );

    setPhase('8. dépôt d’un PDF : lien seul, JAMAIS d’<img>');
    await fileInput.setInputFiles(pdfPath);
    await main.locator('form textarea').fill('Match export as a PDF, page 1.');
    await main.locator('button:has-text("File this evidence")').click();
    const pdfRow = main.locator('ul[aria-label="Evidence filed"] > li').filter({
      hasText: 'Match export as a PDF',
    });
    const pdfShown = await appears(pdfRow);
    const pdfLink = (await pdfRow.count()) === 1
      ? await pdfRow.locator('a:has-text("Open the attachment (PDF)")').count()
      : 0;

    /**
     * 🚨 LE CHECK CENTRAL DU RENDU, ET IL A ÉTÉ VU **VERT PAR CONSTRUCTION** AVANT D’ÊTRE
     * RÉÉCRIT — quatrième fois que ce piège tombe dans ce harnais.
     *
     * La version naïve comptait les `<img>` de la ligne PDF. Or `EvidenceAttachment` porte un
     * `onError` qui RETIRE l’image dès qu’elle échoue à se décoder : sur un build volontairement
     * cassé (`isImage = true` pour tout), l’`<img>` était bien rendu, le PDF bien téléchargé…
     * et le check lisait le DOM APRÈS la bascule, donc **0 `<img>`, vert**. Il serait resté vert
     * le jour où la règle asymétrique aurait sauté.
     *
     * On compte donc la **REQUÊTE** vers l’objet `.pdf`, qu’aucun gestionnaire d’erreur ne peut
     * reprendre : le lien n’est pas suivi, donc le fichier ne doit JAMAIS être demandé au
     * chargement de la page. Le témoin positif est `D15b` — la preuve PNG, elle, DOIT l’être,
     * sinon « 0 requête » ne serait que la mesure d’un filtre qui ne matche rien.
     */
    const mediaFor = (ext) => (url) => url.includes('/media/') && url.includes(`.${ext}`);
    const pdfFetches = await countRequests(async () => {
      await page.goto(`${ORIGIN}/disputes/${seededDisputeId}`, { waitUntil: 'networkidle' });
      await appears(pdfRow);
    }, mediaFor('pdf'));
    step(
      'D15',
      pdfShown && pdfLink === 1 && pdfFetches === 0,
      `preuve PDF : lien « Open the attachment (PDF) » ${pdfLink} (1 attendu), requêtes vers l’objet .pdf au chargement ${pdfFetches} (0 attendu — un <img> sur un PDF le téléchargerait pour n’afficher qu’une image cassée)`,
    );

    const pngFetches = await countRequests(async () => {
      await page.goto(`${ORIGIN}/disputes/${seededDisputeId}`, { waitUntil: 'networkidle' });
      await appears(main.locator('a:has-text("Open the attachment (PNG)")'));
    }, mediaFor('png'));
    step(
      'D15b',
      pngFetches > 0,
      `témoin positif : requêtes vers l’objet .png au chargement ${pngFetches} (> 0 attendu — c’est la vignette, et c’est ce qui prouve que le filtre de D15 matche quelque chose)`,
    );

    // ------------------------------------------------------------ §9 portes d’entrée
    setPhase('9. porte d’entrée : depuis la fiche de match');
    await page.goto(`${ORIGIN}/matches/${seededMatchId}`, { waitUntil: 'networkidle' });
    const sheetLink = main.locator('a:has-text("Open the dispute file")');
    const sheetLinkCount = await sheetLink.count();
    if (sheetLinkCount === 1) await sheetLink.click();
    // ⚠️ Un PRÉDICAT sur la cible exacte, jamais un motif : `waitForURL(/\/disputes\//)` rend la
    // main immédiatement quand l’URL courante matche déjà (leçon FX-ROW).
    const reachedFromSheet =
      sheetLinkCount === 1 &&
      (await page
        .waitForURL((url) => url.pathname === `/disputes/${seededDisputeId}`, { timeout: 10000 })
        .then(() => true)
        .catch(() => false));
    step(
      'D16',
      reachedFromSheet,
      `fiche de match -> dossier : lien « Open the dispute file » ${sheetLinkCount} (1 attendu), arrivée sur /disputes/${seededDisputeId} : ${reachedFromSheet}`,
    );

    // Le NÉGATIF jumeau : le lien ne doit exister QUE sur un match en litige. Sans lui, D16 serait
    // vert sur un `MatchStateNotice` qui aurait gagné le lien dans tous ses états.
    setPhase('9b. la fiche d’un match NON litigieux ne porte aucun lien de dossier');
    const otherMatch = matches.find((m) => m.status === 'completed');
    let strayLinks = -1;
    if (otherMatch) {
      await page.goto(`${ORIGIN}/matches/${otherMatch.id}`, { waitUntil: 'networkidle' });
      await appears(main.locator('h1'));
      strayLinks = await main.locator('a[href^="/disputes/"]').count();
    }
    step(
      'D17',
      strayLinks === 0,
      `liens vers un dossier sur un match terminé : ${strayLinks} (0 attendu ; -1 = aucun match terminé trouvé)`,
    );

    setPhase('10. porte d’entrée : depuis « Matches on the clock » de /history');
    await page.goto(`${ORIGIN}/history`, { waitUntil: 'networkidle' });
    await appears(main.locator('ul[aria-label="Matches on the clock"]'));
    const clockLinks = main.locator('ul[aria-label="Matches on the clock"] a');
    const clockCount = await clockLinks.count();
    // COMPTER AVANT DE LIRE : `getAttribute()` sur un locator vide LÈVE -> exit 2.
    const hrefs = clockCount > 0 ? await clockLinks.evaluateAll((els) => els.map((e) => e.getAttribute('href'))) : [];
    const toDispute = hrefs.filter((h) => h === `/disputes/${seededDisputeId}`).length;
    const toSheet = hrefs.filter((h) => h?.startsWith('/matches/')).length;
    step(
      'D18',
      toDispute === 1 && toSheet >= 1,
      `« Matches on the clock » : ${clockCount} lignes, dont ${toDispute} vers le dossier (1 attendu) et ${toSheet} vers une fiche (≥ 1 attendu — la ligne « awaiting_confirmation » ne doit PAS bouger)`,
    );

    /**
     * 🔑 LE DOM DE « NEXT UP » NE DOIT PAS AVOIR BOUGÉ. `MatchLineLink` a gagné une destination
     * paramétrable ; ce check garde que la section qui ne l’utilise pas mène TOUJOURS à la fiche.
     *
     * ⚠️ SA 1ʳᵉ VERSION NE GARDAIT PAS LA CARTE VEDETTE — bloquant de review. Elle visait
     * `h2:has-text("Next up") ~ a`, qui résout **0 élément** : `SectionTitle` enferme son `<h2>`
     * dans un `<div>`, donc la carte est sœur de ce `<div>`, jamais du `<h2>`. Or la carte vedette
     * est le **premier** des deux sites d’appel modifiés par ce ticket, et **le seul qui porte un
     * `ariaLabel`**. On la cible donc par une relation RÉELLE : son nom accessible, qui commence
     * par « Next match: » (`UpcomingMatches.tsx`).
     *
     * ⚠️ ET LA LISTE « Later matches » EST FACULTATIVE. L’ancienne version exigeait au moins un
     * lien : le jour où alice n’a qu’un seul match à venir, la liste disparaît légitimement et le
     * check sortait rouge sans le moindre défaut. Ce run-là ne tenait que grâce à des créneaux de
     * démo posés à la main par un coéquipier — exactement la dépendance que [FX-AUDIT] interdit.
     * Seule la carte vedette est exigée ; la liste n’est vérifiée que si elle existe.
     */
    setPhase('10b. « Next up » de /home mène toujours à la fiche de match');
    await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
    const featured = main.getByRole('link', { name: /^Next match:/ });
    const featuredShown = await appears(featured);
    const featuredCount = await featured.count();
    // COMPTER AVANT DE LIRE : `getAttribute()` sur un locator vide LÈVE -> exit 2.
    const featuredHref = featuredCount === 1 ? await featured.getAttribute('href') : null;
    const featuredOk = featuredCount === 1 && Boolean(featuredHref?.startsWith('/matches/'));

    const laterLinks = main.locator('ul[aria-label="Later matches"] a');
    const laterCount = await laterLinks.count();
    const laterHrefs =
      laterCount > 0
        ? await laterLinks.evaluateAll((els) => els.map((e) => e.getAttribute('href')))
        : [];
    const laterOk = laterHrefs.every((h) => h?.startsWith('/matches/'));

    step(
      'D19',
      featuredShown && featuredOk && laterOk,
      `« Next up » : carte vedette ${featuredCount} (1 exigée) -> « ${featuredHref ?? '—'} » (/matches/ attendu), et ${laterHrefs.length} ligne(s) « Later matches » (facultatives) toutes vers /matches/ : ${laterOk}`,
    );

    // ------------------------------------------------------------- §11 largeurs contraintes
    // 🔑 DEUX largeurs, pas une : 375 px est le mobile, mais la DoD nomme aussi ~625 px — ce que
    // mesurera la colonne centrale une fois le rail social ([FS-0]) mergé. Elle était vérifiée à
    // la main en review et gardée par rien ; c'est précisément le genre de largeur qui casse
    // SANS que le mobile bronche (le point de rupture `sm` est franchi dans l'autre sens).
    setPhase('11. 625 px et 375 px : rien ne déborde, et le titre est réellement rendu');
    const widthResults = [];
    for (const width of [625, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${ORIGIN}/disputes/${seededDisputeId}`, { waitUntil: 'networkidle' });
      const opened = await appears(main.locator('h1'));
      const docOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // 🚨 LA LEÇON F-HOME : le `<h1>` vit dans un panneau qui CLIPPE, et un conteneur qui clippe ne
      // déborde JAMAIS — mesurer le document seul serait vert par construction. Ici le titre porte
      // DEUX noms d’équipe de 30 caractères insécables, donc deux fois le risque de F-HOME.
      const headingOverflow = opened
        ? await main.locator('h1').evaluate((el) => el.scrollWidth - el.clientWidth)
        : -1;
      widthResults.push({ width, opened, docOverflow, headingOverflow });
    }
    step(
      'D20',
      widthResults.every((r) => r.opened && r.docOverflow <= 0 && r.headingOverflow <= 0),
      widthResults
        .map(
          (r) =>
            `${r.width} px : document ${r.docOverflow} px (≤ 0), <h1> RENDU ${r.headingOverflow} px (≤ 0)`,
        )
        .join(' | '),
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    // ------------------------------------- §12 le NON-CAPITAINE : lit tout, ne peut rien faire
    await page.context().clearCookies();
    await login(ALIGNED_NON_CAPTAIN);

    setPhase('12. joueur aligné mais NON capitaine : dossier lisible, AUCUN contrôle');
    await page.goto(`${ORIGIN}/disputes/${seededDisputeId}`, { waitUntil: 'networkidle' });
    const readerOpened = await appears(main.locator('h1'));
    // ⚠️ LES DEUX FACES, sinon le check ne garde rien : « 0 formulaire » serait vert même si le
    // dossier entier avait cessé de se rendre. La lecture est un DROIT ici (la garde serveur
    // ouvre `GET /disputes/:id` à tout participant, banc compris) — seule l’écriture est fermée.
    const readerClaims = await main.locator('ul[aria-label="Reported results"] > li').count();
    // Delta (voir `D10`) : les 2 preuves que CE run vient de déposer, plus les préexistantes.
    const readerThread = await main.locator('ul[aria-label="Evidence filed"] > li').count();
    const readerTextarea = await main.locator('form textarea').count();
    const readerSubmit = await main.locator('button:has-text("File this evidence")').count();
    const readerAttach = await main.locator('button:has-text("Attach a file")').count();
    step(
      'D21',
      readerOpened &&
        readerClaims === 2 &&
        readerThread === preCount + 2 &&
        readerTextarea === 0 &&
        readerSubmit === 0 &&
        readerAttach === 0,
      `non-capitaine ALIGNÉ : dossier rendu ${readerOpened}, ${readerClaims} déclarations (2) et ${readerThread} preuves (${preCount + 2} attendues = préexistantes + les 2 de ce run) — il LIT ; contrôles ${readerTextarea}/${readerSubmit}/${readerAttach} (0/0/0 — il n’ÉCRIT pas)`,
    );

    // ------------------------------------- §13 l’échéance passée retire le formulaire (course F-MM)
    /**
     * 🔑 LE DERNIER CHEMIN VERS UN 4xx OFFERT PAR UN BOUTON, et il n’a besoin d’aucune course : le
     * job B7 annule la dispute 24 h après son ouverture, un onglet resté ouvert traverse cette
     * échéance avec un `status: 'open'` PÉRIMÉ en cache, le formulaire reste offert, le clic répond
     * **409** — une ligne rouge, motif de rejet. `Math.max(useSlotClock(), dataUpdatedAt)` est ce
     * qui le ferme ; `dataUpdatedAt` seul en serait incapable (c’est l’instant où le serveur a
     * appliqué la même règle, il ne peut pas contredire sa propre réponse).
     *
     * ⚠️ SEULE L’HORLOGE DU CLIENT AVANCE : le serveur ne voit rien, la dispute reste `open` en
     * base, et le job n’annule pas la donnée de démo. C’est le seul moyen de produire l’état sans
     * reculer `created_at` — ce qui aurait fait annuler la dispute semée par le job en moins de
     * 60 s (TICK_MS), donc cassé `match-detail` et rendu ce check flaky par-dessus le marché.
     *
     * ⚠️ EN TOUTE DERNIÈRE PHASE, À DESSEIN : une horloge factice n’est pas désinstallable, et
     * `resume()` repartirait de « +25 h » — ce qui ferait paraître l’échéance de la dispute semée
     * expirée pour toutes les phases suivantes. Il n’y en a plus.
     *
     * ⚠️ Sous `try/catch` (idiome de `MM16`) : une panne du pilotage d’horloge doit faire ROUGIR CE
     * check, jamais sortir le harnais en exit 2.
     */
    await page.context().clearCookies();
    await login(captain);

    setPhase('13. échéance des 24 h dépassée : le formulaire se retire de lui-même');
    let beforeDeadline = -1;
    let afterDeadline = -1;
    let closedNotice = -1;
    // ⚠️ UN SEUL `step('D23')` PAR RUN. Un simple `if (beforeDeadline !== -1)` après le `catch` ne
    // suffisait pas : une panne survenant APRÈS le premier `count()` laissait la variable
    // renseignée, donc le check était compté DEUX fois — deux entrées pour un id, et un total de
    // checks qui dérive sans que rien ne le signale.
    let clockReported = false;
    try {
      await page.clock.install();
      await page.goto(`${ORIGIN}/disputes/${seededDisputeId}`, { waitUntil: 'networkidle' });
      // Le POSITIF, repris sur le MÊME chargement : sans lui, « 0 formulaire » serait vert pour
      // n’importe quelle raison (sélecteur périmé, dossier qui ne se rend plus).
      await appears(main.locator('form textarea'));
      beforeDeadline = await main.locator('form textarea').count();

      // On saute au-delà des 24 h, puis on laisse passer UN tick de `useSlotClock` (30 s).
      // `setSystemTime` + `runFor` plutôt qu’un `fastForward` de 25 h : ce dernier rejouerait
      // 3 000 callbacks d’intervalle, donc 3 000 rendus, pour le même effet.
      await page.clock.setSystemTime(new Date(Date.now() + 25 * 60 * 60 * 1000));
      await page.clock.runFor(31_000);
      await appears(main.locator('text=The window has closed'));

      afterDeadline = await main.locator('form textarea').count();
      closedNotice = await main.locator('text=The window has closed').count();
    } catch (err) {
      clockReported = true;
      step('D23', false, `pilotage d’horloge impossible : ${err.message}`);
    }
    if (!clockReported) {
      step(
        'D23',
        beforeDeadline === 1 && afterDeadline === 0 && closedNotice === 1,
        `formulaire avant l’échéance ${beforeDeadline} (1 attendu), après ${afterDeadline} (0 attendu — l’API répondrait 409), avis « The window has closed » ${closedNotice} (1 attendu)`,
      );
    }
  } finally {
    // --------------------------------------------------------------------- §13 teardown
    // Exécuté MÊME si un check a échoué : sinon le premier run raté laisserait des comptes
    // indéracinables, un `dave` connectable et des preuves qui s’accumulent sur le dossier de démo.
    setPhase('13. teardown : preuves déposées, mot de passe de dave, matchs jetables');
    // ⚠️ La page est ENCORE OUVERTE ici (le runner ne ferme le navigateur qu’après `run()`) : on la
    // vide avant de supprimer quoi que ce soit, sinon une invalidation en vol refetche un dossier
    // disparu et écrit un 404 dans la console, imputé à cette phase de nettoyage.
    await page.goto('about:blank').catch(() => {});

    try {
      // 1) Le mot de passe de `dave` : remis à NULL, l’état exact que le seed produit.
      sql(`update users set password_hash = null where pseudo = 'dave';`);

      // 2) Les preuves déposées par CE run, jamais celles d’un coéquipier : on efface le delta.
      const keep = evidenceBefore
        ? evidenceBefore
            .split(',')
            .map((id) => `'${assertUuid(id, 'evidence préexistante')}'`)
            .join(', ')
        : null;
      // 🚨 On ne supprime QUE si l'inventaire de départ a réellement été lu (`preCountKnown`) :
      //    sinon `keep` vaut `null` et la requête n'a plus d'exclusion du tout.
      if (preCountKnown) {
        sql(
          `delete from dispute_evidence where dispute_id = '${seededDisputeId}'` +
            (keep ? ` and id not in (${keep});` : ';'),
        );
      }
      const leftOnSeed = sql(
        `select count(*) from dispute_evidence where dispute_id = '${seededDisputeId}';`,
      );

      // 3) Les matchs jetables. `cancelled` + `winner_side_id = null` d’abord : c’est ce qui rend
      //    les comptes supprimables par `deleteAuditUser()` (`ENGAGING_STATUSES`), et
      //    `matches.winner_side_id` -> `match_sides.id` est une référence CIRCULAIRE qu’il faut
      //    casser avant le delete. Puis les notifications, qui n’ont AUCUNE FK vers `matches` et
      //    visent aussi de VRAIS comptes admin de la base de dev.
      let leftOwn = '0';
      if (ownMatchIds.length > 0) {
        const ids = ownMatchIds.map((id) => `'${id}'`).join(', ');
        sql(`update matches set status = 'cancelled', winner_side_id = null where id in (${ids});`);
        sql(`delete from notifications where (data->>'matchId')::uuid in (${ids});`);
        sql(`delete from matches where id in (${ids});`);
        leftOwn = sql(
          `select (select count(*) from matches where id in (${ids}))
                + (select count(*) from disputes where match_id in (${ids}))
                + (select count(*) from notifications where (data->>'matchId')::uuid in (${ids}));`,
        );
      }

      const davePwd = sql(`select password_hash is null from users where pseudo = 'dave';`);
      step(
        'D22',
        leftOnSeed === String(preCount) && leftOwn === '0' && davePwd === 't',
        `teardown : ${leftOnSeed} preuve(s) restantes sur le dossier semé (${preCount} attendue(s) — les préexistantes, jamais touchées), ${leftOwn} ligne(s) jetable(s) résiduelles (0 attendu), mot de passe de dave remis à NULL : ${davePwd === 't'}`,
      );
    } catch (err) {
      // ⚠️ Une exception de teardown ne doit JAMAIS écraser celle qui a interrompu le run : le
      // rapport afficherait « SQL refusé… » à la place de la vraie cause. On la rend visible en
      // ROUGE — donc en exit 1, imputable — sans la laisser remonter.
      step('D22', false, `teardown interrompu : ${err.message}`);
    }
  }
}
