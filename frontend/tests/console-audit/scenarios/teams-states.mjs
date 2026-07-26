/**
 * `/teams` — les états que FT-1C ne traverse pas : liste vide, conflit de nom, filtre par
 * jeu, et le passage vers la page de détail.
 *
 * Complémentaire de `ft1c-team-logo.mjs`, qui couvre déjà l'ImagePicker et l'upload.
 */
export const name = 'teams-states';
export const surface = '/teams — état vide, 409 nom pris, filtre par jeu, tuile -> détail';

/** Le formulaire est inline (pas une modale) : ouvrir, choisir un jeu, nommer, soumettre. */
async function createTeam(page, gameIndex, teamName) {
  await page.click('button:has-text("Create new team")');
  const form = page.locator('form');
  await form.waitFor();
  await form.locator('div.flex-wrap').first().locator('button').nth(gameIndex).click();
  await page.fill('#team-name', teamName);
  await page.click('button:has-text("Create team")');
}

export async function run({ page, setPhase, step, user, ORIGIN }) {
  setPhase('1. /teams, état vide');
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });
  const empty = await page.locator("text=You're not part of any team.").count();
  step('T1', empty === 1, `message d'état vide présent = ${empty === 1}`);

  setPhase('2. création équipe A');
  const nameA = `Audit A ${user.stamp}`;
  await createTeam(page, 0, nameA);
  await page.locator('[role="status"]').first().waitFor({ timeout: 15000 });
  step('T2', (await page.locator(`text=${nameA}`).count()) > 0, `« ${nameA} » créée`);

  setPhase('3. même nom, même ladder -> 409 (chemin nominal)');
  // Conflit `teams_ladder_name_unique` : le front lit le `code` du 409 pour viser le bon
  // champ, donc c'est un chemin métier assumé — et une ligne rouge de plus.
  await createTeam(page, 0, nameA);
  await page.waitForTimeout(2500);
  const stillForm = await page.locator('form').count();
  step('T3', stillForm === 1, `formulaire toujours ouvert après le conflit = ${stillForm === 1}`);
  await page.click('button:has-text("Cancel")');

  setPhase('4. création équipe B sur un autre jeu');
  const nameB = `Audit B ${user.stamp}`;
  await createTeam(page, 1, nameB);
  await page.locator('[role="status"]').first().waitFor({ timeout: 15000 });
  step('T4', (await page.locator(`text=${nameB}`).count()) > 0, `« ${nameB} » créée sur un 2e jeu`);

  setPhase('5. filtre par jeu');
  // Les boutons de filtre n'existent que pour les jeux où l'utilisateur a une équipe :
  // avec 2 équipes sur 2 jeux, on doit avoir « All » + 2 boutons.
  const filters = page.locator('div.flex-wrap').first().locator('button');
  // `invalidateQueries` relance GET /teams : compter avant que le refetch ait atterri
  // donnerait « 1 bouton » et un faux rouge. On attend que le 3e bouton existe.
  await filters.nth(2).waitFor({ timeout: 10000 });
  const filterCount = await filters.count();
  await filters.nth(1).click();
  await page.waitForTimeout(500);
  const tilesGame1 = await page.locator('ul li').count();
  await filters.nth(2).click();
  await page.waitForTimeout(500);
  const tilesGame2 = await page.locator('ul li').count();
  await filters.first().click();
  step(
    'T5',
    filterCount === 3 && tilesGame1 >= 1 && tilesGame2 >= 1,
    `${filterCount} boutons de filtre, ${tilesGame1} puis ${tilesGame2} tuile(s)`,
  );

  setPhase('6. tuile -> page de détail');
  await page.waitForTimeout(400);
  await page.locator('ul li a').first().click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 10000 });
  step('T6', /\/teams\/[0-9a-f-]{36}/.test(page.url()), `détail atteint : ${page.url().split('/').pop()}`);
}
