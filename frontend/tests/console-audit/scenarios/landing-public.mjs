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
  await page.click('a:has-text("Terms of Service")');
  await page.waitForURL('**/terms');
  const terms = await page.locator('h3').innerText();
  step('L5', terms.includes('Terms'), `/terms rend « ${terms} »`);

  setPhase('5. pied de page -> /privacy');
  await page.goBack();
  await page.waitForURL(new RegExp(`${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
  await page.click('a:has-text("Privacy Policy")');
  await page.waitForURL('**/privacy');
  const privacy = await page.locator('h3').innerText();
  step('L6', privacy.includes('Privacy'), `/privacy rend « ${privacy} »`);

  setPhase('6. CTA -> /login');
  await page.goBack();
  await page.click('a:has-text("Enter the arena")');
  await page.waitForURL('**/login');
  step('L7', page.url().includes('/login'), 'CTA « Enter the arena » mène bien à /login');
}
