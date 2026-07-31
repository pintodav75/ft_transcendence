/**
 * F-Nav — rail gauche des pages authentifiées.
 *
 * Surface auditée : `LeftRail` (wordmark, recherche, 6 items de nav), `MenuItem`
 * (état actif vs survol), `SearchBar` posée dans le rail (débounce, gating de
 * `GET /ladders`, fermeture) et la confirmation de déconnexion d'`AuthNav`.
 *
 * ⚠️ Ce scénario est le seul à parcourir le rail : les autres se contentent de le
 * traverser en arrivant sur leur page. Deux dépenses réseau sont vérifiées ICI parce
 * qu'elles sont invisibles à l'œil et coûteraient une requête par page (les ladders) ou
 * une requête par caractère (la recherche).
 */
export const name = 'f-nav';
export const surface = 'rail gauche : nav, recherche, déconnexion confirmée';

const ITEMS = [
  ['Home', '/home'],
  ['My teams', '/teams'],
  ['Solo', '/solo'],
  ['Games', '/games'],
  ['Matchmaking', '/matchmaking'],
  ['History', '/history'],
];

const isLadders = (url) => url.includes('/api/ladders');
const isSearch = (url) => url.includes('/api/search');

export async function run({ page, setPhase, step, countRequests, ORIGIN }) {
  const rail = page.locator('aside:has(nav[aria-label="Primary navigation"])');
  const links = rail.locator('nav[aria-label="Primary navigation"] a');
  const input = rail.locator('input[type=search]');
  // Le panneau de résultats : un `.panel` FLOTTANT (le rail lui-même porte `panel`, d'où
  // le `.absolute` qui ne vaut que pour l'overlay).
  const resultPanel = rail.locator('.panel.absolute');

  // ------------------------------------------------------------------ §1 structure
  setPhase('1. structure du rail');
  const n = await countRequests(
    () => page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' }),
    isLadders,
  );
  step('N1', n === 0, `${n} GET /ladders au montage du rail (0 attendu)`);

  // `textContent` et non `innerText` : `label-caps` applique `text-transform: uppercase`,
  // donc le texte RENDU est en capitales alors que le texte lu par un lecteur d'écran (et
  // écrit dans le JSX) ne l'est pas. C'est ce dernier qu'on vérifie.
  const labels = await links.evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  const expected = ITEMS.map(([label]) => label);
  step(
    'N2',
    labels.length === 6 && labels.every((text, i) => text.trim() === expected[i]),
    `items rendus : ${JSON.stringify(labels.map((t) => t.trim()))}`,
  );

  // `/ranking` a été supprimée : un lien mort dans le rail est un 404 sur toutes les pages.
  const dead = await rail.locator('a[href*="/ranking"]').count();
  step('N3', dead === 0, `${dead} lien vers /ranking (0 attendu)`);

  // La recherche n'est PAS un lien de navigation : elle doit vivre hors du <nav>.
  const searchInNav = await rail.locator('nav[aria-label="Primary navigation"] input').count();
  step('N4', searchInNav === 0, `${searchInNav} champ de saisie DANS le <nav> (0 attendu)`);

  setPhase('1c. dimensions de la maquette');
  // Les dimensions SONT le critère de cette carte : le rail avait été livré une première fois
  // à 288 px avec un wordmark de 48 px en italique et des icônes de 20 px, là où
  // `vsmode-home-demo.html` (`.left`, `.wordmark`, `.nav-item`, `.sep`) demande 264 / 30 / 16.
  // ⚠️ Rien ne protège ces valeurs à la compilation : l'échelle dynamique de Tailwind v4
  // génère n'importe quel nombre, donc `w-66` mal tapé en `w-64` passe lint ET build en
  // silence. Seule une mesure du rendu peut le voir.
  const dims = await page.evaluate(() => {
    const px = (value) => Math.round(parseFloat(value));
    const aside = document.querySelector('aside:has(nav[aria-label="Primary navigation"])');
    const nav = aside.querySelector('nav[aria-label="Primary navigation"]');
    const item = nav.querySelector('a');
    const wordmark = aside.querySelector('a');
    const separator = aside.querySelector('hr');
    const sa = getComputedStyle(aside);
    const si = getComputedStyle(item);
    const sw = getComputedStyle(wordmark);
    const ss = getComputedStyle(separator);
    return {
      width: px(sa.width),
      padY: px(sa.paddingTop),
      padX: px(sa.paddingLeft),
      wordSize: px(sw.fontSize),
      wordWeight: sw.fontWeight,
      wordStyle: sw.fontStyle,
      navGap: px(getComputedStyle(nav).rowGap),
      itemPadY: px(si.paddingTop),
      itemPadX: px(si.paddingLeft),
      itemGap: px(si.columnGap),
      icon: px(getComputedStyle(item.querySelector('svg')).width),
      hrTop: px(ss.marginTop),
      hrLeft: px(ss.marginLeft),
    };
  });
  const MOCKUP = {
    width: 264,
    padY: 18,
    padX: 16,
    wordSize: 30,
    wordWeight: '900',
    wordStyle: 'normal',
    navGap: 2,
    itemPadY: 9,
    itemPadX: 11,
    itemGap: 11,
    icon: 16,
    hrTop: 12,
    hrLeft: 2,
  };
  const drift = Object.entries(MOCKUP).filter(([key, value]) => dims[key] !== value);
  step(
    'N4d',
    drift.length === 0,
    drift.length
      ? `écarts vs maquette : ${drift.map(([key, value]) => `${key}=${dims[key]} (attendu ${value})`).join(', ')}`
      : `${Object.keys(MOCKUP).length} mesures conformes à la maquette (rail ${dims.width} px)`,
  );

  setPhase('1b. lien d’évitement');
  // Le rail impose ~10 arrêts de tabulation avant le contenu, sur TOUTES les pages
  // authentifiées : sans lien d'évitement, atteindre la page au clavier coûte ces 10 Tab
  // à chaque navigation.
  await page.keyboard.press('Tab');
  // ⚠️ On mesure le PADDING et la HAUTEUR, pas seulement une largeur non nulle : la première
  // version de ce lien utilisait `sr-only` + `focus:not-sr-only`, dont le `padding:0` bat en
  // spécificité les `px-4`/`py-2`. Le lien se rendait alors en 149 × 22 px — largeur bien
  // « > 20 », donc check vert, mais cible SOUS les 24 px de WCAG 2.5.8 et texte collé au trait.
  // Un critère de visibilité trop lâche est un check qui ne peut pas voir son propre défaut.
  const skip = await page.evaluate(() => {
    const el = document.activeElement;
    const box = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      tag: el.tagName,
      text: (el.textContent ?? '').trim(),
      height: Math.round(box.height),
      padX: parseFloat(s.paddingLeft),
      padY: parseFloat(s.paddingTop),
      onScreen: box.top >= 0,
    };
  });
  step(
    'N4b',
    skip.tag === 'A' &&
      skip.text === 'Skip to content' &&
      skip.height >= 24 &&
      skip.padX > 0 &&
      skip.padY > 0 &&
      skip.onScreen,
    `1er Tab -> <${skip.tag}> « ${skip.text} », ${skip.height} px de haut, padding ${skip.padY}/${skip.padX}, à l’écran=${skip.onScreen}`,
  );

  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const landed = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    id: document.activeElement.id,
  }));
  step(
    'N4c',
    landed.tag === 'MAIN' && landed.id === 'main',
    `Entrée -> focus sur <${landed.tag} id="${landed.id}">`,
  );

  // ------------------------------------------------------------------ §2 GET /ladders
  setPhase('2. arrivée sur une page du rail sans toucher la recherche');
  // La table des ladders ne sert qu'au sous-titre d'un résultat d'ÉQUIPE : elle ne doit rien
  // coûter tant que personne n'a cherché.
  //
  // ⚠️ LES CIBLES ONT CHANGÉ TROIS FOIS, ET IL LE FALLAIT LES TROIS FOIS. Ce check visait Solo
  // (2), puis History (5) quand `/solo` était une page VIERGE ; [F-SOLO] l'a fait basculer sur
  // Matchmaking (4) + History (5), « les deux seules pages du rail qui n'émettent aucune
  // requête » ; [F-MM] a fait de `/matchmaking` une vraie page (elle charge légitimement
  // `GET /ladders` pour nommer le ladder de `?ladderId=` sans dépenser de 404), ne laissant que
  // History (5) + Home (0). **[F-HIST] fait de `/history` une vraie page elle aussi** : elle
  // résout le nom du ladder de chaque ligne depuis le cache `GET /ladders`. Il ne reste donc
  // AUCUNE paire de pages libres, et le mécanisme « deux navigations client » est mort.
  //
  // ⚠️ MAIS LE CHECK N'EST PAS DEVENU INDÉPENDANT D'UNE PAGE POUR AUTANT : `N5` exige toujours
  // que **`/home` ne demande pas les ladders**.
  //
  // 🔑 CE N'EST PLUS GRATUIT, ET C'EST CE QUI LE REND MEILLEUR. [F-HOME] a rempli `/home` — elle
  // émet désormais 5 requêtes — mais **`GET /ladders` n'en fait délibérément pas partie** : c'est
  // le budget de la page. Nommer le ladder d'une ligne aurait coûté une 6ᵉ requête, et
  // `matchLabeller(undefined, games)` retombe déjà sur `<jeu> <format>`. La cible de `N5` est
  // donc passée d'« une page qui ne demande rien » (opportuniste, périssable, re-ciblée trois
  // fois) à « une page dont la contrainte est écrite » — elle ne bougera plus toute seule.
  //
  // ⚠️ La contrainte est gardée des DEUX côtés : `H2` de `scenarios/home.mjs` échoue si `/home`
  // se met à demander les ladders. Sans lui, un futur ticket ferait tomber `N5` ici, sur un
  // scénario qui parle de la barre de recherche et n'a rien à voir avec la cause.
  //
  // ⚠️ Le jour où `/home` devrait vraiment charger les ladders, il faudra rendre à `N5` une
  // cible : la dernière page du rail qui ne dépende pas des données de référence, ou une route
  // neutre créée pour la mesure.
  //
  // 🔑 LE REPLI ÉTAIT DÉJÀ ÉCRIT ICI ET C'EST CELUI QU'ON APPLIQUE : repartir d'un `page.goto`
  // (cache React Query vidé par le rechargement) plutôt que de chercher une page qui ne
  // demande rien. L'INTENTION EST INTACTE — « la table des ladders ne coûte rien tant que
  // personne n'a cherché » — et c'est toujours la SearchBar qu'on mesure : le rail est monté
  // sur cette page comme sur toutes les autres, et il n'a rien demandé.
  //
  // ⚠️ Ce `goto` est AUSSI la précondition de N6 : sans un cache vide, le premier focus ne
  // redemanderait rien et N6 serait rouge pour une raison qui n'a rien à voir avec la
  // recherche. Poser la précondition et l'ASSERTER dans le même geste est ce qui distingue
  // « le cache est vide » de « on l'espère ».
  const navLadders = await countRequests(async () => {
    await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  }, isLadders);
  step(
    'N5',
    navLadders === 0,
    `${navLadders} GET /ladders à l’arrivée sur /home, recherche jamais touchée (0 attendu — et le cache est donc vide pour N6)`,
  );

  setPhase('3. premier focus sur la recherche');
  const focusLadders = await countRequests(async () => {
    await input.focus();
    await page.waitForTimeout(1200);
  }, isLadders);
  step('N6', focusLadders === 1, `${focusLadders} GET /ladders au premier focus (1 attendu)`);

  // ------------------------------------------------------------------ §3 débounce
  setPhase('4. saisie, 1 caractère');
  // Sous 2 caractères le back rend 400 : la requête ne doit simplement pas partir.
  const one = await countRequests(async () => {
    await input.press('a');
    await page.waitForTimeout(700);
  }, isSearch);
  step('N7', one === 0, `${one} GET /search à 1 caractère (0 attendu)`);

  setPhase('5. saisie, 2e caractère');
  const two = await countRequests(async () => {
    await input.press('u');
    await page.waitForTimeout(1200);
  }, isSearch);
  step('N8', two === 1, `${two} GET /search à 2 caractères (1 attendu — débounce 300 ms)`);

  // ------------------------------------------------------------------ §4 fermeture
  setPhase('6. fermeture du panneau');
  const opened = await resultPanel.count();
  await page.locator('main').click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(200);
  const closed = await resultPanel.count();
  step(
    'N9',
    opened === 1 && closed === 0,
    `panneau ouvert=${opened === 1}, refermé au clic extérieur=${closed === 0}`,
  );

  setPhase('7. Escape vide le champ');
  await input.focus();
  await input.press('Escape');
  await page.waitForTimeout(200);
  const afterEscape = await input.inputValue();
  step('N10', afterEscape === '', `valeur après Escape : « ${afterEscape} »`);

  setPhase('8. le champ ne survit pas à un changement de route');
  await input.pressSequentially('au', { delay: 60 });
  // ⚠️ On REFERME le panneau avant de cliquer dans le rail, et le champ garde sa valeur : c'est
  // exactement le geste que N9 vient de valider (clic extérieur = panneau fermé, texte intact ;
  // seul Escape vide le champ, cf. N10). L'intention de N11 est donc entière — on navigue bien
  // avec « au » encore saisi.
  //
  // 🚨 SANS CE CLIC, LE SCÉNARIO DÉPEND DU CONTENU DE LA BASE DE DEV. Le panneau de résultats
  // se déploie sous la recherche, c'est-à-dire PAR-DESSUS les items du rail : dès que « au »
  // ramène assez de comptes (les `audit…` laissés par des campagnes précédentes s'accumulent et
  // matchent tous), il recouvre le lien Solo et Playwright refuse de cliquer sur un élément
  // intercepté → `locator.click` expire à 30 s et la campagne sort en **exit 2**, sans un seul
  // check rouge pour l'expliquer. Reproduit sur `master` comme sur la branche, avec le compte
  // `audit479552133x1` daté du 31/07 06:32. Invariant du repo : un scénario ne doit JAMAIS
  // supposer qu'il est seul sur la base de dev — on durcit le scénario, on ne purge pas.
  await page.locator('main').click({ position: { x: 4, y: 4 } });
  await links.nth(2).click(); // Solo
  await page.waitForURL('**/solo');
  const afterNav = await input.inputValue();
  step('N11', afterNav === '', `valeur après changement de route : « ${afterNav} »`);

  // ------------------------------------------------------------------ §5 items actifs
  setPhase('9. les 6 items naviguent');
  const visited = [];
  for (const [i, [label, path]] of ITEMS.entries()) {
    await links.nth(i).click();
    await page.waitForURL(`**${path}`);
    const current = await links.nth(i).getAttribute('aria-current');
    visited.push(`${label}=${page.url().endsWith(path) ? 'ok' : 'KO'}/${current}`);
  }
  step(
    'N12',
    visited.every((v) => v.endsWith('ok/page')),
    `navigation + aria-current : ${visited.join(', ')}`,
  );

  setPhase('10. actif ≠ survolé');
  // Le défaut d'origine : survol et actif posaient EXACTEMENT le même fond, donc passer la
  // souris sur un item inactif le rendait indiscernable de la page courante. La maquette
  // distingue les deux par la BORDURE.
  const boxOf = (locator) =>
    locator.evaluate((node) => {
      const s = getComputedStyle(node);
      return { border: s.borderTopColor, bg: s.backgroundColor };
    });
  // ⚠️ `MenuItem` porte `transition` (150 ms sur les couleurs) : lire la couleur calculée
  // juste après la navigation renvoie la valeur INTERPOLÉE, donc encore transparente. Le
  // premier jet de ce check était rouge pour cette seule raison.
  await page.waitForTimeout(400);
  const active = await boxOf(links.nth(5)); // History : dernière route visitée
  await links.nth(0).hover();
  // 400 ms comme au-dessus, et pour la même raison : la transition dure 150 ms, lire à 200 ms
  // ne laissait que 50 ms de marge — assez sur une machine au repos, pas sur une machine
  // chargée. C'est un faux rouge en attente, pas une régression du rail.
  await page.waitForTimeout(400);
  const hovered = await boxOf(links.nth(0));
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';
  step(
    'N13',
    active.border !== TRANSPARENT && hovered.border === TRANSPARENT && active.bg === hovered.bg,
    `actif border=${active.border} bg=${active.bg} | survolé border=${hovered.border} bg=${hovered.bg}`,
  );

  // ------------------------------------------------------------------ §6 déconnexion
  setPhase('11. déconnexion : la boîte de confirmation');
  const logoutItem = rail.locator('nav[aria-label="Account"] button:has-text("Logout")');
  const dialog = page.locator('dialog[open]');
  const confirm = dialog.locator('button:has-text("Log out")');

  const cancelCalls = await countRequests(
    async () => {
      await logoutItem.click();
      await dialog.waitFor({ timeout: 5000 });
      await dialog.locator('button:has-text("Stay signed in")').click();
      await page.waitForTimeout(300);
    },
    (url) => url.includes('/api/auth/logout'),
  );
  const stillHere = (await rail.count()) === 1 && (await dialog.count()) === 0;
  step(
    'N14',
    cancelCalls === 0 && stillHere,
    `Cancel : ${cancelCalls} POST /auth/logout (0 attendu), rail toujours monté=${stillHere}`,
  );

  setPhase('12. déconnexion confirmée');
  await logoutItem.click();
  await dialog.waitFor({ timeout: 5000 });
  const logoutRes = page.waitForResponse(
    (r) => r.url().includes('/api/auth/logout') && r.request().method() === 'POST',
    { timeout: 15000 },
  );
  await confirm.click();
  const res = await logoutRes;
  await page.waitForURL(new RegExp(`^${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`), {
    timeout: 15000,
  });
  // L'URL change AVANT que React n'ait démonté le layout authentifié : compter tout de
  // suite mesurerait l'ancien arbre. On attend le détachement, ce qui est justement la
  // preuve recherchée (le rail ne survit pas à la déconnexion).
  await rail.waitFor({ state: 'detached', timeout: 10000 });
  const railGone = (await rail.count()) === 0;
  step(
    'N15',
    res.status() === 200 && railGone,
    `POST /auth/logout -> HTTP ${res.status()}, retour sur ${page.url()}, rail démonté=${railGone}`,
  );
}
