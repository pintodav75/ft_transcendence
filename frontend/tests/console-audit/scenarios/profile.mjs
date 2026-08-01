import { createHmac } from 'node:crypto';

/**
 * F4 — page de réglages `/profile`.
 *
 * Surface auditée : les quatre sections de la page (avatar, profil, mot de passe, 2FA), la
 * règle d'image partagée `lib/image-file.ts`, le mapping d'erreurs de `lib/profile-mutations.ts`,
 * la région live unique et la restauration du focus.
 *
 * 🚨 DEUX PIÈGES DE TEARDOWN, tous deux imposés par `deleteAuditUser` du runner :
 *
 *   ① Il supprime le compte avec `{ password: user.password }` et **aucun `totpCode`**. Un run
 *     qui laisserait la 2FA ACTIVÉE rendrait le compte insupprimable → « compte(s) NON
 *     supprimé(s) » et un utilisateur orphelin dans la base de dev à chaque campagne. La
 *     phase 5 réactive donc toujours l'état de départ (enable puis disable), et c'est la
 *     raison d'être du check 5.6.
 *   ② Il envoie `user.password`, l'original. Ce scénario ne fait donc JAMAIS aboutir un
 *     changement de mot de passe : il ne teste que le refus (401), qui est de toute façon le
 *     seul comportement que la review demande de garder (le compte de requêtes de B2).
 *
 * Hors périmètre, assumé :
 *   - le succès du changement de mot de passe (voir ② ci-dessus) ;
 *   - le rendu visuel du QR code (une image opaque pour le harnais) ;
 *   - la barre de progression de l'upload : en local le transfert est trop rapide pour être
 *     échantillonné de façon déterministe. `teams-manage` la couvre déjà sur le logo d'équipe,
 *     et c'est le MÊME `ui/progress-bar.tsx` alimenté par le MÊME `lib/upload.ts`.
 */
export const name = 'profile';
export const surface = '/profile — avatar, profil, mot de passe, 2FA';

// ------------------------------------------------------------------------------- TOTP

/** Décode une chaîne base32 (RFC 4648) en octets. */
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];

  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

/**
 * Code TOTP à 6 chiffres pour un secret base32 : HMAC-SHA1, pas de 30 s, troncature
 * dynamique (RFC 6238). Ce sont les réglages par défaut de `speakeasy`, que le backend
 * utilise pour vérifier — donc le seul algorithme qui produise un code accepté.
 *
 * ⚠️ Le secret n'est PAS deviné : il est lu dans la page, sous le QR code. C'est le correctif
 * NB5 qui rend ce scénario possible — avant lui, seule l'image du QR portait l'information,
 * et un harnais (comme un lecteur d'écran) n'en tire rien.
 */
function totp(secret, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;

  return String(code).padStart(6, '0');
}

// ------------------------------------------------------------------------------- run

export async function run({
  page,
  setPhase,
  step,
  countRequests,
  fixtures,
  user,
  ORIGIN,
  awaitAnnouncement,
  awaitFocusRestored,
  focusLanding,
  expectHttp,
}) {
  // ------------------------------------------------------------ §1 chargement
  setPhase('1. chargement de /profile (sans avatar)');
  await page.goto(`${ORIGIN}/profile`, { waitUntil: 'networkidle' });

  // ⚠️ `textContent` et non `innerText` : `label-caps-black` applique `text-transform:
  // uppercase`, donc `innerText` — qui lit le texte RENDU — renverrait « PROFILE ». On
  // vérifie ce que le DOM porte, pas ce que la CSS en fait.
  const heading = (await page.locator('h1').textContent())?.trim();
  step('1.1', heading === 'Profile', `<h1> = « ${heading} » (« Profile » attendu)`);

  // Un <img> sans src (ou src="") fait RECHARGER la page courante par Chrome : requête
  // fantôme dans Network et une ligne de console.
  const emptySrc = await page.evaluate(
    () => document.querySelectorAll('img:not([src]), img[src=""]').length,
  );
  step('1.2', emptySrc === 0, `${emptySrc} <img> sans src (0 attendu)`);

  // Compte neuf : aucun avatar, donc le repli en initiales doit être rendu — et surtout PAS
  // une balise <img> vide.
  const initials = user.pseudo.slice(0, 2).toUpperCase();
  const fallbackShown = await page
    .locator(`[role="group"][aria-label="Avatar"] >> text=${initials}`)
    .count();
  step('1.3', fallbackShown === 1, `repli initiales « ${initials} » affiché = ${fallbackShown === 1}`);

  // 🔑 Le check central de NB2 : DEUX régions live se disputent la lecture, le lecteur
  // d'écran en annonce une, l'autre, ou les deux dans un ordre imprévisible.
  // ⚠️ Le compte est scopé à <main>, comme dans `history`, `solo` et `matchmaking` : depuis
  // FS-0, le rail social monte SA propre région (`SocialPanel`), HORS de <main>, sur toute
  // page authentifiée. La compter ici ferait rougir F4 pour une région qui ne lui appartient
  // pas — et masquerait le vrai défaut, qui est d'en avoir deux DANS la page.
  const liveRegions = await page.locator('main').locator('[role="status"]').count();
  step(
    '1.4',
    liveRegions === 1,
    `${liveRegions} région(s) live dans <main> (exactement 1 attendue)`,
  );

  // Les intitulés de section doivent être de vrais titres : avant F4 c'étaient des <span>
  // stylés, et <main> se retrouvait sans un seul niveau de titre.
  const headings = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h1, h2')).map((h) => `${h.tagName}:${h.textContent.trim()}`),
  );
  const hasSections = ['Details', 'Password', 'Two-factor authentication'].every((title) =>
    headings.includes(`H2:${title}`),
  );
  step('1.5', hasSections, `titres = [${headings.join(' | ')}]`);

  // ------------------------------------------------------------ §2 avatar
  setPhase('2. avatar — validation client');
  const avatarBlock = page.locator('[role="group"][aria-label="Avatar"]');
  const fileInput = avatarBlock.locator('input[type=file]');

  // Type refusé : la règle vit dans `lib/image-file.ts` et est partagée avec ImagePicker.
  // Le message est asserté au caractère près par `ft1c-team-logo` — si les deux divergent un
  // jour, c'est que quelqu'un a recopié la règle au lieu de l'importer.
  let reqs = await countRequests(async () => {
    await fileInput.setInputFiles(fixtures.bad);
    await page.waitForTimeout(400);
  });
  const badTypeMsg = await page.locator('text=Use a JPEG, PNG or WebP image.').count();
  step('2.1', badTypeMsg === 1 && reqs === 0, `message=${badTypeMsg === 1}, ${reqs} requête(s) (0 attendue)`);

  setPhase('2.2 taille refusée');
  reqs = await countRequests(async () => {
    await fileInput.setInputFiles(fixtures.big);
    await page.waitForTimeout(400);
  });
  const tooLargeMsg = await page.locator('text=Image is too large').count();
  step('2.2', tooLargeMsg === 1 && reqs === 0, `message=${tooLargeMsg === 1}, ${reqs} requête(s) (0 attendue)`);

  setPhase('2.3 upload nominal');
  await fileInput.setInputFiles(fixtures.ok);
  // Le déclencheur disparaît tant qu'une image attend une décision : Confirm et Cancel sont
  // les deux seules suites possibles.
  const triggerHidden = await avatarBlock.getByRole('button', { name: 'Add' }).count();
  step('2.3', triggerHidden === 0, `bouton « Add » masqué pendant l'attente = ${triggerHidden === 0}`);

  await avatarBlock.getByRole('button', { name: 'Confirm' }).click();
  await awaitAnnouncement('Avatar updated.');
  // ⚠️ awaitAnnouncement AVANT focusLanding : ce dernier est un INSTANTANÉ, il n'attend rien.
  const afterUpload = await focusLanding();
  step(
    '2.4',
    afterUpload.tag !== 'BODY' && afterUpload.label === 'Avatar',
    `focus après Confirm : <${afterUpload.tag}> « ${afterUpload.label} » (jamais BODY)`,
  );

  setPhase('2.5 avatar servi par le serveur');
  await page.reload({ waitUntil: 'networkidle' });
  const served = await avatarBlock.locator('img[src^="/media/"]').count();
  step('2.5', served === 1, `<img src="/media/…"> après rechargement = ${served === 1}`);

  // Sans le reset `event.target.value = ''`, re-choisir le MÊME fichier ne redéclenche pas
  // `change` : le second choix est silencieux et l'utilisateur croit l'application figée.
  setPhase('2.6 re-sélection du même fichier après Cancel');
  await avatarBlock.locator('input[type=file]').setInputFiles(fixtures.ok);
  await avatarBlock.getByRole('button', { name: 'Cancel' }).click();
  await avatarBlock.locator('input[type=file]').setInputFiles(fixtures.ok);
  const repicked = await avatarBlock.getByRole('button', { name: 'Confirm' }).count();
  step('2.6', repicked === 1, `le même fichier redéclenche l'aperçu = ${repicked === 1}`);
  await avatarBlock.getByRole('button', { name: 'Cancel' }).click();

  // NB9 : la suppression détruit l'objet MinIO, donc elle passe par une confirmation — et le
  // bouton se trouve à quelques pixels de celui qui change simplement d'image.
  setPhase('2.7 suppression — Escape annule');
  await avatarBlock.getByRole('button', { name: 'Remove' }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const stillThere = await avatarBlock.locator('img[src^="/media/"]').count();
  step('2.7', stillThere === 1, `Escape annule, avatar intact = ${stillThere === 1}`);

  setPhase('2.8 suppression confirmée');
  await avatarBlock.getByRole('button', { name: 'Remove' }).click();
  await dialog.waitFor();

  /**
   * 🔑 `removeAvatarErrorMessage` n'était exercé par AUCUN check — comme 3 de ses 6 voisins de
   * `lib/profile-mutations.ts`. Ces fonctions n'ont qu'un travail : empêcher la prose serveur
   * d'atteindre l'écran. Sans check, l'une d'elles peut rendre `undefined` sans que rien ne le voie.
   *
   * ⚠️ La panne est fabriquée par `page.route`, PAS en cassant MinIO : rien à restaurer.
   * ⚠️ En échec, `handleRemove` ne fait que `setError` — le `setConfirmingRemoval(false)` est
   * APRÈS l'`await`, donc le dialogue reste ouvert et la suppression réelle enchaîne juste après,
   * sur le même dialogue. Le garde-fou de teardown (finir sans avatar) est intact.
   */
  const avatarRoute = '**/api/users/me/avatar';
  expectHttp(/\/api\/users\/me\/avatar/, 'suppression d’avatar volontairement refusée -> 500 attendu');
  await page.route(avatarRoute, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
      : route.continue(),
  );
  try {
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await page.waitForTimeout(400);
    const removeMapped = await dialog.locator('text=Could not remove your avatar.').count();
    const avatarKept = await avatarBlock.locator('img[src^="/media/"]').count();
    step(
      '2.8b',
      removeMapped === 1 && avatarKept === 1,
      `message mappé dans le dialogue=${removeMapped === 1} (jamais la prose serveur), avatar conservé=${avatarKept === 1}`,
    );
  } finally {
    await page.unroute(avatarRoute);
  }

  await dialog.getByRole('button', { name: 'Remove' }).click();
  await awaitAnnouncement('Avatar removed.');
  // ⚠️ awaitAnnouncement AVANT focusLanding : confirmer DÉTRUIT le bouton « Remove » qui avait
  // le focus, et sans `returnFocusRef` le navigateur le laisse tomber sur <body>.
  const afterRemove = await focusLanding();
  const backToInitials = await avatarBlock.locator(`text=${initials}`).count();
  const addAgain = await avatarBlock.getByRole('button', { name: 'Add' }).count();
  step(
    '2.8',
    backToInitials === 1 && addAgain === 1 && afterRemove.tag !== 'BODY',
    `retour aux initiales=${backToInitials === 1}, bouton « Add »=${addAgain === 1}, focus=<${afterRemove.tag}> « ${afterRemove.label} »`,
  );

  // ------------------------------------------------------------ §3 profil
  setPhase('3. profil — bio trop longue');
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await page.locator('#bio').waitFor();

  // L'AUTRE moitié de NB1 : le compte d'audit n'a pas de `displayName`, et le champ est
  // désormais obligatoire. S'il s'ouvrait vide, ce compte ne pourrait plus enregistrer sa
  // bio sans s'inventer un pseudo — le correctif se retournerait contre l'utilisateur.
  const prefilled = await page.locator('#displayName').inputValue();
  step('3.0', prefilled === user.pseudo, `champ pré-rempli avec « ${prefilled} » (« ${user.pseudo} » attendu)`);

  reqs = await countRequests(async () => {
    await page.locator('#bio').fill('x'.repeat(281));
    await page.locator('form button:has-text("Save")').click();
    await page.waitForTimeout(400);
  });
  const bioInvalid = await page.locator('#bio[aria-invalid="true"]').count();
  step('3.1', bioInvalid === 1 && reqs === 0, `aria-invalid=${bioInvalid === 1}, ${reqs} requête(s) (0 attendue)`);

  // 🔑 NB1 : vider le pseudo était SILENCIEUSEMENT ignoré — le champ partait comme « absent »,
  // l'API répondait 200, et rien ne changeait. Un refus explicite vaut mieux qu'un succès qui ment.
  setPhase('3.2 pseudo vidé (NB1)');
  await page.locator('#bio').fill('Audited bio.');
  reqs = await countRequests(async () => {
    await page.locator('#displayName').fill('');
    await page.locator('form button:has-text("Save")').click();
    await page.waitForTimeout(400);
  });
  const nameInvalid = await page.locator('#displayName[aria-invalid="true"]').count();
  const emptyNameMsg = await page.locator('text=it cannot be empty').count();
  step(
    '3.2',
    nameInvalid === 1 && emptyNameMsg === 1 && reqs === 0,
    `aria-invalid=${nameInvalid === 1}, message=${emptyNameMsg === 1}, ${reqs} requête(s) (0 attendue)`,
  );

  setPhase('3.3 enregistrement nominal');
  await page.locator('#displayName').fill('Audited Name');
  await page.locator('form button:has-text("Save")').click();
  await awaitAnnouncement('Profile saved.');
  const afterSave = await focusLanding();
  step(
    '3.3',
    afterSave.tag === 'H2' && afterSave.label === 'Details',
    `focus après Save : <${afterSave.tag}> « ${afterSave.label} » (H2 « Details » attendu, JAMAIS BODY)`,
  );

  const savedName = await page.locator('text=Audited bio.').count();
  step('3.4', savedName === 1, `bio enregistrée et réaffichée = ${savedName === 1}`);

  setPhase('3.5 Cancel restaure');
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await page.locator('#bio').fill('Discarded.');
  await page.locator('form button:has-text("Cancel")').click();
  await awaitFocusRestored();
  const restored = await page.locator('text=Audited bio.').count();
  const afterCancel = await focusLanding();
  step(
    '3.5',
    restored === 1 && afterCancel.tag !== 'BODY',
    `bio restaurée = ${restored === 1}, focus = <${afterCancel.tag}> « ${afterCancel.label} »`,
  );

  // ------------------------------------------------------------ §4 mot de passe
  setPhase('4. mot de passe — mauvais mot de passe courant');
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.locator('#currentPassword').waitFor();

  // 🔑 LE CHECK QUI GARDE B2. Le backend répond 401 quand `currentPassword` est faux, et
  // `lib/api.ts` lit TOUT 401 comme « token expiré » : sans `skipAuthRefresh`, il rafraîchit
  // et REJOUE la requête. Deux conséquences mesurables : le quota de 5/min de la route est
  // épuisé en 3 essais au lieu de 5, et la session est VIDÉE si le cookie refresh manque.
  // Une requête = corrigé. Deux = la régression est de retour.
  expectHttp(/\/api\/users\/me\/password/, 'mauvais mot de passe courant -> 401 attendu');

  const passwordReqs = await countRequests(
    async () => {
      await page.locator('#currentPassword').fill('Wrong-Password-1!');
      await page.locator('#newPassword').fill('Another-Valid-1!');
      await page.locator('#confirmPassword').fill('Another-Valid-1!');
      await page.locator('form button:has-text("Save")').click();
      await page.waitForTimeout(1200);
    },
    (url) => url.includes('/api/users/me/password'),
  );
  step('4.1', passwordReqs === 1, `${passwordReqs} requête(s) vers /users/me/password (1 attendue, JAMAIS 2)`);

  // La prose serveur brute (« invalid credentials ») ne doit jamais atteindre l'écran.
  const mappedMsg = await page.locator('text=Your current password is incorrect.').count();
  step('4.2', mappedMsg === 1, `message mappé affiché = ${mappedMsg === 1}`);

  setPhase('4.3 toujours connecté après le refus');
  // Le symptôme le plus visible de B2 : un 401 mal interprété purge la session.
  const stillOnProfile = page.url().includes('/profile');
  step('4.3', stillOnProfile, `toujours sur /profile après le 401 = ${stillOnProfile}`);
  await page.locator('form button:has-text("Cancel")').click();

  // ------------------------------------------------------------ §5 2FA
  setPhase('5. 2FA — mise en place');
  await page.getByRole('button', { name: 'Enable 2FA' }).click();
  await page.locator('#totp-code').waitFor();

  // ⚠️ Scopé au formulaire 2FA, jamais `page.locator('code')` nu : les devtools de TanStack
  // Router montent des dizaines de <code> en développement (52 mesurés), et le mode strict de
  // Playwright fait alors échouer tout le scénario.
  const twoFactorForm = page.locator('form:has(#totp-code)');
  const qrShown = await twoFactorForm.locator('img[alt*="QR"]').count();
  // NB5 : sans le secret en clair, personne dont l'app TOTP tourne sur la même machine (ni
  // aucun lecteur d'écran) ne peut activer la 2FA — et ce scénario ne le pourrait pas non plus.
  let secret = (await twoFactorForm.locator('code').innerText()).trim();
  step(
    '5.1',
    qrShown === 1 && /^[A-Z2-7]{16,}$/.test(secret),
    `QR affiché=${qrShown === 1}, secret base32 lisible (${secret.length} car.) = ${/^[A-Z2-7]{16,}$/.test(secret)}`,
  );

  setPhase('5.2 code invalide');
  expectHttp(/\/api\/auth\/2fa\/enable/, 'code TOTP volontairement faux -> 400 attendu');
  await page.locator('#totp-code').fill('000000');
  await page.getByRole('button', { name: 'Enable', exact: true }).click();
  await page.waitForTimeout(800);
  const invalidCodeMsg = await page.locator('text=That code is not valid').count();
  step('5.2', invalidCodeMsg === 1, `message mappé (pas la prose serveur) = ${invalidCodeMsg === 1}`);

  setPhase('5.3 Cancel remet la section à zéro');
  await twoFactorForm.getByRole('button', { name: 'Cancel' }).click();
  const backToIdle = await page.getByRole('button', { name: 'Enable 2FA' }).count();
  const formGone = await page.locator('#totp-code').count();
  step(
    '5.3',
    backToIdle === 1 && formGone === 0,
    `retour à l'état initial : bouton « Enable 2FA » = ${backToIdle === 1}, formulaire démonté = ${formGone === 0}`,
  );

  setPhase('5.4 activation avec un code valide');
  // ⚠️ Un NOUVEAU secret : `POST /auth/2fa/setup` en régénère un à chaque appel
  // (`2fa.ts` écrase `totpSecret`). Réutiliser celui d'avant le Cancel produirait un code
  // que le serveur refuse — et on croirait à tort que le flux est cassé.
  await page.getByRole('button', { name: 'Enable 2FA' }).click();
  await page.locator('#totp-code').waitFor();
  secret = (await twoFactorForm.locator('code').innerText()).trim();

  await page.locator('#totp-code').fill(totp(secret));
  await page.getByRole('button', { name: 'Enable', exact: true }).click();
  await awaitAnnouncement('Two-factor authentication is on.');
  const afterEnable = await focusLanding();
  const enabledShown = await page.locator('text=Enabled').count();
  step(
    '5.4',
    enabledShown >= 1 && afterEnable.tag === 'H2',
    `état « Enabled » = ${enabledShown >= 1}, focus = <${afterEnable.tag}> « ${afterEnable.label} »`,
  );

  setPhase('5.5 désactivation');
  await page.getByRole('button', { name: 'Disable 2FA' }).click();
  await page.locator('#totp-code').waitFor();
  await page.locator('#totp-code').fill(totp(secret));

  /**
   * 🔑 Second mappeur jamais exercé : `disableTwoFactorErrorMessage`. Le code envoyé est VALIDE —
   * c'est le serveur qu'on fait tomber, pas la saisie : sans ça on testerait `enableTwoFactor`
   * une seconde fois (déjà couvert par 5.2) au lieu du chemin de désactivation.
   *
   * ⚠️ En échec, `onDisable` n'appelle PAS `resetFlow()` : le formulaire reste ouvert, donc la
   * désactivation réelle enchaîne sans repasser par « Disable 2FA ». Le code est recalculé — la
   * fenêtre TOTP est de 30 s et l'aller-retour peut l'avoir franchie.
   */
  const disableRoute = '**/api/auth/2fa/disable';
  expectHttp(/\/api\/auth\/2fa\/disable/, 'désactivation 2FA volontairement refusée -> 500 attendu');
  await page.route(disableRoute, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
  );
  try {
    await page.getByRole('button', { name: 'Disable', exact: true }).click();
    await page.waitForTimeout(400);
    const disableMapped = await page
      .locator('text=Could not turn off two-factor authentication.')
      .count();
    const stillEnabled = await page.locator('text=Enabled').count();
    step(
      '5.5b',
      disableMapped === 1 && stillEnabled >= 1,
      `message mappé=${disableMapped === 1} (jamais la prose serveur), 2FA toujours active=${stillEnabled >= 1}`,
    );
  } finally {
    await page.unroute(disableRoute);
  }

  await page.locator('#totp-code').fill(totp(secret));
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  await awaitAnnouncement('Two-factor authentication is off.');
  const afterDisable = await focusLanding();
  step(
    '5.5',
    afterDisable.tag === 'H2' && afterDisable.label === 'Two-factor authentication',
    `focus après Disable : <${afterDisable.tag}> « ${afterDisable.label} » (JAMAIS BODY)`,
  );

  // ⚠️ Garde-fou de teardown, voir l'en-tête : un compte laissé en 2FA n'est pas supprimable
  // par le runner, qui n'envoie pas de `totpCode`.
  const disabledShown = await page.locator('text=Disabled').count();
  step('5.6', disabledShown >= 1, `2FA bien désactivée avant le teardown = ${disabledShown >= 1}`);

  // ------------------------------------------------------------ §6 compte sans mot de passe
  setPhase('6. compte sans mot de passe local — pas de formulaire');
  /**
   * 🔑 La garde de B3 se fonde sur `hasPassword`, JAMAIS sur `oauthProvider` : le callback
   * Google rattache un provider à un compte retrouvé par email SANS toucher au `passwordHash`
   * (linking cas B). Un tel compte a les deux, et doit garder son formulaire.
   *
   * Sans la garde, un compte sans mot de passe se voit offrir un formulaire que la route
   * refuse systématiquement en 400 : un dead-end, et une ligne rouge en console à CHAQUE essai.
   *
   * ⚠️ Fabriqué par `page.route` (idiome de `history`, `ladder-detail`, `admin-disputes` et
   * `matchmaking`), PAS en base. Mettre `password_hash` à `null` en SQL rendrait le compte
   * INSUPPRIMABLE tant que la valeur n'est pas restaurée — `deleteAuditUser()` présente
   * `user.password`, que le serveur ne pourrait plus vérifier. Un crash dans cette fenêtre
   * laisse un compte orphelin à chaque run : exactement le mode de panne pour lequel NB11 a
   * été abandonné. Ici il n'y a rien à restaurer.
   *
   * 🔑 En prime, le stub produit le cas que le SQL ne savait PAS produire : `oauthProvider`
   * ET `hasPassword: false` ensemble, donc le libellé « Managed by Google » reste vérifiable
   * pendant que c'est bien `hasPassword` qui commande l'affichage.
   */
  const meRoute = '**/api/users/me';
  await page.route(meRoute, async (route) => {
    // Seul le GET de restauration de session est réécrit : un PATCH de profil doit continuer
    // d'atteindre le vrai serveur.
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, user: { ...body.user, oauthProvider: 'google', hasPassword: false } },
    });
  });
  try {
    await page.reload({ waitUntil: 'networkidle' });
    const callout = await page.locator('text=Managed by Google').count();
    const formOffered = await page.getByRole('button', { name: 'Change password' }).count();
    step(
      '6.1',
      callout === 1 && formOffered === 0,
      `encadré affiché=${callout === 1}, formulaire retiré=${formOffered === 0} (0 attendu : la route répondrait 400)`,
    );
  } finally {
    await page.unroute(meRoute);
    await page.reload({ waitUntil: 'networkidle' });
  }

  /**
   * Le pendant POSITIF de 6.1, et la raison d'être de tout le correctif : un compte du cas B
   * (provider rattaché, mot de passe conservé) doit garder son formulaire. C'est ce que
   * l'ancienne garde `oauthProvider` cassait — et aucun check ne le voyait.
   */
  await page.route(meRoute, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, user: { ...body.user, oauthProvider: 'google', hasPassword: true } },
    });
  });
  try {
    await page.reload({ waitUntil: 'networkidle' });
    const callout = await page.locator('text=Managed by Google').count();
    const formOffered = await page.getByRole('button', { name: 'Change password' }).count();
    step(
      '6.2',
      callout === 0 && formOffered === 1,
      `cas B (Google + mot de passe local) : encadré=${callout === 0 ? 'absent' : 'PRÉSENT'}, formulaire offert=${formOffered === 1}`,
    );

    // 🔑 L'usage LÉGITIME de `oauthProvider`, et le seul : dire par quoi on se connecte. Il n'était
    // gardé par rien. Le stub est déjà en place, donc ce check ne coûte aucune mise en place — et
    // il documente la frontière : `oauthProvider` décrit la connexion, `hasPassword` décide du
    // formulaire. Les confondre était le bloquant B3.
    const signInMethod = await page.locator('text=OAuth (google)').count();
    step(
      '6.3',
      signInMethod === 1,
      `méthode de connexion affichée « OAuth (google) » = ${signInMethod === 1} (usage légitime d’oauthProvider)`,
    );
  } finally {
    await page.unroute(meRoute);
    await page.reload({ waitUntil: 'networkidle' });
  }

  // ------------------------------------------------------------ §7 375 px
  setPhase('7. 375 px');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(300);

  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  step(
    '7.1',
    overflow.scroll <= overflow.client,
    `scrollWidth=${overflow.scroll} / clientWidth=${overflow.client} (aucun débordement attendu)`,
  );

  // ⚠️ On mesure la largeur RENDUE du texte, pas celle de sa boîte : une boîte peut tenir
  // dans le viewport pendant que le texte qu'elle contient déborde. Un email n'a aucun
  // espace où couper, d'où le `break-all` que ce check garde.
  const email = await page.evaluate((address) => {
    const node = Array.from(document.querySelectorAll('span')).find(
      (span) => span.textContent.trim() === address,
    );
    if (!node) return null;

    const range = document.createRange();
    range.selectNodeContents(node);
    return {
      text: Math.ceil(range.getBoundingClientRect().width),
      viewport: window.innerWidth,
    };
  }, user.email);
  step(
    '7.2',
    email !== null && email.text <= email.viewport,
    email === null
      ? 'ligne Email introuvable'
      : `largeur rendue du texte = ${email.text} px / viewport ${email.viewport} px`,
  );

  // ------------------------------------------------------------ §8 pannes serveur mappées
  /**
   * 🔑 `lib/profile-mutations.ts` expose SEPT mappeurs d'erreur. Avant cette phase, QUATRE
   * n'étaient exercés par AUCUN check, et deux autres seulement sur leur branche CLIENT
   * (2.1/2.2 et 3.1/3.2 font 0 requête, la validation les arrête avant le réseau). Ces
   * fonctions n'ont qu'un seul travail : empêcher la prose serveur d'atteindre l'écran. Sans
   * check, l'une d'elles peut rendre `undefined` — ou le message brut du serveur — sans que
   * rien ne le voie.
   *
   * 🔑 Pourquoi un 500 : `sharedApiErrorMessage` (`lib/api.ts`) ne traite que 429 et 403. Tout
   * autre statut tombe dans le repli générique de chaque mappeur — précisément la branche que
   * personne ne gardait.
   *
   * Les deux derniers mappeurs sont testés en **2.8b** et **5.5b**, là où leur état existe
   * déjà : les refabriquer ici aurait coûté un upload et un cycle 2FA complets.
   */
  setPhase('8. pannes serveur — le message est mappé, jamais la prose brute');
  await page.setViewportSize({ width: 1280, height: 900 });

  const setupRoute = '**/api/auth/2fa/setup';
  expectHttp(/\/api\/auth\/2fa\/setup/, 'mise en place 2FA volontairement refusée -> 500 attendu');
  await page.route(setupRoute, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
  );
  try {
    await page.getByRole('button', { name: 'Enable 2FA' }).click();
    await page.waitForTimeout(400);
    const setupMapped = await page.locator('text=Could not start the two-factor setup.').count();
    // Le flux ne doit pas s'ouvrir à moitié : pas de champ de code sans secret à confirmer.
    const codeField = await page.locator('#totp-code').count();
    step(
      '8.1',
      setupMapped === 1 && codeField === 0,
      `message mappé=${setupMapped === 1} (jamais la prose serveur), flux resté fermé=${codeField === 0}`,
    );
  } finally {
    await page.unroute(setupRoute);
  }

  // ⚠️ Le motif couvre GET et PATCH sur la même URL — c'est le PATCH qu'on fait tomber, et le
  // cloisonnement par phase d'`expectHttp` empêche ce filtre large de masquer autre chose.
  const profileRoute = '**/api/users/me';
  expectHttp(/\/api\/users\/me/, 'enregistrement du profil volontairement refusé -> 500 attendu');
  await page.route(profileRoute, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
      : route.continue(),
  );
  try {
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('#bio').waitFor();
    await page.locator('#bio').fill('Audited bio, second pass.');
    await page.locator('form button:has-text("Save")').click();
    await page.waitForTimeout(400);
    const saveMapped = await page.locator('text=Could not save your profile.').count();
    // 🔑 Un échec ne doit pas jeter la saisie : le formulaire reste ouvert, prêt à réessayer.
    const stillEditing = await page.locator('#bio').count();
    step(
      '8.2',
      saveMapped === 1 && stillEditing === 1,
      `message mappé=${saveMapped === 1} (jamais la prose serveur), saisie conservée=${stillEditing === 1}`,
    );
  } finally {
    await page.unroute(profileRoute);
  }
}
