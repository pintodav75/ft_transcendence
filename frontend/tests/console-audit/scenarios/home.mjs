/**
 * `/home` — [F-HOME] : l'écran d'atterrissage d'un compte connecté.
 *
 * `/home` n'est PAS un miroir des autres onglets : ni grille de jeux (`/games` existe), ni
 * liste d'équipes (`/teams` existe). Elle ne porte que de l'ACTIONNABLE. Conséquence directe et
 * structurante : **tous les blocs sont conditionnels**, donc un compte neuf verrait une page
 * vide — l'onboarding n'est pas un bonus, c'est le contenu par DÉFAUT. Ce que ce scénario
 * garde :
 *
 *   - **le budget de 5 requêtes, et surtout le zéro `GET /ladders`** (`H2`). C'est une vraie
 *     contrainte, pas un hasard : nommer le ladder d'une ligne coûterait une 6ᵉ requête, et
 *     `matchLabeller` retombe déjà sur `<jeu> <format>`. C'est aussi ce qui maintient `N5` de
 *     `f-nav` en vie — sans ce check ici, un futur ticket ajouterait `useLadders()` sur `/home`
 *     et ferait tomber `N5` sans que personne comprenne pourquoi ;
 *   - **le rappel §5.1 et sa fermeture DÉFINITIVE** (`H4` → `H7`), y compris la reprise après
 *     rechargement — c'est la seule fonctionnalité de la page qui persiste quelque chose ;
 *   - **le préfixe par userId de cette persistance** (`H17`), qui n'est pas un détail : on
 *     jongle entre `alice`/`bob`/`carol` dans le même Chrome toute la journée, l'audit compris.
 *     Sur une clé partagée, la fermeture par un compte masquerait le bloc d'un autre — un défaut
 *     qui se reproduit une fois et se diagnostique très mal ;
 *   - **le focus rendu au `<h1>`** après cette fermeture (`H6`) : le bloc est le PREMIER élément
 *     de la page, son bouton disparaît avec lui, et sans point d'atterrissage le focus retombe
 *     sur `<body>` (piège [FX-FOCUS]) ;
 *   - **l'échéance de retrait d'un créneau ouvert** (`H9`), la seule information réellement
 *     neuve de la page : `cancelExpiredSlots` annule un `pending` dès qu'il passe sous 15 min de
 *     son PROPRE coup d'envoi, et rien d'autre dans l'app ne l'affiche. ⚠️ Ce n'est pas la règle
 *     des 24 h, qui est un autre job. Gardée **à l'écran ET dans l'`aria-label`** de la carte : un
 *     `aria-label` REMPLACE le contenu du lien, donc sans lui la seule information neuve de la
 *     page n'était annoncée à personne ;
 *   - **le partage d'entrée de cache** (`H14`) ;
 *   - **une panne PARTIELLE qui se dit même sur une page pleine** (`H18`) : l'encadré était
 *     conditionné à une page vide, si bien qu'une panne de `GET /teams/invitations/me` avec un
 *     match à l'écran faisait disparaître une invitation en attente **sans le moindre signal**.
 *
 * 🚨 QUATRE CHECKS EXISTENT PARCE QUE 12 CHECKS VERTS N'ONT RIEN VU ET QU'UN COUP D'ŒIL A TOUT
 * TROUVÉ. Ils gardent les quatre défauts sortis de la relecture des captures :
 *   - `H11` — le compte à rebours portait un format d'HORLOGE (« in 18 h 43 », indistinguable de
 *     18:43 sur une page qui affiche de vraies heures juste à côté) ;
 *   - `H10` — la pastille de statut n'existait QUE sur la carte vedette, donc sur une page faite
 *     de créneaux ouverts le mot « OPEN SLOT » apparaissait une seule fois ;
 *   - `H12` — la date et le rebours étaient inversés entre la carte et les lignes, l'œil zigzaguait ;
 *   - `H8` — l'onboarding exigeait que TOUT soit vide, donc un compte de 4 équipes sans aucun
 *     match ne le voyait pas : le signal est « aucun match », pas « page vide ».
 * Les quatre ont été **vus rouges avant vert**. Leçon à garder : un check garde ce qu'on a pensé
 * à mesurer, une capture montre ce qu'on n'a pas pensé à regarder.
 *
 * ⚠️ « ZÉRO REQUÊTE EN NAVIGANT DEPUIS `/home` » N'EST VRAI QUE POUR LES DONNÉES DE RÉFÉRENCE.
 * Le `QueryClient` de l'app est construit sans defaults, donc `staleTime: 0` : `GET /matches/me`,
 * `/teams/invitations/me` et `/users/me/external-accounts` sont REFETCHÉS en fond au montage de
 * l'écran suivant. Ce qui est partagé, et ce qui compte pour l'utilisateur, c'est **l'entrée de
 * cache** : la page suivante peint instantanément, sans spinner. Seul `['games']` (une heure de
 * fraîcheur) donne un vrai zéro requête, et c'est donc lui que mesure `H14`. Poser un
 * `staleTime` sur `matches/me` pour élargir le check servirait un historique périmé sur
 * `/history` : mauvais échange, refusé.
 *
 * ⚠️ IL NE DÉPEND PAS DU SEED. Le compte du run est neuf (c'est exactement l'état par défaut
 * qu'on veut auditer) et le seul état peuplé est fabriqué par l'API : un compte chess.com lié et
 * un créneau sur le ladder **chess 1v1**, qui vient des migrations (`0009`), pas du seed.
 *
 * ⚠️ TEARDOWN : le créneau reste `pending`, donc `purgeUserMatches()` du runner l'annule tout
 * seul avant `DELETE /users/me`. Rien à forcer en SQL ici — contrairement à `history.mjs` ou
 * `match-result.mjs`, ce scénario ne produit aucun match engageant.
 */
export const name = 'home';
export const surface =
  '/home — rappel §5.1 fermable, « Next up » et l’échéance de retrait, budget de requêtes, onboarding (F-HOME)';

/** Provider exigé par chess (`games.required_provider`, migration 0008). */
const CHESS_PROVIDER = 'chess_com';

/**
 * Libellés attendus des providers.
 *
 * ⚠️ ÉCRITS ICI EN DUR, ET C'EST VOULU : c'est la sortie ATTENDUE. Les lire depuis
 * `lib/games.ts` rendrait le check tautologique (il comparerait la page à elle-même). Il doit
 * rester le miroir de `providerLabel()` — s'ils divergent, c'est ce check qui doit rougir.
 */
const PROVIDER_LABELS = { riot: 'Riot', steam: 'Steam', epic: 'Epic', chess_com: 'chess.com' };

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

const vanishes = (locator, timeout = 10000) =>
  locator
    .waitFor({ state: 'detached', timeout })
    .then(() => true)
    .catch(() => false);

/**
 * Un coup d'envoi VALIDE côté serveur : aligné sur le quart (`:00/:15/:30/:45`), secondes et ms
 * à zéro, et à plus de 15 minutes — d'où l'arrondi AU QUART SUPÉRIEUR, le même que `future()`
 * dans `backend/tests/helpers.py`.
 */
function futureQuarter(hoursAhead) {
  const at = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  at.setUTCSeconds(0, 0);
  at.setUTCMinutes(at.getUTCMinutes() + ((15 - (at.getUTCMinutes() % 15)) % 15));
  return at.toISOString();
}

/**
 * `20:45` en `en-GB`, comme `formatClockTime` de `lib/home.ts`.
 *
 * ⚠️ La locale est FIGÉE des deux côtés, jamais celle de l'hôte : sans ça ce check dépendrait de
 * la machine qui lance la campagne.
 */
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Chemin d'une URL, pour distinguer `/api/teams` de `/api/teams/invitations/me`. */
const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
};

export async function run({
  page,
  setPhase,
  step,
  countRequests,
  createUser,
  expectHttp,
  login,
  awaitAnnouncement,
  awaitFocusRestored,
  focusLanding,
  user,
  ORIGIN,
}) {
  /**
   * Appel API direct, lu par NODE : ces requêtes ne traversent pas la console auditée. C'est la
   * source de vérité contre laquelle on compare l'écran ensuite.
   */
  const api = (as, path, init = {}) => {
    const headers = { authorization: `Bearer ${as.accessToken}`, ...(init.headers ?? {}) };
    if (init.body) headers['content-type'] = 'application/json';
    return fetch(`${ORIGIN}/api${path}`, { ...init, headers });
  };

  const main = page.locator('main');
  const banner = main.locator('section:has(h2:text-is("Link your game accounts"))');
  const dismiss = banner.getByRole('button', { name: 'Don’t show this again' });
  const heading = main.getByRole('heading', { level: 1 });
  const onboarding = main.getByRole('list', { name: 'First steps' });

  // =============================================================== §1 l'état par DÉFAUT
  // Fait en premier parce que le compte du run vient de naître : aucun match, aucune équipe,
  // aucune invitation, aucun compte lié. C'est exactement l'écran qu'un vrai nouveau voit, et
  // il est gratuit — après la mise en place de §2 il faudrait un compte jetable de plus.
  setPhase('1. état par défaut d’un compte neuf : budget de requêtes');

  const seen = [];
  await countRequests(
    () => page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' }),
    (url) => {
      const path = pathOf(url);
      if (path.startsWith('/api/')) seen.push(path);
      return false;
    },
  );
  // On IGNORE le bootstrap de session (`/auth/refresh`, `/users/me`) : il appartient au shell
  // authentifié, pas à la page — il partirait sur n'importe quelle route.
  const BOOTSTRAP = ['/api/auth/refresh', '/api/users/me'];
  // 🔑 MÊME RAISONNEMENT POUR LE RAIL SOCIAL, et il faut le tenir explicitement.
  // Depuis [FS-1], `AuthenticatedLayout` monte un rail qui charge sa propre donnée sur TOUTES
  // les pages authentifiées. Ces appels ne sont pas le budget de `/home` : les compter ici
  // ferait rougir ce check à chaque carte du rail — FS-2 (notifications) et FS-4 (conversations)
  // en ajouteront chacune un, et on éditerait le budget trois fois en croyant à une régression
  // de `/home`.
  // ⚠️ Cette liste est un ENGAGEMENT, pas une échappatoire : y ajouter une ligne doit être un
  // acte délibéré, justifié par « le rail en a besoin sur toutes les pages ». Tout ce qui n'est
  // pas ici reste imputé à la page, y compris `GET /ladders` — c'est ce qui maintient `N5` de
  // `f-nav` en vie (voir l'en-tête).
  const SOCIAL_RAIL = ['/api/friends'];
  const pageCalls = seen.filter(
    (path) => !BOOTSTRAP.includes(path) && !SOCIAL_RAIL.includes(path),
  );
  const EXPECTED = [
    '/api/games',
    '/api/users/me/external-accounts',
    '/api/matches/me',
    '/api/teams/invitations/me',
    '/api/matches',
  ];
  const missing = EXPECTED.filter((path) => !pageCalls.includes(path));
  const extra = pageCalls.filter((path) => !EXPECTED.includes(path));
  step(
    'H1',
    missing.length === 0 && extra.length === 0,
    `requêtes de la page : ${JSON.stringify([...new Set(pageCalls)])} — manquantes : ${JSON.stringify(missing)}, en trop : ${JSON.stringify(extra)} (5 attendues)`,
  );

  // 🔑 LE CHECK QUI PROTÈGE `N5` DE `f-nav`. Ce dernier exige que `/home` ne demande pas les
  // ladders ; sans le check ci-dessous, un futur ticket ajouterait `useLadders()` ici et ferait
  // tomber `N5` sur une page qui n'a rien à voir avec la barre de recherche qu'il mesure.
  // ⚠️ Chemin EXACT : `/api/teams/invitations/me` commence par `/api/teams`, un `includes`
  // rendrait ce check faux sans le rendre rouge.
  const forbidden = pageCalls.filter((path) => path === '/api/ladders' || path === '/api/teams');
  step(
    'H2',
    forbidden.length === 0,
    `${forbidden.length} requête(s) interdite(s) sur /home : ${JSON.stringify(forbidden)} (0 attendue — GET /ladders coûterait une 6ᵉ requête, et GET /teams n’est pas nécessaire au compteur d’invitations)`,
  );

  const h1Count = await heading.count();
  const h1Text = h1Count === 1 ? (await heading.innerText()).trim() : '';
  step(
    'H3',
    h1Count === 1 && h1Text.length > 0 && !/page home/i.test(h1Text),
    `${h1Count} <h1> (1 attendu), texte « ${h1Text} » (plus le stub « Page home! »)`,
  );

  // ---------------------------------------------------- §1b le rappel §5.1
  setPhase('1b. rappel §5.1 : les providers manquants viennent de la DONNÉE');

  const gamesRes = await api(user, '/games');
  if (!gamesRes.ok) {
    // Erreur de HARNAIS (exit 2), pas un check rouge : sans la liste des jeux tout ce qui suit
    // comparerait l'écran au vide.
    throw new Error(`GET /games -> ${gamesRes.status} : ${await gamesRes.text()}`);
  }
  const { games } = await gamesRes.json();
  const requiredLabels = [...new Set(games.map((game) => game.requiredProvider))].map(
    (provider) => PROVIDER_LABELS[provider] ?? provider,
  );

  const bannerShown = await appears(banner);
  const bannerText = bannerShown ? await banner.innerText() : '';
  const namesAll = requiredLabels.every((label) => bannerText.includes(label));
  step(
    'H4',
    bannerShown && requiredLabels.length > 0 && namesAll,
    `bandeau affiché=${bannerShown} ; providers exigés par GET /games : ${JSON.stringify(requiredLabels)} — tous nommés à l’écran=${namesAll}`,
  );

  // 🚨 La copie d'origine de ce composant disait « you cannot enter the **queue** » et
  // « start **matchmatching** ». Il n'y a PAS de file d'attente dans ce produit (modèle
  // challenge/accept) et le second était une faute de frappe. Le check vise ces deux
  // formulations précises, jamais le mot « queue » seul : l'onboarding dit légitimement
  // « there is no queue ».
  //
  // 🚨 ET IL PORTE SON CONTRÔLE POSITIF DANS LE MÊME PAS. « Aucune formulation interdite » est
  // exactement ce que mesure une page qu'on n'a PAS LUE : `innerText()` qui rend `''` (sélecteur
  // périmé, `<main>` disparu, rendu pas encore commité) rendait ce check vert sans avoir rien
  // regardé. On exige donc de retrouver la phrase d'intro de la page — inconditionnelle, elle
  // est dans le hero — avant de conclure quoi que ce soit sur ce qu'on n'y a pas trouvé.
  // ⚠️ `.catch(() => '')` : sans lui, un sélecteur qui ne résout plus fait LEVER `innerText` et
  // sort le harnais en exit 2 (« harnais en échec ») au lieu d'un rouge imputable au ticket.
  const INTRO = 'What needs you right now';
  const mainText = await main.innerText().catch(() => '');
  const readsPage = mainText.includes(INTRO);
  const badCopy = [/matchmatching/i, /enter the queue/i].filter((re) => re.test(mainText));
  step(
    'H5',
    readsPage && badCopy.length === 0,
    `page réellement lue (« ${INTRO} » retrouvé dans <main>, ${mainText.length} caractères)=${readsPage} ; formulations interdites trouvées : ${badCopy.length} (0 attendue — « matchmatching » et « enter the queue » : il n’y a pas de file d’attente dans ce produit)`,
  );

  // ---------------------------------------------------- §1c fermeture DÉFINITIVE
  setPhase('1c. « Don’t show this again » : fermeture, focus rendu, persistance');

  await dismiss.click();
  const bannerGone = await vanishes(banner);
  // ⚠️ La région live est montée en permanence : attendre sa PRÉSENCE n'attend rien. On attend
  // le TEXTE (invariant #11), et AVANT `focusLanding()` qui est un instantané synchrone.
  const announced = await awaitAnnouncement('reminder dismissed');
  await awaitFocusRestored();
  const landing = await focusLanding();
  step(
    'H6',
    bannerGone && announced && landing.tag === 'H1',
    `bandeau démonté=${bannerGone}, annonce lue=${announced}, focus sur <${landing.tag}> « ${landing.label} » (H1 attendu — sinon le focus retombe sur <body>, piège FX-FOCUS)`,
  );

  // 🔑 LE CŒUR DU BLOC : le choix est DÉFINITIF, pas « masqué pour cette fois ». Sans ce
  // rechargement, un simple `useState` passerait le check précédent.
  await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
  const stillGone = (await banner.count()) === 0;
  step(
    'H7',
    stillGone,
    `après rechargement complet : bandeau ${stillGone ? 'toujours fermé' : 'RÉAPPARU'} (fermeture définitive attendue, persistée en localStorage)`,
  );

  // ======================= §2 zéro match MAIS la page n'est pas vide : l'onboarding reste
  setPhase('2. mise en place (API directe) : compte chess.com lié + un créneau ouvert par un TIERS');

  const linked = await api(user, '/users/me/external-accounts', {
    method: 'POST',
    body: JSON.stringify({ provider: CHESS_PROVIDER, externalId: `AUDIT-home-${user.stamp}` }),
  });
  if (linked.status !== 201) {
    throw new Error(`POST /users/me/external-accounts -> ${linked.status}`);
  }

  const laddersRes = await api(user, '/ladders');
  if (!laddersRes.ok) throw new Error(`GET /ladders -> ${laddersRes.status}`);
  const { ladders } = await laddersRes.json();
  // Trouvé par sa DONNÉE (jeu + format), jamais par un uuid en dur : les ids viennent des
  // migrations et diffèrent d'une base à l'autre.
  const chess = ladders.find((l) => l.gameId === 'chess' && l.format === '1v1');
  if (!chess) throw new Error('ladder chess 1v1 introuvable (migration 0009)');

  const openSlotAs = async (as, scheduledAt) => {
    const created = await api(as, '/matches', {
      method: 'POST',
      body: JSON.stringify({ ladderId: chess.id, scheduledAt }),
    });
    if (created.status !== 201) {
      throw new Error(`POST /matches -> ${created.status} : ${await created.text()}`);
    }
  };

  // Un TIERS ouvre un créneau : il apparaîtra dans « Slots you can take » de notre compte (qui a
  // désormais son chess.com lié), sans lui donner le moindre match — c'est exactement la
  // situation du compte `test` qui a fait tomber la première version de la garde.
  const foe = await createUser();
  const foeLinked = await api(foe, '/users/me/external-accounts', {
    method: 'POST',
    body: JSON.stringify({ provider: CHESS_PROVIDER, externalId: `AUDIT-home-foe-${foe.stamp}` }),
  });
  if (foeLinked.status !== 201) throw new Error(`liaison du tiers -> ${foeLinked.status}`);
  await openSlotAs(foe, futureQuarter(3));

  setPhase('2b. zéro match mais des créneaux à prendre : l’onboarding doit RESTER');
  await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });

  const slotsList = main.getByRole('list', { name: 'Open slots you can accept' });
  const slotsShown = await appears(slotsList);
  const onboardingKept = (await onboarding.count()) === 1;
  /**
   * 🚨 LE CHECK QUI GARDE LE DÉFAUT #4, ET SON CONTRÔLE POSITIF DANS LE MÊME PAS. La première
   * version exigeait que TOUT soit vide : un compte membre de 4 équipes, 0 match, qui voyait
   * deux créneaux acceptables, n'avait donc **aucun** onboarding — alors qu'il est précisément
   * le lecteur visé. Le signal est « aucun match dans mon historique », pas « la page est vide ».
   *
   * ⚠️ `slotsShown` n'est pas décoratif : sans lui, « l'onboarding est là » serait vert sur une
   * page où le teaser de créneaux serait cassé et où il n'y aurait donc rien à concilier.
   */
  step(
    'H8',
    slotsShown && onboardingKept,
    `« Slots you can take » rempli=${slotsShown} ET onboarding ${onboardingKept ? 'toujours affiché' : 'MASQUÉ'} — 0 match mais la page n’est pas vide (affichage attendu : la garde lit l’historique, pas le vide de la page)`,
  );

  // ============================================ §3 mes propres créneaux : « Next up »
  setPhase('3. mes créneaux : carte vedette, lignes, échéance de retrait');

  // ⚠️ Les instants sont retenus dans des variables et JAMAIS recalculés : deux appels à
  // `futureQuarter()` peuvent franchir un quart, et le libellé attendu ne collerait plus.
  // Trois heures largement disjointes — §5.2 compare des FENÊTRES (30 min de lockout en 1v1).
  const kickoff = futureQuarter(6);
  await openSlotAs(user, kickoff);
  await openSlotAs(user, futureQuarter(9));
  await openSlotAs(user, futureQuarter(12));

  await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });

  const nextUp = main.getByRole('link', { name: /^Next match:/ });
  const nextUpShown = await appears(nextUp);
  const nextUpText = nextUpShown ? await nextUp.innerText() : '';
  // 🔑 L'INFORMATION QUE CE TICKET AJOUTE À L'APP : 15 minutes AVANT le coup d'envoi, pas 24 h,
  // et pas le coup d'envoi lui-même. Calculée ici depuis l'instant qu'on a envoyé au serveur.
  const withdrawnAt = clock.format(new Date(Date.parse(kickoff) - 15 * 60 * 1000));
  const saysWithdrawal = nextUpText.includes(`withdrawn at ${withdrawnAt}`);
  const namesLadder = /chess 1v1/i.test(nextUpText);
  /**
   * ⚠️ ET DANS L'`aria-label`, PAS SEULEMENT À L'ÉCRAN. Un `aria-label` REMPLACE le contenu du
   * lien : qui parcourt la page par liens n'entendait que « Next match: Chess 1v1, in 6h 6m »,
   * donc jamais l'échéance — la seule information que ce ticket ajoute à l'app. Trouvé en review,
   * pas par un check : celui-ci existe pour que ça ne reparte pas.
   * ⚠️ `getAttribute` LÈVE quand rien ne matche (exit 2) : `.catch(() => '')` le fait rougir.
   */
  const nextUpLabel = nextUpShown ? await nextUp.getAttribute('aria-label').catch(() => '') : '';
  const labelSaysWithdrawal = (nextUpLabel ?? '').includes(`withdrawn at ${withdrawnAt}`);
  step(
    'H9',
    nextUpShown && saysWithdrawal && namesLadder && labelSaysWithdrawal,
    `carte « Next up » affichée=${nextUpShown}, nomme le ladder=${namesLadder}, annonce « withdrawn at ${withdrawnAt} » à l’écran=${saysWithdrawal} et dans son aria-label=${labelSaysWithdrawal} (« ${nextUpLabel} ») — coup d’envoi ${kickoff} moins 15 min (MIN_LEAD_MINUTES, PAS la règle des 24 h)`,
  );

  const laterList = main.getByRole('list', { name: 'Later matches' });
  const laterRows = laterList.getByRole('listitem');
  // ⚠️ Attendre la première ligne AVANT de compter : `count()` n'attend rien, il rendrait 0
  // pendant que la liste se monte (piège `MM11`).
  const laterShown = await appears(laterRows.first());
  const laterCount = laterShown ? await laterRows.count() : 0;

  /**
   * 🚨 LE CHECK QUI GARDE LE DÉFAUT #2. La pastille de statut n'existait QUE sur la carte
   * vedette : sur une page faite de créneaux ouverts, le mot « OPEN SLOT » apparaissait une
   * seule fois et les lignes en dessous ne disaient pas ce qu'elles étaient — un match accepté
   * ne s'y distinguait d'un créneau que par la présence d'un adversaire, beaucoup trop implicite.
   *
   * ⚠️ On compte les pastilles PAR LIGNE et on exige au moins 2 lignes : « autant de pastilles
   * que de lignes » serait vrai par construction sur une liste vide, et sur une seule ligne le
   * check ne dirait presque rien.
   */
  const pillsPerRow = laterShown
    ? await laterRows.evaluateAll((rows) =>
        rows.map(
          (row) => row.querySelectorAll('a > span.rounded-full, a > span[class*="rounded-full"]').length,
        ),
      )
    : [];
  step(
    'H10',
    laterCount >= 2 && pillsPerRow.length === laterCount && pillsPerRow.every((n) => n === 1),
    `lignes « Later matches » : ${laterCount} (≥ 2 attendues) ; pastilles de statut par ligne : ${JSON.stringify(pillsPerRow)} (1 sur chacune attendue — la vedette n’est pas la seule à devoir dire ce qu’elle est)`,
  );

  /**
   * 🚨 LE CHECK QUI GARDE LE DÉFAUT #1. Le format d'origine était `in ${h} h ${mm}` avec les
   * minutes paddées : « in 18 h 43 » se lit comme l'horaire 18:43, et « in 18 h 03 » n'en est
   * pas distinguable — sur une page qui affiche par ailleurs de VRAIES heures (coup d'envoi
   * `22:00`, retrait `21:45`). L'unité de la minute est ce qui en fait une durée.
   *
   * ⚠️ Le check exige le nouveau format ET refuse l'ancien : n'exiger que le nouveau laisserait
   * passer une ligne qui porterait les deux.
   */
  const laterText = laterShown ? await laterRows.first().innerText() : '';
  // ⚠️ Le groupe des minutes est OPTIONNEL : un créneau qui tombe pile sur l'heure rend « in 6h »
  // (voir juste en dessous), et exiger `\d+m` ferait rougir un affichage correct au hasard de
  // l'heure du run. L'unité `h`, elle, est exigée dans tous les cas.
  const hasUnits = /in \d+h( \d+m)?/.test(laterText);
  const looksLikeClock = /in \d+ h \d+(?!\s*m)/.test(laterText);
  // ⚠️ Balayé sur TOUTE la page, pas seulement sur cette ligne : `0m` se lit comme une erreur
  // d'affichage, et les créneaux tombant sur la grille des quarts, le cas se produit souvent.
  const zeroMinutes = /\dh 0m/.test(await main.innerText());
  step(
    'H11',
    hasUnits && !looksLikeClock && !zeroMinutes,
    `compte à rebours de la 1ʳᵉ ligne « ${laterText.replace(/\n/g, ' / ')} » : unité présente (« in 18h 43m » ou « in 6h »)=${hasUnits}, ancien format horaire (« in 18 h 43 »)=${looksLikeClock}, « 0m » nulle part sur la page=${!zeroMinutes} — attendu true/false/true ; la page affiche de vraies heures juste à côté`,
  );

  /**
   * 🚨 LE CHECK QUI GARDE LE DÉFAUT #3. La vedette met la date à gauche et le rebours à droite ;
   * les lignes faisaient l'inverse, et l'œil zigzaguait en descendant la section. Mesuré sur les
   * POSITIONS rendues, pas sur l'ordre du DOM : c'est ce que voit le lecteur.
   *
   * ⚠️ Les sentinelles `-1` font ROUGIR le check si un des deux éléments n'est pas trouvé ; elles
   * ne lèvent pas, donc jamais d'exit 2 sur un sélecteur périmé.
   */
  const order = await page.evaluate(() => {
    const row = document.querySelector('ul[aria-label="Later matches"] li a');
    if (!row) return { date: -1, countdown: -1 };
    const spans = [...row.children].filter((node) => node.tagName === 'SPAN');
    const left = (node) => (node ? Math.round(node.getBoundingClientRect().left) : -1);
    return {
      date: left(spans.find((s) => /^\d{2} \w{3},/.test(s.textContent.trim()))),
      countdown: left(spans.find((s) => /^(in |under way)/.test(s.textContent.trim()))),
    };
  });
  step(
    'H12',
    order.date > 0 && order.countdown > 0 && order.countdown > order.date,
    `positions rendues sur la ligne : date à x=${order.date}, compte à rebours à x=${order.countdown} (rebours à DROITE de la date attendu, comme sur la carte vedette — sinon l’œil zigzague)`,
  );

  // 🔑 LE CONTRÔLE POSITIF DE `H8`. Sans lui, « l'onboarding est affiché » serait vert sur un
  // bloc qui s'afficherait TOUJOURS — la garde qui compte est qu'il disparaisse dès qu'il y a
  // un match dans l'historique.
  const onboardingGone = (await onboarding.count()) === 0;
  step(
    'H13',
    onboardingGone,
    `onboarding ${onboardingGone ? 'retiré' : 'TOUJOURS LÀ'} dès que l’historique contient un match (retrait attendu — c’est le pendant de H8)`,
  );

  // ======================================================= §4 partage d'entrée de cache
  setPhase('4. /home -> /games : la liste des jeux est déjà en cache');

  const isGames = (url) => pathOf(url) === '/api/games';
  const railGames = page.locator('nav[aria-label="Primary navigation"] a', { hasText: 'Games' });
  const reused = await countRequests(async () => {
    await railGames.click();
    await page.waitForURL('**/games');
    await page.waitForTimeout(600);
  }, isGames);

  // ⚠️ « 0 requête » est AUSSI ce que mesure un filtre qui ne matche rien (route renommée,
  // `/api` oublié). Le même filtre est donc rejoué sur une arrivée à froid, où il doit compter
  // au moins 1.
  const cold = await countRequests(async () => {
    await page.goto(`${ORIGIN}/games`, { waitUntil: 'networkidle' });
  }, isGames);
  step(
    'H14',
    reused === 0 && cold >= 1,
    `depuis /home : ${reused} GET /games (0 attendu — clé ['games'] partagée, 1 h de fraîcheur) ; à froid avec le MÊME filtre : ${cold} (≥ 1 attendu, sinon le filtre ne mesure rien)`,
  );

  // ============================================ §5 les deux largeurs qui comptent
  setPhase('5. largeurs : la colonne centrale entre les deux rails, puis 375 px');

  // ⚠️ La phase précédente nous a laissés sur `/games` : sans ce retour, les sélecteurs de ligne
  // ne matchent rien et le check sort ROUGE sur des sentinelles `-1`. Vu, justement — ce qui
  // prouve au passage que les sentinelles font bien rougir au lieu de laisser passer.
  await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });

  /**
   * Ce que mesure `measure()` : le débordement du DOCUMENT, celui de la LIGNE elle-même, et la
   * largeur RENDUE de son nom de ladder.
   *
   * ⚠️ LES TROIS SONT NÉCESSAIRES. `scrollWidth - clientWidth` est **vert par construction** sur
   * un conteneur qui CLIPPE (leçon FT-3 : 73 px sortaient en silence, le nom d'un compétiteur
   * rendu à **0 px** de large). La largeur rendue est le seul des trois qu'un clip ne peut pas
   * cacher. Les sentinelles `-1` font rougir, elles ne lèvent pas.
   */
  const measure = () =>
    page.evaluate(() => {
      const doc = document.documentElement;
      const main = document.querySelector('main');
      const h1 = document.querySelector('main h1');
      const row = document.querySelector('ul[aria-label="Later matches"] li a');
      const name = row
        ? [...row.children].find(
            (node) => node.tagName === 'SPAN' && node.className.includes('font-bold'),
          )
        : null;
      return {
        column: main ? Math.round(main.getBoundingClientRect().width) : -1,
        docOverflow: doc.scrollWidth - doc.clientWidth,
        rowOverflow: row ? row.scrollWidth - row.clientWidth : -1,
        nameWidth: name ? Math.round(name.getBoundingClientRect().width) : -1,
        /**
         * 🚨 LE TITRE EST DANS UN CONTENEUR `overflow-hidden` (il le faut, l'image du hero est en
         * `absolute inset-0`), donc un pseudo long y est COUPÉ EN SILENCE : le document ne
         * déborde pas, et tous les autres checks restent verts pendant qu'une lettre disparaît.
         * C'est la leçon FT-3 appliquée au `<h1>` — on mesure le débordement DE L'ÉLÉMENT, pas
         * celui de la page. Vu pour de vrai à 375 px sur « WELCOME BACK, PROBE5461829 ».
         */
        h1Clip: h1 ? h1.scrollWidth - h1.clientWidth : -1,
      };
    });

  /**
   * 🔑 LA LARGEUR QUI COMPTE EST DÉJÀ CELLE-CI. `RightRail` est monté en `w-78` (312 px) même
   * vide : la colonne centrale à 1280 px vaut donc déjà ce qu'elle vaudra une fois le rail social
   * rempli (~620 px). Concevoir la ligne en pleine largeur et découvrir le débordement au merge
   * du rail est précisément ce que ce check empêche — d'autant que la ligne porte maintenant CINQ
   * éléments depuis l'ajout de la pastille.
   */
  const wide = await measure();
  step(
    'H15',
    wide.column > 0 && wide.column < 700 && wide.docOverflow <= 0 && wide.rowOverflow <= 0 && wide.nameWidth > 40 && wide.h1Clip <= 0,
    `colonne centrale à 1280 px : ${wide.column} px (celle qu'aura la page une fois le rail social rempli) ; débordement document ${wide.docOverflow} px, ligne ${wide.rowOverflow} px, TITRE ${wide.h1Clip} px (≤ 0 attendus — le hero est overflow-hidden, un pseudo long y serait coupé en silence) ; largeur rendue du nom de ladder ${wide.nameWidth} px (> 40)`,
  );

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const narrow = await measure();
  step(
    'H16',
    narrow.docOverflow <= 0 && narrow.rowOverflow <= 0 && narrow.nameWidth > 40 && narrow.h1Clip <= 0,
    `à 375 px : débordement document ${narrow.docOverflow} px, ligne ${narrow.rowOverflow} px, TITRE ${narrow.h1Clip} px (≤ 0 attendus — c'est ICI que le pseudo long du hero se faisait couper) ; largeur rendue du nom de ladder ${narrow.nameWidth} px (> 40 attendu)`,
  );

  await page.setViewportSize({ width: 1280, height: 900 });

  // ====================== §5b une panne PARTIELLE se dit, même quand la page a du contenu
  /**
   * 🚨 LE CHECK QUI GARDE UNE PROMESSE QUE LE CODE NE TENAIT QUE À MOITIÉ. L'encadré « Part of
   * this page could not be loaded » était conditionné à une page VIDE (`!hasSomething`) : avec un
   * match à venir à l'écran et `GET /teams/invitations/me` en 500, le compteur d'invitations
   * retombait à `0`, le bloc ne rendait rien, aucun encadré n'apparaissait — et une invitation en
   * attente devenait invisible SANS LE MOINDRE SIGNAL. C'est précisément le cas où le silence
   * coûte quelque chose, et c'était le seul que la condition ne couvrait pas.
   *
   * ⚠️ La panne est FABRIQUÉE (`page.route`), donc DÉCLARÉE (`expectHttp`) et cloisonnée à sa
   * phase : sans ça le 500 provoqué exprès serait compté comme une entrée console du ticket.
   * ⚠️ Le contrôle positif est dans le même pas : « l'encadré est là » ne vaut que si la page a
   * par ailleurs quelque chose à montrer — sinon on re-mesurerait l'ancien comportement.
   */
  setPhase('5b. panne de GET /teams/invitations/me : la page le DIT au lieu de se taire');
  expectHttp(
    /\/api\/teams\/invitations\/me/,
    'panne de GET /teams/invitations/me provoquée par le scénario',
  );
  await page.route('**/api/teams/invitations/me', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal error' }),
    }),
  );
  await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
  // ⚠️ ON ATTEND LE MESSAGE, on ne le compte pas à `networkidle` : TanStack réessaie sur un 500
  // (1 s, 2 s, 4 s), et pendant les réessais l'absence d'encadré est LÉGITIME (ça charge encore).
  // Compter trop tôt ferait rougir un front correct.
  const partialNotice = await appears(
    main.getByText('Part of this page could not be loaded'),
    20000,
  );
  const stillHasContent = await appears(nextUp);
  step(
    'H18',
    partialNotice && stillHasContent,
    `panne de GET /teams/invitations/me : encadré « Part of this page could not be loaded » affiché=${partialNotice} ALORS QUE la page a du contenu (carte « Next up » rendue=${stillHasContent}) — les deux attendus true : une panne partielle doit se dire même sur une page pleine, sinon une invitation en attente disparaît en silence`,
  );
  await page.unroute('**/api/teams/invitations/me');

  // ================================================ §6 la clé est préfixée par le userId
  setPhase('6. un AUTRE compte revoit le rappel : la clé est préfixée par l’userId');

  // 🚨 CE CHECK GARDE LA CLÉ, PAS LE CODE. On jongle entre `alice`/`bob`/`carol` dans le même
  // Chrome toute la journée (l'audit compris) : sur une clé partagée, la fermeture par le compte
  // du run masquerait le bandeau de tous les suivants — un défaut qui ne se reproduit qu'une
  // fois et qu'on impute alors au rendu.
  // ⚠️ Fait EN DERNIER : ça change le compte connecté pour le reste du run.
  //
  // ⚠️ `clearCookies()` AVANT `login()` : `/login` REDIRIGE vers `/home` tant qu'une session
  // existe, donc `login()` expirerait sur un `#email` introuvable — et un sélecteur qui expire
  // sort en **exit 2** (harnais en échec) au lieu d'un rouge imputable au ticket. Même idiome
  // que `match-result`, `match-detail` et `teams-detail`.
  //
  // 🔑 ET C'EST EXACTEMENT LE BON GESTE POUR CE CHECK : vider les cookies ne touche PAS le
  // `localStorage`. La clé posée par le premier compte est donc toujours là quand le second
  // arrive — ce qui est précisément la situation qu'on veut voir échouer si le préfixe
  // disparaissait.
  const other = await createUser();
  await page.context().clearCookies();
  await login(other);
  setPhase('6. un AUTRE compte revoit le rappel');
  await page.waitForLoadState('networkidle');

  const bannerForOther = await appears(banner);
  step(
    'H17',
    bannerForOther,
    `bandeau ${bannerForOther ? 'revu' : 'MASQUÉ'} par un second compte dans le MÊME navigateur (revu attendu : la clé localStorage est préfixée par l’userId)`,
  );
}
