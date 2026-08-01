/**
 * Landing publique + les deux pages légales.
 *
 * Audité DÉCONNECTÉ : `/` redirige vers `/home` dès qu'une session existe, donc un
 * scénario authentifié n'auditerait jamais cet écran. C'est aussi le seul endroit où
 * l'on voit ce que voit un correcteur qui arrive sur l'app sans compte.
 */
export const name = 'landing-public';
export const surface = '/ (landing), /terms, /privacy — déconnecté';
export const auth = false;

export async function run({ page, setPhase, step, ORIGIN }) {
  setPhase('1. landing, chargement anonyme');
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });

  const cta = await page.locator('a:has-text("Join the arena"), a:has-text("Enter the arena")').count();
  step('L1', cta === 2, `${cta} CTA du hero (2 attendus)`);

  // GamesCards tire GET /games + GET /ladders au montage : une grille vide voudrait dire
  // que l'écran n'a rien chargé, et l'audit ne prouverait rien.
  const cards = page.locator('ul[role="list"] > li');
  const cardCount = await cards.count();
  step('L2', cardCount > 0, `${cardCount} carte(s) de jeu rendues`);

  setPhase('2. focus clavier sur une carte');
  // L'overlay est révélé en `group-focus-within` : au clavier, pas seulement au survol.
  await cards.first().focus();
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  step('L3', focusedTag === 'LI', `élément focus = ${focusedTag} (LI attendu)`);

  setPhase('3. sélecteur de langue (aucun handler branché)');
  const select = page.locator('select[aria-label="language"]');
  if ((await select.count()) > 0) {
    await select.selectOption({ index: 1 });
    step('L4', true, 'langue changée (i18n non câblée, on vérifie juste le silence)');
  } else {
    step('L4', true, 'sélecteur de langue masqué à ce breakpoint — ignoré');
  }

  setPhase('4. pied de page -> /terms');
  await page.click('footer a:has-text("Terms of Service")');
  await page.waitForURL('**/terms');
  // 🔑 `waitForURL` REND LA MAIN AVANT LE RENDU (invariant #11) : l'URL change au clic, React
  // échange l'écran une frame plus tard. Sans cette attente, L5 lisait le `<h1>` de la landing
  // et L6 comptait 0 clause — trois rouges qui n'accusaient que le harnais. On attend une
  // entrée de sommaire PROPRE à ce document (`#scope` n'existe que dans les CGU), jamais ce
  // que le check affirme ensuite : sinon le check devient une tautologie.
  await page.locator('nav[aria-label="On this page"] a[href="#scope"]').waitFor();
  const terms = await page.locator('main h1').innerText();
  // ⚠️ `innerText` rend le texte AFFICHÉ : `label-caps-black` met le titre en capitales via
  // `text-transform`, le DOM lui contient « Terms of Service ». On compare sans la casse.
  step(
    'L5',
    terms.trim().toLowerCase() === 'terms of service',
    `/terms rend « ${terms} »`,
  );

  // 🚨 UN PLACEHOLDER SUR CES DEUX PAGES EST UN MOTIF DE REJET DU PROJET. Le check ne lit
  // donc pas seulement le titre : il compte les clauses. Les deux documents en ont 13, et
  // un retour au « Page Terms of services! » d'origine tomberait à zéro.
  const termsClauses = await page.locator('main section[id] h2').count();
  step('L6', termsClauses >= 13, `/terms rend ${termsClauses} clause(s) (≥ 13 attendues)`);

  setPhase('5. sommaire -> ancre interne');
  // Le sommaire est en `<a href="#…">` nu, PAS en <Link> : un saut dans la page n'est pas
  // une navigation. On vérifie qu'il ne quitte pas la route et que la cible existe.
  await page.click('nav[aria-label="On this page"] a[href="#liability"]');
  step(
    'L7',
    page.url().endsWith('/terms#liability') && (await page.locator('#liability').count()) === 1,
    `ancre suivie sans quitter /terms (url = ${page.url().replace(ORIGIN, '')})`,
  );

  setPhase('6. lien croisé -> /privacy');
  await page.click('footer a:has-text("Privacy Policy")');
  await page.waitForURL('**/privacy');
  // Même attente qu'en phase 4, sur l'ancre propre à la politique (`#who`).
  await page.locator('nav[aria-label="On this page"] a[href="#who"]').waitFor();
  const privacy = await page.locator('main h1').innerText();
  step(
    'L8',
    privacy.trim().toLowerCase() === 'privacy policy',
    `/privacy rend « ${privacy} »`,
  );

  const privacyClauses = await page.locator('main section[id] h2').count();
  step('L9', privacyClauses >= 13, `/privacy rend ${privacyClauses} clause(s) (≥ 13 attendues)`);

  // Une politique de confidentialité sans destinataire n'en est pas une : le correcteur
  // doit trouver à qui écrire pour exercer ses droits.
  const contacts = await page.locator('#contact a[href^="mailto:"]').count();
  step('L10', contacts === 4, `${contacts} adresse(s) de contact (4 mainteneurs attendus)`);

  setPhase('7. CTA -> /login');
  // `goto` et non `goBack()` : la page légale a été atteinte par un lien croisé, l'entrée
  // précédente de l'historique est /terms, pas la landing.
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  await page.click('a:has-text("Enter the arena")');
  await page.waitForURL('**/login');
  step('L11', page.url().includes('/login'), 'CTA « Enter the arena » mène bien à /login');
}
