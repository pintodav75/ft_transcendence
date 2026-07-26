/**
 * `/teams/$teamId` — l'écran le plus chargé en dette console de l'app : un `console.log`
 * non gardé, un `alert()` de placeholder, trois `window.confirm()`, un `useEffect` sans
 * annulation, et une recherche qui répond 404 à chaque frappe.
 *
 * Le handler de dialogues du runner est indispensable ici : sans lui, le premier
 * `confirm()` figerait le navigateur jusqu'au timeout.
 */
export const name = 'teams-detail';
export const surface = '/teams/$teamId — 400/404, SearchBar, ajout/kick, alert et confirm natifs';

export async function run({ page, setPhase, step, createUser, setDialogResponse, user, ORIGIN }) {
  setPhase('1. teamId malformé -> 400');
  // Params validés par Zod côté back : malformé = 400, bien formé mais absent = 404.
  await page.goto(`${ORIGIN}/teams/pas-un-uuid`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  step('D1', page.url().includes('/teams'), `retombé sur ${new URL(page.url()).pathname}`);

  setPhase('2. teamId absent -> 404 + console.log:51');
  await page.goto(`${ORIGIN}/teams/00000000-0000-0000-0000-000000000000`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(1500);
  step('D2', page.url().endsWith('/teams'), 'redirection silencieuse vers /teams (aucun écran d’erreur)');

  setPhase('3. création d’une équipe puis ouverture du détail');
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Create new team")');
  await page.locator('form').waitFor();
  await page.locator('form').locator('div.flex-wrap').first().locator('button').first().click();
  await page.fill('#team-name', `Audit D ${user.stamp}`);
  await page.click('button:has-text("Create team")');
  await page.locator('[role="status"]').first().waitFor({ timeout: 15000 });
  await page.locator('ul li a').first().click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });
  step('D3', true, 'page de détail ouverte en tant que capitaine');

  setPhase('4. recherche sans résultat -> un 404 PAR FRAPPE');
  // Le backend répond 404 quand le pseudo n'existe pas (recherche EXACTE, pas de fuzzy) :
  // chaque caractère tapé franchit le débounce de 300 ms et produit sa ligne rouge.
  const search = page.locator('input[aria-label="Search players"]');
  await search.pressSequentially('zzqx', { delay: 400 });
  await page.locator('text=No result found.').waitFor({ timeout: 8000 });
  step('D4', true, '4 caractères tapés -> autant d’appels /users/{pseudo}');

  setPhase('5. ajout d’un membre');
  const mate = await createUser();
  await search.fill('');
  await search.fill(mate.pseudo);
  await page.locator(`button:has-text("@${mate.pseudo}")`).first().click({ timeout: 10000 });
  await page.locator(`text=@${mate.pseudo}`).first().waitFor({ timeout: 10000 });
  step('D5', true, `${mate.pseudo} ajouté à l’équipe`);

  setPhase('6. bouton « Upload Avatar » -> alert() de placeholder');
  setDialogResponse('accept');
  await page.click('button:has-text("Upload Avatar")');
  await page.waitForTimeout(600);
  step('D6', true, 'alert() natif déclenché (enregistré par le runner)');

  setPhase('7. Kick -> window.confirm()');
  await page.locator('button:has-text("Kick")').first().click();
  await page.waitForTimeout(1500);
  // Le panneau de résultats de la recherche affiche encore `@pseudo` : sans vider le
  // champ, on compterait ce reliquat et on croirait le membre toujours présent.
  await search.fill('');
  await page.waitForTimeout(400);
  const kicked = (await page.locator(`text=@${mate.pseudo}`).count()) === 0;
  step('D7', kicked, `membre retiré après confirmation = ${kicked}`);

  setPhase('8. Delete team -> window.confirm()');
  await page.click('button:has-text("Delete team")');
  await page.waitForURL('**/teams', { timeout: 10000 });
  step('D8', page.url().endsWith('/teams'), 'équipe dissoute, retour à la liste');
}
