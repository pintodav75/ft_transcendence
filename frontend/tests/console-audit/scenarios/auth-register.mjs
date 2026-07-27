/**
 * Écran d'inscription, y compris son conflit.
 *
 * ⚠️ `POST /auth/register` est limité à 3/min PAR IP, et le runner en a déjà consommé un
 * pour créer le compte du run : UNE seule soumission serveur ici.
 */
export const name = 'auth-register';
export const surface = '/register — validation client, règle de mot de passe, 409';
export const auth = false;

export async function run({
  page,
  setPhase,
  step,
  countRequests,
  awaitRegisterSlot,
  expectHttp,
  user,
  ORIGIN,
}) {
  setPhase('1. /register, chargement anonyme');
  await page.goto(`${ORIGIN}/register`, { waitUntil: 'networkidle' });
  step('R1', (await page.locator('#pseudo').count()) === 1, "formulaire d'inscription rendu");

  setPhase('2. validation client (aucune requête attendue)');
  const emptyReqs = await countRequests(async () => {
    await page.click('button:has-text("Create account")');
    await page.waitForTimeout(600);
  });
  const emptyMsgs = await page.locator('p[role="alert"]').count();
  step(
    'R2',
    emptyReqs === 0 && emptyMsgs > 0,
    `${emptyMsgs} message(s), ${emptyReqs} requête(s) (0 attendu)`,
  );

  setPhase('3. mot de passe trop faible (aucune requête attendue)');
  // La règle Zod du front doit être le miroir exact de celle du back (≥8, maj, min,
  // chiffre, spécial) : si elle est plus laxiste, le 400 serveur devient une ligne rouge.
  const weakReqs = await countRequests(async () => {
    await page.fill('#pseudo', 'auditweak');
    await page.fill('#email', 'auditweak@example.com');
    await page.fill('#password', 'motdepasse');
    await page.click('button:has-text("Create account")');
    await page.waitForTimeout(600);
  });
  step('R3', weakReqs === 0, `${weakReqs} requête(s) sur mot de passe faible (0 attendu)`);

  setPhase('4. pseudo/email déjà pris -> 409 (chemin nominal)');
  // Le 409 est L'OBJET de cette phase : déclaré pour être listé à part plutôt qu'imputé au
  // ticket. `/auth/register` sert aussi aux inscriptions qui réussissent — c'est le
  // cloisonnement PAR PHASE d'expectHttp qui restreint l'exemption à ce conflit-ci.
  expectHttp(/\/auth\/register/, 'pseudo déjà pris soumis volontairement -> 409 attendu');
  // Réserve un créneau du quota 3/min : sans ça on récolterait un 429 fabriqué par
  // l'audit lui-même, qui se lirait dans le rapport comme une erreur de l'application.
  await awaitRegisterSlot();
  await page.fill('#pseudo', user.pseudo);
  await page.fill('#email', user.email);
  await page.fill('#password', 'Audit-Console-2026!');
  await page.click('button:has-text("Create account")');
  await page.locator('text=already in use').waitFor({ timeout: 10000 });
  step('R4', true, 'message de conflit affiché après le 409');
}
