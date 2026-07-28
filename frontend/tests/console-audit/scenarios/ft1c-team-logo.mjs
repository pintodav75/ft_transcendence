/**
 * FT-1C — upload du logo d'équipe.
 *
 * Surface auditée : `/teams` (grille + TeamCard), le formulaire de création,
 * `ImagePicker` (sélection, validation client, aperçu blob, progression, retrait)
 * et `POST /teams/{id}/logo`.
 */
export const name = 'ft1c-team-logo';
export const surface = 'ImagePicker + /teams + POST /teams/:id/logo';

export async function run({ page, awaitAnnouncement, setPhase, step, countRequests, fixtures, user, ORIGIN }) {
  // ---------------------------------------------------------------- §1 affichage
  setPhase('1. /teams affichage');
  await page.goto(`${ORIGIN}/teams`, { waitUntil: 'networkidle' });

  // Un <img> sans src (ou src="") fait RECHARGER la page courante par Chrome : requête
  // fantôme dans Network, et une ligne dans la console.
  const emptySrc = await page.evaluate(
    () => document.querySelectorAll('img:not([src]), img[src=""]').length,
  );
  step('1.1', emptySrc === 0, `${emptySrc} <img> sans src (0 attendu)`);

  setPhase('1.3 montage/démontage répété');
  // PAS de page.goto pour ce check : un goto recharge toute la SPA et recompterait le
  // bandeau du serveur de dev à chaque tour — on mesurerait Vite, pas l'application.
  // Le rail de navigation existe depuis [F-Nav], mais ses liens QUITTENT /teams : ils ne
  // remontent donc pas la grille ni ImagePicker, qui sont l'objet de ce check. Le seul vrai
  // cycle client de cette page reste l'ouverture/fermeture du formulaire, qui monte et
  // démonte les deux. (Le rail, lui, a son propre scénario : `f-nav`.)
  for (let i = 0; i < 5; i++) {
    await page.click('button:has-text("Create new team")');
    await page.locator('form').waitFor();
    // Scopé au FORMULAIRE : depuis [F-Nav] le rail monte en permanence le <dialog> de
    // confirmation de déconnexion, qui contient lui aussi un bouton d'abandon. Un
    // `page.click('button:has-text("Cancel")')` non scopé prenait le premier du DOM —
    // celui du dialogue fermé, donc `display:none`, donc 30 s d'attente puis un exit 2.
    await page.locator('form button:has-text("Cancel")').click();
    await page.locator('button:has-text("Create new team")').waitFor();
  }
  step('1.3', true, '5 cycles monter/démonter effectués');

  // ---------------------------------------------------------------- §3 validation
  await page.click('button:has-text("Create new team")');
  const form = page.locator('form');
  await form.waitFor();
  // Premier groupe de boutons = les jeux ; le clic sélectionne aussi le premier ladder.
  await form.locator('div.flex-wrap').first().locator('button').first().click();
  const fileInput = form.locator('input[type=file]');

  setPhase('3.1 MIME refusé');
  let reqs = await countRequests(async () => {
    await fileInput.setInputFiles(fixtures.bad);
    await page.waitForTimeout(400);
  });
  const gifMsg = await page.locator('text=Use a JPEG, PNG or WebP image.').count();
  step('3.1', gifMsg === 1 && reqs === 0, `message=${gifMsg === 1}, ${reqs} requête(s) (0 attendu)`);

  setPhase('3.3 re-sélection du même fichier');
  // Sans le reset `inputRef.current.value = ''`, re-choisir le MÊME fichier invalide ne
  // redéclenche pas onChange : l'utilisateur ne verrait plus aucun message.
  await fileInput.setInputFiles(fixtures.bad);
  await page.waitForTimeout(300);
  const gifMsg2 = await page.locator('text=Use a JPEG, PNG or WebP image.').count();
  step('3.3', gifMsg2 === 1, `message toujours affiché après re-sélection = ${gifMsg2 === 1}`);

  setPhase('3.2 taille refusée');
  reqs = await countRequests(async () => {
    await fileInput.setInputFiles(fixtures.big);
    await page.waitForTimeout(600);
  });
  const bigMsg = await page.locator('text=Image is too large').count();
  step('3.2', bigMsg === 1 && reqs === 0, `message=${bigMsg === 1}, ${reqs} requête(s) (0 attendu)`);

  // ---------------------------------------------------------------- §2 aperçu
  setPhase('2. ImagePicker aperçu');
  await fileInput.setInputFiles(fixtures.ok);
  await page.waitForTimeout(300);
  const previewSrc = await form.locator('img').first().getAttribute('src');
  step('2.1', previewSrc?.startsWith('blob:') === true, `aperçu = ${previewSrc?.slice(0, 24)}…`);

  // Un revokeObjectURL appelé trop tôt ne casse l'aperçu qu'à partir de la 2ᵉ sélection.
  for (let i = 0; i < 3; i++) {
    await fileInput.setInputFiles(fixtures.ok);
    await page.waitForTimeout(250);
  }
  const decoded = await form
    .locator('img')
    .first()
    .evaluate((img) => img.complete && img.naturalWidth > 0);
  step('2.2', decoded, `aperçu toujours décodé après 3 re-sélections = ${decoded}`);

  setPhase('2.3 retrait');
  await form.locator('button:has-text("Remove")').click();
  await page.waitForTimeout(200);
  const gone = (await form.locator('img').count()) === 0;
  step('2.3', gone, `aperçu retiré = ${gone}`);

  // ---------------------------------------------------------------- §4 upload réel
  setPhase('4. upload POST /teams/:id/logo');
  await fileInput.setInputFiles(fixtures.ok);
  const teamName = `Audit ${user.stamp}`;
  await page.fill('#team-name', teamName);

  const uploadRes = page.waitForResponse(
    (r) => /\/api\/teams\/[^/]+\/logo$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await page.click('button:has-text("Create team")');
  const res = await uploadRes;
  step('4.1', res.status() === 200, `POST .../logo -> HTTP ${res.status()}`);

  // ⚠️ Le TEXTE, pas l'élément : la région live est montée en permanence (une seule par écran
  // depuis FX-FOCUS), un waitFor sur sa présence rendait la main sur une bannière vide.
  await awaitAnnouncement(teamName);
  const banner = await page.locator('[role=status]').first().innerText();
  step('4.1b', banner.includes(teamName), `bannière : « ${banner.trim()} »`);

  setPhase('4.2 logo servi par /media');
  await page.reload({ waitUntil: 'networkidle' });
  const logo = page.locator('img[src^="/media/"]').first();
  const hasLogo = (await logo.count()) > 0;
  const logoDecoded = hasLogo
    ? await logo.evaluate((img) => img.complete && img.naturalWidth > 0)
    : false;
  step('4.2', hasLogo && logoDecoded, `<img src="/media/…"> présent=${hasLogo}, décodé=${logoDecoded}`);

  setPhase('4.4 création sans logo');
  await page.click('button:has-text("Create new team")');
  await form.waitFor();
  // DEUXIÈME jeu : un compte ne peut pas avoir deux équipes sur le même ladder
  // (contrainte team_members_user_ladder_unique -> 409 already_in_team), et on
  // mesurerait alors une création qui n'a jamais eu lieu.
  await form.locator('div.flex-wrap').first().locator('button').nth(1).click();
  await page.fill('#team-name', `Audit ${user.stamp} bis`);
  const uploadCalls = await countRequests(
    async () => {
      await page.click('button:has-text("Create team")');
      await page.waitForTimeout(2500);
    },
    (url) => url.includes('/logo'),
  );
  // Même règle : l'annonce de la 2ᵉ équipe doit être ARRIVÉE avant d'être lue.
  await awaitAnnouncement(' bis');
  const bis = await page.locator('[role=status]').first().innerText();
  step(
    '4.4',
    uploadCalls === 0 && bis.includes('bis'),
    `${uploadCalls} requête(s) d'upload (0 attendu), équipe bien créée = ${bis.includes('bis')}`,
  );
}
