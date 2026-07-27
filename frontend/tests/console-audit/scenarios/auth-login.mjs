/**
 * Écran de connexion, y compris son chemin d'échec.
 *
 * ⚠️ `POST /auth/login` est limité à 5/min PAR IP : UNE seule tentative fautive ici,
 * jamais de boucle. Un 429 déclenché par l'audit casserait tous les scénarios suivants
 * et rendrait le rapport illisible.
 */
export const name = 'auth-login';
export const surface = '/login — validation client, bascule mot de passe, 401';
export const auth = false;

export async function run({ page, setPhase, step, countRequests, expectHttp, user, ORIGIN }) {
  setPhase('1. /login, chargement anonyme');
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' });
  step('C1', (await page.locator('#email').count()) === 1, 'formulaire de connexion rendu');

  setPhase('2. validation client (aucune requête attendue)');
  // Zod doit trancher AVANT le réseau : une soumission vide qui part au serveur serait
  // à la fois un aller-retour inutile et une ligne rouge de plus.
  const emptyReqs = await countRequests(async () => {
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(600);
  });
  const emptyMsgs = await page.locator('p[role="alert"]').count();
  step(
    'C2',
    emptyReqs === 0 && emptyMsgs > 0,
    `${emptyMsgs} message(s), ${emptyReqs} requête(s) (0 attendu)`,
  );

  setPhase('3. email malformé (aucune requête attendue)');
  const badMailReqs = await countRequests(async () => {
    await page.fill('#email', 'pas-un-email');
    await page.fill('#password', 'Whatever-1!');
    await page.click('button:has-text("Sign in")');
    await page.waitForTimeout(600);
  });
  step('C3', badMailReqs === 0, `${badMailReqs} requête(s) sur email invalide (0 attendu)`);

  setPhase('4. bascule afficher/masquer le mot de passe');
  await page.click('button[aria-label="Show password"]');
  const shown = await page.locator('#password').getAttribute('type');
  await page.click('button[aria-label="Hide password"]');
  const hidden = await page.locator('#password').getAttribute('type');
  step('C4', shown === 'text' && hidden === 'password', `type : ${shown} -> ${hidden}`);

  setPhase('5. mot de passe faux -> 401 (chemin nominal)');
  // UNE seule fois : c'est le geste utilisateur le plus banal qui soit, et il peint la
  // console en rouge. C'est précisément ce que l'audit doit chiffrer.
  // Le 401 est L'OBJET de cette phase : déclaré pour être listé à part plutôt qu'imputé au
  // ticket. `/auth/login` ne discrimine pas à lui seul (le login réussi passe par la même
  // route), c'est le cloisonnement PAR PHASE d'expectHttp qui restreint l'exemption ici.
  expectHttp(/\/auth\/login/, 'mot de passe faux soumis volontairement -> 401 attendu');
  await page.fill('#email', user.email);
  await page.fill('#password', 'Mauvais-Mot-De-Passe-1!');
  await page.click('button:has-text("Sign in")');
  await page.locator('text=Invalid email or password.').waitFor({ timeout: 10000 });
  step('C5', true, 'message « Invalid email or password. » affiché après le 401');

  setPhase('6. lien vers /register');
  await page.click('a:has-text("Create account")');
  await page.waitForURL('**/register');
  step('C6', page.url().includes('/register'), 'lien « Create account » fonctionnel');
}
