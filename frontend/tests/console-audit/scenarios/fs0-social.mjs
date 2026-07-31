/**
 * FS-0 — fondation temps réel et shell du rail social.
 *
 * Ce scénario vise les invariants que build/lint ne peuvent pas voir : socket unique pendant
 * la navigation, présence live à deux comptes, reconnexion, purge au changement de compte,
 * onglets accessibles et dialogue mobile.
 */
export const name = 'fs0-social';
export const surface = 'rail social authentifié + cycle de vie WebSocket';
export const auth = false;

const authHeaders = (user, json = false) => ({
  ...(json ? { 'content-type': 'application/json' } : {}),
  authorization: `Bearer ${user.accessToken}`,
});

async function me(user, ORIGIN) {
  const response = await fetch(`${ORIGIN}/api/users/me`, { headers: authHeaders(user) });
  if (!response.ok) throw new Error(`GET /users/me a répondu ${response.status}`);
  return response.json();
}

async function makeFriends(requester, addressee, ORIGIN) {
  const addresseeProfile = await me(addressee, ORIGIN);
  const request = await fetch(`${ORIGIN}/api/friends`, {
    method: 'POST',
    headers: authHeaders(requester, true),
    body: JSON.stringify({ addresseeId: addresseeProfile.user.id }),
  });
  if (!request.ok) throw new Error(`POST /friends a répondu ${request.status}`);
  const { friendship } = await request.json();

  const accept = await fetch(`${ORIGIN}/api/friends/${friendship.id}/accept`, {
    method: 'POST',
    headers: authHeaders(addressee),
  });
  if (!accept.ok) throw new Error(`acceptation de l'amitié a répondu ${accept.status}`);
}

export async function run({ page, setPhase, step, user, createUser, login, ORIGIN }) {
  const sockets = [];
  const connectionLabel = page
    .getByRole('link', { name: 'Open my profile' })
    .locator('p')
    .filter({ hasText: /^(Online|Offline)$/ });
  // Vite garde sa propre socket HMR ouverte en développement. Elle ne fait pas partie de
  // FS-0 : seul le transport applicatif /api/ws/chat compte pour l'invariant « un socket ».
  page.on('websocket', (socket) => {
    if (socket.url().includes('/api/ws/chat')) sockets.push(socket);
  });

  setPhase('1. socket unique au montage et pendant la navigation');
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', user.email);
  await page.fill('#password', user.password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/home', { timeout: 15000 });
  await connectionLabel.filter({ hasText: 'Online' }).waitFor();
  const socketsAfterLogin = sockets.length;
  // ⚠️ Naviguer par le RAIL, jamais par un lien de la page. Depuis [F-HOME], `/home` porte
  // son propre « Go to my teams » vers `/teams` : un `getByRole('link', { name: 'My teams' })`
  // non scopé en attrape deux et sort le harnais en `exit 2`. Le rail est le seul chemin
  // stable — il est présent sur toutes les pages authentifiées, et c'est justement sa
  // permanence que ce check mesure.
  const railNav = page.getByRole('navigation', { name: 'Primary navigation' });
  await railNav.getByRole('link', { name: 'My teams' }).click();
  await page.waitForURL('**/teams');
  const socketsAfterTeams = sockets.length;
  await railNav.getByRole('link', { name: 'Home' }).click();
  await page.waitForURL('**/home');
  const openSockets = sockets.filter((socket) => !socket.isClosed()).length;
  step(
    'S1',
    sockets.length === 1 && openSockets === 1,
    `créées : login=${socketsAfterLogin}, teams=${socketsAfterTeams}, home=${sockets.length}; ouvertes=${openSockets}`,
  );

  // Vite permet ici d'appeler le store réel du navigateur. Deux valeurs différentes
  // simulent une rotation puis restaurent le vrai token : aucune socket ne doit bouger.
  //
  // 🚨 IMPORTER `/src/stores/auth-store.ts` EN DUR NE DONNE PAS LE STORE DE L'APPLICATION.
  // Dès que le HMR de Vite a invalidé le module une seule fois — n'importe quelle écriture
  // sous `frontend/` depuis le démarrage du serveur de dev, un `git checkout`, un rebase —
  // l'application tourne sur `…/auth-store.ts?t=<horodatage>` et l'URL nue construit une
  // SECONDE instance, vierge : `accessToken` null, `ready` false. Le check devenait alors
  // rouge sur un serveur de dev parfaitement sain, et vert seulement après un redémarrage.
  // On résout donc l'URL réellement chargée par la page, la plus récente d'abord.
  // (Même famille que l'invariant #10 : le HMR de Vite fait échouer un scénario innocent.)
  const socketsBeforeTokenRotation = sockets.length;
  await page.evaluate(async () => {
    const liveUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/src/stores/auth-store.ts'))
      .sort()
      .pop();
    const { useAuthStore } = await import(liveUrl ?? '/src/stores/auth-store.ts');
    const token = useAuthStore.getState().accessToken;
    if (!token) throw new Error('access token absent pendant la simulation de rotation');
    useAuthStore.getState().setAccessToken(`${token}.rotated`);
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    useAuthStore.getState().setAccessToken(token);
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  });
  await page.waitForTimeout(250);
  const openSocketsAfterTokenRotation = sockets.filter((socket) => !socket.isClosed()).length;
  step(
    'S1b',
    sockets.length === socketsBeforeTokenRotation && openSocketsAfterTokenRotation === 1,
    `rotation du token : ${sockets.length - socketsBeforeTokenRotation} nouvelle socket (0 attendue), ouvertes=${openSocketsAfterTokenRotation}`,
  );

  setPhase('2. onglets partagés');
  const friendsTab = page.getByRole('tab', { name: 'Friends' });
  await friendsTab.focus();
  await page.keyboard.press('ArrowRight');
  const messagesSelected = await page
    .getByRole('tab', { name: 'Messages' })
    .getAttribute('aria-selected');
  step('S2', messagesSelected === 'true', `flèche droite sélectionne Messages=${messagesSelected}`);

  setPhase('3. présence live avec un second compte');
  const friend = await createUser();
  await makeFriends(user, friend, ORIGIN);
  await page.reload({ waitUntil: 'networkidle' });
  await connectionLabel.filter({ hasText: 'Online' }).waitFor();

  const friendContext = await page.context().browser().newContext({ ignoreHTTPSErrors: true });
  await friendContext.addCookies(friend.cookies);
  const friendPage = await friendContext.newPage();
  await friendPage.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
  const presenceBecameLive = await page
    .getByText('1 friend online', { exact: true })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step('S3', presenceBecameLive, 'le second compte connecté passe immédiatement à 1 ami en ligne');

  setPhase('4. coupure puis reconnexion');
  const socketsBeforeReconnect = sockets.length;
  await page.context().setOffline(true);
  const offlineShown = await connectionLabel
    .filter({ hasText: 'Offline' })
    .waitFor()
    .then(() => true)
    .catch(() => false);
  await page.context().setOffline(false);
  const reconnected = await connectionLabel
    .filter({ hasText: 'Online' })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const presenceRestored = await page
    .getByText('1 friend online', { exact: true })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'S4',
    offlineShown && reconnected && presenceRestored && sockets.length === socketsBeforeReconnect + 1,
    `offline=${offlineShown}, reconnecté=${reconnected}, présence restaurée=${presenceRestored}, ${sockets.length - socketsBeforeReconnect} nouvelle socket (1 attendue)`,
  );

  setPhase('5. dialogue mobile au clavier');
  await page.setViewportSize({ width: 390, height: 844 });
  const compactLogo = page.getByRole('link', { name: 'VSMODE — accueil' });
  const compactLogoText = (await compactLogo.textContent())?.trim();
  // ⚠️ PAS `header:visible` : depuis [F-HOME] le hero de `/home` est lui aussi un `<header>`,
  // et le sélecteur en attrapait deux (sortie du harnais en `exit 2`). On vise le landmark
  // `banner`, que seul l'en-tête mobile porte — le hero est DANS `<main>`, donc l'élément
  // sectionnant lui retire ce rôle. Un scénario du rail ne doit jamais viser une balise que
  // le contenu de page peut réutiliser.
  const headerGeometry = await page.getByRole('banner').evaluate((header) => {
    const box = header.getBoundingClientRect();
    return {
      left: Math.round(box.left),
      right: Math.round(box.right),
      height: Math.round(box.height),
      radius: getComputedStyle(header).borderTopLeftRadius,
      bodyRight: Math.round(document.body.getBoundingClientRect().right),
    };
  });
  const oldFloatingTrigger = await page
    .getByRole('button', { name: 'Social', exact: true })
    .count();
  const mobileTrigger = page.getByRole('button', { name: 'Open social panel' });
  await mobileTrigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Social' });
  const dialogOpened = await dialog
    .waitFor()
    .then(() => true)
    .catch(() => false);
  const focusInside =
    dialogOpened &&
    (await page
      .evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"][aria-label="Social"]')),
      )
      .catch(() => false));
  const notificationsDialog = page.getByRole('dialog', { name: 'Notifications' });
  const notificationsOpened =
    dialogOpened &&
    (await dialog
      .getByRole('button', { name: 'Notifications' })
      .click()
      .then(() => notificationsDialog.waitFor())
      .then(() => true)
      .catch(() => false));
  const notificationAlignment = notificationsOpened
    ? await page
        .evaluate(() => {
          const social = document.querySelector('[role="dialog"][aria-label="Social"]');
          const notifications = document.querySelector(
            '[role="dialog"][aria-label="Notifications"]',
          );
          const overlay = social?.parentElement;
          if (!(social instanceof HTMLElement) ||
              !(notifications instanceof HTMLElement) ||
              !(overlay instanceof HTMLElement)) return null;
          const overlayBox = overlay.getBoundingClientRect();
          const socialBox = social.getBoundingClientRect();
          const notificationBox = notifications.getBoundingClientRect();
          return {
            panelTop: Math.round(socialBox.top - overlayBox.top),
            panelLeft: Math.round(socialBox.left - overlayBox.left),
            panelRightGap: Math.round(overlayBox.right - socialBox.right),
            panelBottomGap: Math.round(overlayBox.bottom - socialBox.bottom),
            panelRadius: getComputedStyle(social).borderTopLeftRadius,
            leftGap: Math.round(notificationBox.left - socialBox.left),
            rightGap: Math.round(socialBox.right - notificationBox.right),
          };
        })
        .catch(() => null)
    : null;
  await page.keyboard.press('Escape');
  const childClosedFirst =
    notificationsOpened &&
    (await notificationsDialog
      .waitFor({ state: 'detached' })
      .then(() => true)
      .catch(() => false)) &&
    (await dialog.count()) === 1;
  await page.keyboard.press('Escape');
  const focusReturned = await mobileTrigger
    .evaluate((element) => document.activeElement === element)
    .catch(() => false);
  step(
    'S5',
    compactLogoText === 'VS' &&
      oldFloatingTrigger === 0 &&
      headerGeometry.left === 8 &&
      headerGeometry.right === headerGeometry.bodyRight - 8 &&
      headerGeometry.height === 56 &&
      headerGeometry.radius === '8px' &&
      dialogOpened &&
      focusInside &&
      notificationAlignment !== null &&
      notificationAlignment.panelTop === 12 &&
      notificationAlignment.panelLeft === 12 &&
      notificationAlignment.panelRightGap === 12 &&
      notificationAlignment.panelBottomGap === 12 &&
      notificationAlignment.panelRadius === '8px' &&
      Math.abs(notificationAlignment.leftGap - notificationAlignment.rightGap) <= 1 &&
      childClosedFirst &&
      focusReturned,
    `logo=${compactLogoText}, header=${headerGeometry.left}..${headerGeometry.right} × ${headerGeometry.height}px rayon=${headerGeometry.radius}, dialogues=${dialogOpened}/${notificationsOpened}, panneau=${notificationAlignment ? `gaps ${notificationAlignment.panelTop}/${notificationAlignment.panelLeft}/${notificationAlignment.panelRightGap}/${notificationAlignment.panelBottomGap}px rayon=${notificationAlignment.panelRadius}, notifications ${notificationAlignment.leftGap}/${notificationAlignment.rightGap}` : 'non mesuré'}, Escape enfant=${childClosedFirst}, focus=${focusInside}/${focusReturned}`,
  );

  setPhase('6. identité liée au profil sur mobile et desktop');
  await mobileTrigger.click();
  await dialog.getByRole('link', { name: 'Open my profile' }).click();
  await page.waitForURL('**/profile');
  const mobileDialogClosed = (await dialog.count()) === 0;
  await compactLogo.click();
  await page.waitForURL('**/home');
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopProfileLink = page
    .getByRole('complementary', { name: 'Social' })
    .getByRole('link', { name: 'Open my profile' });
  const desktopProfileHref = await desktopProfileLink.getAttribute('href');
  await desktopProfileLink.hover();
  await page.waitForTimeout(250);
  const viewProfileRevealed = await desktopProfileLink
    .getByText('View profile', { exact: true })
    .evaluate((element) => getComputedStyle(element).opacity === '1');
  step(
    'S6',
    mobileDialogClosed && desktopProfileHref === '/profile' && viewProfileRevealed,
    `navigation mobile=/profile, panneau fermé=${mobileDialogClosed}, lien desktop=${desktopProfileHref}, survol=${viewProfileRevealed}`,
  );

  setPhase('7. logout puis autre compte sans fuite de présence');
  const newcomer = await createUser();
  const currentSocket = sockets.at(-1);
  const socketClosed = currentSocket.waitForEvent('close', { timeout: 10000 }).then(() => true).catch(() => false);
  await page.getByRole('button', { name: 'Logout' }).click();
  await page.getByRole('dialog', { name: 'Log out' }).getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(`${ORIGIN}/`);
  const closedOnLogout = await socketClosed;
  await login(newcomer);
  setPhase('7. nouveau compte connecté');
  await connectionLabel.filter({ hasText: 'Online' }).waitFor();
  const previousPresencePurged = await page
    .getByText('0 friends online', { exact: true })
    .waitFor()
    .then(() => true)
    .catch(() => false);
  step('S7', closedOnLogout, `socket fermée au logout=${closedOnLogout}`);
  step(
    'S8',
    previousPresencePurged,
    `le nouveau compte affiche 0 ami en ligne : état précédent purgé=${previousPresencePurged}`,
  );

  await friendContext.close();
}
