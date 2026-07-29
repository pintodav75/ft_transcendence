/**
 * `/matches/$matchId` — FT-4A, la fiche de match EN LECTURE.
 *
 * Ce qui est vérifié ici :
 *   - un matchId malformé rend un ÉCRAN D'ERREUR et ne consomme AUCUNE requête (le front
 *     applique la même règle uuid que le back : un 400 certain ne se paie pas en ligne rouge) ;
 *   - un uuid inconnu rend l'écran 404 (déclaré via `expectHttp` : c'est l'état testé) ;
 *   - un VISITEUR (compte neuf du run, participant d'aucun match) lit un match TERMINÉ :
 *     score, vainqueur marqué, maps servies par l'API, lineups nominatives, Elo par CAMP ;
 *   - le match 1v1 terminé n'a AUCUN bloc équipe et AUCUNE section maps — chess n'a pas de
 *     pool, et c'est la DONNÉE qui décide, jamais une liste de jeux en dur ;
 *   - le même visiteur sur un match NON terminé prend un 403 et l'écran « réservé aux
 *     participants » (déclaré via `expectHttp`, cloisonné à sa phase) ;
 *   - un MEMBRE (alice, capitaine de Team Alpha) lit un match à venir et un match en attente
 *     de confirmation — avec le compte à rebours de 24 h et, depuis [FT-4B], le choix
 *     « Confirmer / Contester » offert au camp qui n'a pas encore répondu, la saisie
 *     elle-même restant une disclosure FERMÉE (aucun formulaire déployé tant qu'on ne l'a
 *     pas demandé) ;
 *   - depuis la page équipe, un membre ouvre la fiche de TOUTES ses lignes d'historique
 *     (avant FT-4A, seules les lignes terminées étaient cliquables) ;
 *   - rien ne déborde horizontalement à 375 px, et le nom d'un camp y est réellement rendu.
 *
 * ⚠️ CE SCÉNARIO EXIGE LA BASE SEMÉE (`docker compose exec backend npm run seed:dev`) : les
 * sept états du cycle ne sont pas fabricables par un scénario (il faut deux équipes, une
 * acceptation, deux soumissions concordantes et un `scheduledAt` passé). L'absence de seed
 * est donc une erreur de HARNAIS (exit 2) et non un check rouge : sans donnée, la moitié des
 * checks sortirait verte par accident.
 */
export const name = 'match-detail';
export const surface = '/matches/$matchId — 400/403/404, sept états, 1v1, historique cliquable';

const UNKNOWN_MATCH = '33333333-3333-4333-8333-333333333333';

/**
 * Compte semé par `seed-dev.ts`, capitaine de Team Alpha : c'est le seul moyen d'atteindre
 * un match NON terminé (un tiers y prend 403, ce que la phase 4 vérifie justement).
 * ⚠️ Le mot de passe est celui, versionné, des fixtures — le même que `backend/tests/helpers.py`.
 */
const MEMBER = { email: 'alice@dev.local', password: 'Test1234!' };

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
 * Les matchs de démo, lus par NODE (pas par le navigateur) : ces appels ne passent donc pas
 * par la console auditée. C'est la source de vérité contre laquelle on compare l'écran.
 */
async function fetchDemoMatches(ORIGIN) {
  const res = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(MEMBER),
  });
  if (!res.ok) {
    throw new Error(
      `login ${MEMBER.email} -> ${res.status} : base de dev non semée ? ` +
        '(docker compose exec backend npm run seed:dev)',
    );
  }
  const { accessToken } = await res.json();
  const auth = { authorization: `Bearer ${accessToken}` };

  const mine = await fetch(`${ORIGIN}/api/matches/me`, { headers: auth });
  if (!mine.ok) throw new Error(`GET /matches/me -> ${mine.status}`);
  const { matches } = await mine.json();

  // On enrichit chaque match de son DÉTAIL : c'est lui qui dit si le camp porte une équipe
  // (2v2+) ou non (1v1), donc c'est lui qui trie les deux matchs terminés.
  const detailed = [];
  for (const match of matches) {
    const res = await fetch(`${ORIGIN}/api/matches/${match.id}`, { headers: auth });
    if (!res.ok) continue;
    detailed.push({ ...match, detail: await res.json() });
  }

  const byStatus = (status) => detailed.filter((m) => m.status === status);
  const completed = byStatus('completed');
  const running = byStatus('in_progress');

  return {
    accessToken,
    // Le match d'équipe terminé : cs2 5v5, donc AVEC maps et AVEC lineups.
    teamCompleted: completed.find((m) => m.detail.sides.some((s) => s.team !== null)),
    // Le match 1v1 terminé : les deux camps sont des JOUEURS (`team: null`).
    soloCompleted: completed.find((m) => m.detail.sides.every((s) => s.team === null)),
    // Accepté mais pas encore joué (`scheduledAt` dans le futur) vs coup d'envoi passé.
    upcoming: running.find((m) => new Date(m.scheduledAt).getTime() > Date.now()),
    live: running.find((m) => new Date(m.scheduledAt).getTime() <= Date.now()),
    awaiting: byStatus('awaiting_confirmation')[0],
    disputed: byStatus('disputed')[0],
    openSlot: byStatus('pending')[0],
    // Un créneau que personne n'a pris et que le ménage a annulé : MÊME FORME que le créneau
    // ouvert (un seul side). C'est tout l'intérêt — il prouve que la fiche lit le STATUT et
    // ne déduit pas « encore acceptable » de l'absence d'adversaire.
    cancelled: byStatus('cancelled')[0],
  };
}

export async function run({ page, setPhase, step, countRequests, expectHttp, login, ORIGIN }) {
  const demo = await fetchDemoMatches(ORIGIN);
  const missing = [
    'teamCompleted',
    'soloCompleted',
    'upcoming',
    'live',
    'awaiting',
    'disputed',
    'openSlot',
    'cancelled',
  ].filter((key) => !demo[key]);
  if (missing.length > 0) {
    // Volontairement une erreur de HARNAIS (exit 2) : sans ces états, les checks ne
    // mesureraient rien et sortiraient verts par accident.
    throw new Error(
      `états de démo absents (${missing.join(', ')}) — relancer : ` +
        'docker compose exec backend npm run seed:dev',
    );
  }

  const main = page.locator('main');

  setPhase('1. matchId malformé -> écran d’erreur, zéro requête');
  const calls = await countRequests(
    async () => {
      await page.goto(`${ORIGIN}/matches/not-a-uuid`, { waitUntil: 'networkidle' });
      await appears(page.locator('text=Invalid match link'));
    },
    (url) => url.includes('/api/matches/'),
  );
  step('M1', calls === 0, `appels /api/matches/… déclenchés : ${calls} (0 attendu)`);
  step(
    'M1b',
    page.url().endsWith('/matches/not-a-uuid'),
    `pas de redirection : ${new URL(page.url()).pathname}`,
  );

  setPhase('2. uuid inconnu -> écran 404');
  // Le 404 est L'OBJET du test : on le déclare pour qu'il soit listé à part au lieu d'être
  // imputé au ticket. Motif restreint à cet uuid précis, jamais à la route /matches/.
  expectHttp(new RegExp(UNKNOWN_MATCH), 'match inexistant demandé volontairement -> 404 attendu');
  await page.goto(`${ORIGIN}/matches/${UNKNOWN_MATCH}`, { waitUntil: 'networkidle' });
  const notFound = await appears(page.locator('text=Match not found'));
  step(
    'M2',
    notFound && page.url().includes(UNKNOWN_MATCH),
    `écran 404 rendu = ${notFound}, URL conservée = ${page.url().includes(UNKNOWN_MATCH)}`,
  );

  setPhase('3. visiteur sur un match TERMINÉ (5v5, maps + lineups)');
  // Le compte du run n'est participant d'AUCUN match : c'est exactement le tiers dont la
  // garde de `GET /matches/{id}` autorise la lecture parce que le match est `completed`.
  await page.goto(`${ORIGIN}/matches/${demo.teamCompleted.id}`, { waitUntil: 'networkidle' });
  const heading = page.locator('main h1');
  await heading.waitFor({ timeout: 10000 });

  const sides = demo.teamCompleted.detail.sides;
  const names = sides.map((s) => s.team.name);
  const title = (await heading.textContent())?.trim() ?? '';
  step(
    'M3',
    names.every((n) => title.includes(n)),
    `h1 « ${title} » nomme les deux camps (${names.join(' / ')})`,
  );

  // Le vainqueur est marqué UNE fois : deux marques (ou zéro) sur un match terminé est le
  // défaut que ce check garde.
  const winnerMarks = await main.locator('text=Winner').count();
  const winnerName = sides.find((s) => s.id === demo.teamCompleted.detail.match.winnerSideId).team
    .name;
  step('M4', winnerMarks === 1, `marques « Winner » : ${winnerMarks} (1 attendue — ${winnerName})`);

  // Le score affiché vient-il vraiment de l'API ? On compare au JSON, pas à une constante.
  // On lit le nom accessible du bloc central : c'est LUI qui nomme les deux camps et leurs
  // manches, donc c'est lui qu'un lecteur d'écran entend.
  // ⚠️ Le sélecteur exige `role="img"`, il ne s'en contente pas : sur un `<p>` nu (donc
  // `role="paragraph"`) ARIA 1.2 INTERDIT `aria-label`, et le score n'aurait aucun nom
  // accessible dans une implémentation conforme — Chrome, lui, l'honore et le masquait.
  // Retirer le rôle rend ce check ROUGE au lieu de le laisser vert sur un balisage invalide.
  // ⚠️ On COMPTE avant de lire. `getAttribute()` LÈVE quand rien ne matche — le `?? ''` ne
  // rattrape qu'un attribut absent sur un élément présent, pas un élément absent. Le scénario
  // sortait alors en `exit 2` (harnais en échec) au lieu d'un rouge imputable au ticket, ce qui
  // est exactement ce que l'invariant #10 interdit. Vécu : le bloc score a changé de balisage,
  // le scénario s'est arrêté à 5/21 sur un timeout de 30 s.
  const boardNode = main.locator('section[aria-label="Score"] p[role="img"][aria-label]').first();
  const boardLabel =
    (await boardNode.count()) > 0 ? ((await boardNode.getAttribute('aria-label')) ?? '') : '';
  step(
    'M5',
    boardLabel.includes(`${sides[0].team.name} ${sides[0].score}`) &&
      boardLabel.includes(`${sides[1].team.name} ${sides[1].score}`),
    `score annoncé « ${boardLabel} » = scores de l’API (${sides[0].score}–${sides[1].score}), chacun rattaché à SON camp`,
  );

  // Les maps affichées sont EXACTEMENT celles du match, section scopée par son titre (les
  // chips de lineup rendent elles aussi un `ul[role=list]`).
  // ⚠️ `> div > h2` (chemin DIRECT), pas `h2` : `:has()` remonte, et la `<section>` de la
  // page CONTIENT elle aussi ce titre — sans le chemin direct, le sélecteur matche la page
  // entière et ramasse les 10 chips de lineup en plus des 3 maps (mesuré : 13 au lieu de 3).
  const shownMaps = await main
    .locator('section:has(> div > h2:text-is("Maps")) ul[role="list"] li')
    .allTextContents();
  const apiMaps = demo.teamCompleted.detail.match.maps;
  step(
    'M6',
    shownMaps.length === apiMaps.length &&
      apiMaps.every((m) => shownMaps.some((s) => s.trim() === m)),
    `maps affichées (${shownMaps.length}) = maps du match (${apiMaps.length}) : ${apiMaps.join(', ')}`,
  );

  // Une section de lineup par camp, et le capitaine repéré une seule fois par camp.
  // ⚠️ On compte les chips par leur LIEN joueur, pas par `ul[role=list] li` : la section des
  // maps rend la même structure, et le `<h2>` d'un `SectionTitle` n'est pas frère de la liste
  // (il est enveloppé dans la ligne de titre), donc `h2 ~ ul` ne sélectionnerait rien.
  const lineupSections = await main.locator('h2:has-text("line-up")').count();
  const crowns = await main.locator('[aria-label="Captain"]').count();
  const chips = await main.locator('ul[role="list"] li a[href^="/players/"]').count();
  const fielded = sides.reduce((n, s) => n + s.players.length, 0);
  step(
    'M7',
    lineupSections === 2 && crowns === 2 && chips === fielded,
    `sections lineup : ${lineupSections} (2), capitaines repérés : ${crowns} (2), joueurs alignés : ${chips}/${fielded}`,
  );

  // 🚨 L'Elo est affiché par CAMP, jamais par joueur : deux valeurs pour dix joueurs alignés.
  const eloValues = await main
    .locator('section[aria-label="Score"] p', { hasText: 'Elo change' })
    .count();
  step(
    'M8',
    eloValues === 2,
    `valeurs d’Elo rendues : ${eloValues} (2 attendues — une par CAMP, surtout pas ${fielded}, une par joueur)`,
  );

  setPhase('4. le match 1v1 : aucun bloc équipe, aucune section maps');
  await page.goto(`${ORIGIN}/matches/${demo.soloCompleted.id}`, { waitUntil: 'networkidle' });
  await main.locator('h1').waitFor({ timeout: 10000 });
  const teamLinks = await main.locator('a[href^="/teams/"]').count();
  const playerLinks = await main
    .locator('section[aria-label="Score"] a[href^="/players/"]')
    .count();
  const soloMaps = await main.locator('h2:text-is("Maps")').count();
  const soloLineups = await main.locator('h2:has-text("line-up")').count();
  step(
    'M9',
    teamLinks === 0 && playerLinks === 2 && soloMaps === 0 && soloLineups === 0,
    `1v1 : liens d’équipe ${teamLinks} (0 attendu), camps rendus en JOUEURS ${playerLinks} (2), section Maps ${soloMaps} (0 — chess n’a pas de pool), sections lineup ${soloLineups} (0 — le joueur EST le camp)`,
  );

  setPhase('5. non-participant sur un match NON terminé -> 403');
  // Le 403 est L'OBJET du test. Motif restreint à CET uuid : une route entière masquerait de
  // vrais refus de la même famille dans les phases suivantes.
  expectHttp(
    new RegExp(demo.upcoming.id),
    'match non terminé demandé par un tiers -> 403 attendu (écran « réservé aux participants »)',
  );
  await page.goto(`${ORIGIN}/matches/${demo.upcoming.id}`, { waitUntil: 'networkidle' });
  const forbidden = await appears(page.locator('text=Reserved for the two sides'));
  const leakedScore = await main.locator('section[aria-label="Score"]').count();
  step(
    'M10',
    forbidden && leakedScore === 0,
    `écran 403 rendu = ${forbidden}, tableau de score laissé à l’écran : ${leakedScore} (0 attendu)`,
  );

  // ⚠️ Bascule de compte : le rail authentifié n'a pas de bouton « se déconnecter »
  // atteignable ici, d'où le vidage de cookies avant le login (même motif que teams-detail).
  await page.context().clearCookies();
  await login(MEMBER);

  setPhase('6. membre sur un match à venir');
  await page.goto(`${ORIGIN}/matches/${demo.upcoming.id}`, { waitUntil: 'networkidle' });
  const upcomingShown = await appears(main.locator('section[aria-label="Score"]'));
  const notice = (await main.locator('text=/Kick-off/').first().textContent()) ?? '';
  step(
    'M11',
    upcomingShown && /in \d/.test(notice),
    `fiche rendue pour un participant = ${upcomingShown}, avis « ${notice.trim().slice(0, 70)} » annonce un délai = ${/in \d/.test(notice)}`,
  );

  setPhase('6b. membre sur un match dont le coup d’envoi est PASSÉ');
  // L'autre branche de l'avis, et le 6ᵉ état semé : `in_progress` après l'heure, l'instant
  // où `POST /matches/:id/result` devient acceptable côté serveur.
  await page.goto(`${ORIGIN}/matches/${demo.live.id}`, { waitUntil: 'networkidle' });
  await main.locator('h1').waitFor({ timeout: 10000 });
  const started = await main.locator('text=/Kick-off was/').count();
  const stillCounting = await main.locator('text=/Kick-off .* — in /').count();
  step(
    'M11b',
    started === 1 && stillCounting === 0,
    `coup d’envoi passé : avis « Kick-off was… » ${started} (1 attendu), avis « in X » résiduel ${stillCounting} (0 attendu)`,
  );

  setPhase('7. un camp a soumis : attente 24 h, et le CHOIX offert à l’autre camp');
  await page.goto(`${ORIGIN}/matches/${demo.awaiting.id}`, { waitUntil: 'networkidle' });
  await main.locator('h1').waitFor({ timeout: 10000 });
  const countdown = await main.locator('text=/left to confirm/').count();
  /**
   * ⚠️ CE CHECK A CHANGÉ DE SUJET AVEC [FT-4B], il n'a pas été relâché. Il gardait le
   * découpage FT-4A/FT-4B (« zéro bouton, zéro formulaire : la saisie du score n'est pas ce
   * ticket ») ; la saisie est désormais livrée, et sur CE match semé alice est justement
   * capitaine du camp qui n'a PAS répondu — le choix est donc l'affichage correct.
   *
   * Ce qu'il garde maintenant, et qui reste un vrai risque : la saisie est une DISCLOSURE
   * FERMÉE. Le formulaire ne se rend pas de lui-même — aucun `<form>`, aucun champ tant que
   * « Contest » n'a pas été cliqué. (Les deux boutons de la boîte de confirmation, montée
   * fermée, ne sont donc pas comptés : on nomme les deux actions attendues au lieu de
   * compter tous les `<button>` de la page.)
   */
  const confirmAction = await main.locator('button:has-text("Confirm the result")').count();
  const contestAction = await main.locator('button:has-text("Contest")').count();
  const forms = await main.locator('form').count();
  const inputs = await main.locator('input, select, textarea').count();
  step(
    'M12',
    countdown === 1 && confirmAction === 1 && contestAction === 1 && forms === 0 && inputs === 0,
    `compte à rebours de confirmation : ${countdown} (1 attendu), « Confirm the result » ${confirmAction} (1), « Contest » ${contestAction} (1), formulaires déployés ${forms} (0), champs ${inputs} (0)`,
  );

  setPhase('7b. litige et créneau ouvert');
  await page.goto(`${ORIGIN}/matches/${demo.disputed.id}`, { waitUntil: 'networkidle' });
  await main.locator('h1').waitFor({ timeout: 10000 });
  const disputePill = await main.locator('text=Disputed').count();
  const disputeNotice = await main.locator('text=The two sides disagree').count();
  step(
    'M12b',
    disputePill >= 1 && disputeNotice === 1,
    `match en litige : pastille « Disputed » ${disputePill} (≥ 1), avis d’arbitrage ${disputeNotice} (1)`,
  );

  await page.goto(`${ORIGIN}/matches/${demo.openSlot.id}`, { waitUntil: 'networkidle' });
  await main.locator('h1').waitFor({ timeout: 10000 });
  const slotNotice = await main.locator('text=Slot open for').count();
  const noOpponent = await main.locator('text=No opponent yet').count();
  const slotSides = await main.locator('section[aria-label="Score"] a[href^="/teams/"]').count();
  step(
    'M12c',
    slotNotice === 1 && noOpponent === 1 && slotSides === 1,
    `créneau ouvert : avis ${slotNotice} (1), « No opponent yet » ${noOpponent} (1), camps engagés ${slotSides} (1 seul — personne n’a accepté)`,
  );

  // ⚠️ Ce check garde un défaut RÉEL trouvé en review : la fiche déduisait « créneau ouvert »
  // de l'absence d'adversaire, sans regarder le statut. Un créneau annulé — même forme, un
  // seul side — se titrait donc « open slot » et annonçait « any team can accept it », juste
  // sous une pastille CANCELLED, pour une action que l'API refuse. Les 3 mesures ci-dessous
  // sont exactement les 3 symptômes.
  await page.goto(`${ORIGIN}/matches/${demo.cancelled.id}`, { waitUntil: 'networkidle' });
  await main.locator('h1').waitFor({ timeout: 10000 });
  const cancelledTitle = (await main.locator('h1').innerText()).toLowerCase();
  const stillOffered = await main.locator('text=Any team of the ladder can accept').count();
  // ⚠️ Scopé au HEADER, et pas à `main`. `text=Cancelled` est insensible à la casse et cherche
  // une sous-chaîne : sur `main` il matchait 2 nœuds — la pastille ET le mot « cancelled » dans
  // la phrase d'avis. Supprimer entièrement la pastille aurait donc laissé le compte à 1, et ce
  // check vert sur le défaut qu'il est censé garder.
  const cancelledPill = await main.locator('header').locator('text=Cancelled').count();
  step(
    'M12d',
    !cancelledTitle.includes('open slot') && stillOffered === 0 && cancelledPill >= 1,
    `créneau annulé : titre « open slot » ${cancelledTitle.includes('open slot')} (false attendu), ` +
      `« can accept it » ${stillOffered} (0), pastille Cancelled ${cancelledPill} (≥ 1)`,
  );

  setPhase('8. historique d’équipe : toutes les lignes cliquables pour un membre');
  const teamId = demo.teamCompleted.detail.sides.find((s) => s.team !== null).team.id;
  await page.goto(`${ORIGIN}/teams/${teamId}`, { waitUntil: 'networkidle' });
  await page.locator('[role="tab"]', { hasText: 'Matches' }).click();
  await main.locator('table tbody tr').first().waitFor({ timeout: 10000 });
  const rows = await main.locator('table tbody tr').count();
  const sheetLinks = await main.locator('table tbody a[href^="/matches/"]').count();
  step(
    'M13',
    rows > 1 && sheetLinks === rows,
    `lignes d’historique : ${rows}, liens vers une fiche : ${sheetLinks} (autant que de lignes — avant FT-4A, seules les lignes terminées l’étaient)`,
  );

  // Et le lien MÈNE quelque part : on y va par le CLIC, jamais par une URL forgée.
  await main.locator('table tbody a[href^="/matches/"]').first().click();
  await page.waitForURL(/\/matches\/[0-9a-f-]{36}/, { timeout: 10000 });
  const reached = await appears(main.locator('section[aria-label="Score"]'));
  step('M14', reached, `clic sur une ligne d’historique -> fiche de match rendue = ${reached}`);

  setPhase('9. largeur mobile 375 px');
  await page.goto(`${ORIGIN}/matches/${demo.teamCompleted.id}`, { waitUntil: 'networkidle' });
  await main.locator('section[aria-label="Score"]').waitFor({ timeout: 10000 });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step('M15', overflow <= 0, `débordement horizontal du document : ${overflow}px (0 attendu)`);

  // ⚠️ M15 NE SUFFIT PAS : un conteneur qui CLIPPE son propre débordement rend le check du
  // document vert par construction (leçon de `ladder-detail` L9b). On mesure donc la boîte du
  // score ET la largeur RÉELLEMENT rendue d'un nom de camp — un nom à 0 px est illisible sans
  // rien faire déborder.
  const boxed = await main.locator('section[aria-label="Score"]').evaluate((el) => {
    const name = el.querySelector('span.line-clamp-2');
    return {
      scroll: el.scrollWidth,
      client: el.clientWidth,
      nameWidth: name ? Math.round(name.getBoundingClientRect().width) : -1,
    };
  });
  step(
    'M16',
    boxed.scroll <= boxed.client && boxed.nameWidth >= 60,
    `tableau de score à 375 px : scrollWidth=${boxed.scroll} vs clientWidth=${boxed.client} (débordement ${boxed.scroll - boxed.client}px, 0 attendu), largeur rendue du nom de camp = ${boxed.nameWidth}px (≥ 60 attendu)`,
  );

  await page.setViewportSize({ width: 1280, height: 900 });
}
