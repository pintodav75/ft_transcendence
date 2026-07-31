/**
 * [FS-3] — la conversation DM du rail social.
 *
 * `fs0-social` prouve le transport, `fs1-friends` prouve l'onglet Amis. Ce scénario prouve le
 * chat : ouvrir une conversation, lire son historique, envoyer, recevoir, et surtout **ne
 * jamais afficher un message deux fois**.
 *
 * 🚨 LE CHECK CENTRAL EST UN COMPTAGE D'OCCURRENCES, PAS UNE PRÉSENCE.
 * Un message arrive par DEUX chemins — l'historique REST et l'événement temps réel — et il
 * est renvoyé une troisième fois par l'accusé d'envoi. « Le message est à l'écran » serait donc
 * vert même sur un doublon franc. On compte les bulles portant le texte, et on exige **1**.
 *
 * Ce qu'il vérifie encore :
 *   - aucune requête de conversation tant qu'aucune n'est ouverte (le rail est monté sur
 *     TOUTES les pages authentifiées : ce qu'il charge, il le charge partout) ;
 *   - le brouillon **survit** à un aller-retour vers l'onglet Amis — les trois panneaux sont
 *     montés en permanence depuis la review, un démontage reprendrait le champ à zéro ;
 *   - le journal est **atteignable au clavier** et **nommé** : lire l'historique est la
 *     fonctionnalité du ticket, et un conteneur qui défile sans `tabindex` est illisible au
 *     clavier (WCAG 2.1.1) ;
 *   - rouvrir le même ami ne crée **ni seconde conversation ni message dupliqué** ;
 *   - à 375 px, la conversation tient dans le panneau sans débordement horizontal.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - **Les trois refus du serveur** (`not_friends`, `blocked`, `invalid_message_format`) :
 *     il faudrait casser l'amitié pendant que la conversation est ouverte, donc une course
 *     entre deux sessions. Le mapping existe et est commenté.
 *   - **Le filet des 10 s sans accusé** et la reprise du brouillon : l'attendre coûterait
 *     10 s de campagne pour un chemin qui exige un serveur en panne partielle.
 *   - **Les séparateurs de jour** : la conversation semée tient dans une seule journée, et
 *     fabriquer un message d'hier demanderait d'écrire en base.
 *   - **Le rendu visuel** des bulles (teinte, contraste, repli d'un mot très long) : à l'œil.
 */
export const name = 'fs3-chat';
export const surface = 'rail social — conversation DM : historique, envoi, réception, dédup';
export const auth = false;

const authHeaders = (as, json = false) => ({
  ...(json ? { 'content-type': 'application/json' } : {}),
  authorization: `Bearer ${as.accessToken}`,
});

async function userIdOf(as, ORIGIN) {
  const response = await fetch(`${ORIGIN}/api/users/me`, { headers: authHeaders(as) });
  if (!response.ok) throw new Error(`GET /users/me a répondu ${response.status}`);
  const { user } = await response.json();
  return user.id;
}

async function makeFriends(requester, addressee, ORIGIN) {
  const addresseeId = await userIdOf(addressee, ORIGIN);
  const request = await fetch(`${ORIGIN}/api/friends`, {
    method: 'POST',
    headers: authHeaders(requester, true),
    body: JSON.stringify({ addresseeId }),
  });
  if (!request.ok) throw new Error(`POST /friends a répondu ${request.status}`);
  const { friendship } = await request.json();
  const accept = await fetch(`${ORIGIN}/api/friends/${friendship.id}/accept`, {
    method: 'POST',
    headers: authHeaders(addressee),
  });
  if (!accept.ok) throw new Error(`acceptation de l'amitié a répondu ${accept.status}`);
}

export async function run({
  page,
  setPhase,
  step,
  user,
  createUser,
  login,
  awaitAnnouncement,
  awaitFocusRestored,
  focusLanding,
  ORIGIN,
}) {
  const clientErrors = [];
  page.on('response', (res) => {
    if (res.status() >= 400 && res.status() < 500) {
      clientErrors.push(`${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()}`);
    }
  });

  // Toutes les lectures d'historique du run : c'est ce compteur qui prouve qu'on ne charge
  // rien tant qu'aucune conversation n'est ouverte, puis qu'on ne recharge pas en boucle.
  const historyCalls = [];
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    if (res.request().method() === 'GET' && /^\/api\/messages\/[0-9a-f-]{36}$/.test(pathname)) {
      historyCalls.push(pathname);
    }
  });

  const friendsTab = page.getByRole('tab', { name: 'Friends' });
  const messagesTab = page.getByRole('tab', { name: 'Messages' });

  // --------------------------------------------------- §1 aucune requête sans conversation
  setPhase('1. le rail ne charge aucune conversation par défaut');
  const peer = await createUser();
  await login(user);
  await makeFriends(user, peer, ORIGIN);
  await page.reload({ waitUntil: 'networkidle' });
  await friendsTab.click();
  await page.getByRole('button', { name: `Send a message to @${peer.pseudo}` }).waitFor();
  const callsBeforeOpening = historyCalls.length;
  // On visite aussi l'onglet Messages SANS conversation ouverte : c'est le cas qui aurait pu
  // déclencher une requête « au cas où ».
  await messagesTab.click();
  const emptyState = await page
    .getByText('No conversation open.')
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  step(
    'C1',
    callsBeforeOpening === 0 && historyCalls.length === 0 && emptyState,
    `lectures d'historique avant toute ouverture : ${historyCalls.length} (0 attendue — le rail est monté sur TOUTES les pages authentifiées), état « aucune conversation » affiché=${emptyState}`,
  );

  // ------------------------------------------------ §2 ouvrir depuis la liste d'amis
  setPhase('2. ouvrir la conversation depuis un ami');
  await friendsTab.click();
  await page.getByRole('button', { name: `Send a message to @${peer.pseudo}` }).click();
  const log = page.getByRole('group', { name: new RegExp(`^Conversation with `) });
  const logShown = await log
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const composer = page.getByPlaceholder('Send a message…');
  const composerFocused = await composer
    .evaluate((el) => el === document.activeElement)
    .catch(() => false);
  step(
    'C2',
    logShown && historyCalls.length === 1 && composerFocused,
    `journal de conversation monté=${logShown}, lectures d'historique : ${historyCalls.length} (1 attendue), curseur placé dans le champ=${composerFocused}`,
  );

  // ------------------------------------ §3 le journal est atteignable et nommé au clavier
  setPhase('3. journal atteignable au clavier');
  // 🔑 Lire l'historique EST la fonctionnalité du ticket. Un conteneur qui défile sans
  // `tabindex` ne se parcourt pas au clavier : la tabulation saute de l'en-tête au champ et
  // seules les dernières bulles visibles sont lisibles. Défaut trouvé en review.
  const logA11y = await log
    .evaluate((el) => ({
      tabindex: el.getAttribute('tabindex'),
      name: el.getAttribute('aria-label') ?? '',
      scrollable: el.scrollHeight > el.clientHeight,
    }))
    .catch(() => ({ tabindex: null, name: '', scrollable: false }));
  step(
    'C3',
    logA11y.tabindex === '0' && logA11y.name.length > 0,
    `journal : tabindex=${logA11y.tabindex} (« 0 » attendu), nom accessible « ${logA11y.name} » (non vide attendu), conteneur réellement défilant=${logA11y.scrollable}`,
  );

  // ------------------------------------------- §4 envoi : la bulle apparaît UNE SEULE FOIS
  setPhase('4. envoi et accusé de réception');
  const sent = `audit-envoi-${Date.now()}`;
  await composer.fill(sent);
  await composer.press('Enter');
  const sentBubble = log.getByText(sent, { exact: true });
  await sentBubble.first().waitFor({ timeout: 15000 });
  // Laisser passer l'accusé ET un éventuel rechargement : c'est APRÈS que le doublon
  // apparaîtrait, jamais avant.
  await page.waitForTimeout(1500);
  const sentOccurrences = await sentBubble.count();
  const composerCleared = (await composer.inputValue()) === '';
  step(
    'C4',
    sentOccurrences === 1 && composerCleared,
    `bulles portant le texte envoyé : ${sentOccurrences} (1 attendue — il arrive par l'accusé ET pourrait revenir par un rechargement ; « présent » serait vert même sur un doublon), champ vidé=${composerCleared}`,
  );

  // ------------------------------------ §5 réception en direct, dédupliquée elle aussi
  setPhase('5. réception en direct');
  const peerContext = await page.context().browser().newContext({ ignoreHTTPSErrors: true });
  await peerContext.addCookies(peer.cookies);
  const peerPage = await peerContext.newPage();
  await peerPage.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
  await peerPage.getByRole('tab', { name: 'Friends' }).click();
  await peerPage.getByRole('button', { name: `Send a message to @${user.pseudo}` }).click();
  const peerComposer = peerPage.getByPlaceholder('Send a message…');
  await peerComposer.waitFor({ timeout: 10000 });

  const received = `audit-recu-${Date.now()}`;
  const announced = awaitAnnouncement(received.slice(0, 20));
  await peerComposer.fill(received);
  await peerComposer.press('Enter');
  const receivedBubble = log.getByText(received, { exact: true });
  const receivedShown = await receivedBubble
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const heard = await announced;
  await page.waitForTimeout(1000);
  const receivedOccurrences = await receivedBubble.count();
  step(
    'C5',
    receivedShown && receivedOccurrences === 1,
    `message reçu affiché sans rechargement=${receivedShown}, occurrences : ${receivedOccurrences} (1 attendue), annonce lue dans la région du rail=${heard}`,
  );

  // -------------------------------- §6 le brouillon survit à un aller-retour d'onglet
  setPhase('6. brouillon conservé au changement d’onglet');
  const draft = 'brouillon-non-envoye';
  await composer.fill(draft);
  await friendsTab.click();
  await page.getByRole('button', { name: `Send a message to @${peer.pseudo}` }).waitFor();
  await messagesTab.click();
  const keptDraft = await page.getByPlaceholder('Send a message…').inputValue();
  step(
    'C6',
    keptDraft === draft,
    `brouillon après aller-retour vers l'onglet Amis : « ${keptDraft} » (« ${draft} » attendu — un panneau démonté reprendrait le champ à zéro)`,
  );

  // ------------- §7 LE VRAI TEST DE DÉDUPLICATION : coupure, reconnexion, rechargement
  setPhase('7. reconnexion : historique rechargé PAR-DESSUS le tampon temps réel');
  // 🚨 C'EST ICI QUE LE DOUBLON PEUT NAÎTRE, ET NULLE PART AILLEURS.
  // Rouvrir le même ami ne recharge RIEN — le panneau reste monté depuis la review, le cache
  // répond — donc ce chemin ne mettait à l'épreuve aucune fusion, et le check était vert par
  // construction. Le seul moment où un message existe dans les DEUX sources à la fois, c'est
  // après une reconnexion : les deux messages de ce run sont déjà dans le tampon temps réel,
  // et le rechargement post-coupure les rapporte depuis le serveur. Sans déduplication par
  // identifiant, chacun apparaîtrait deux fois.
  // ⚠️ Ce check porte AUSSI la promesse centrale du ticket : le temps réel ne rejoue rien,
  // seul ce rechargement rattrape ce qui a été manqué pendant la coupure.
  await page.getByPlaceholder('Send a message…').fill('');
  const historyCallsBeforeCut = historyCalls.length;
  await page.context().setOffline(true);
  const offlineNotice = await page
    .getByText('You are offline', { exact: false })
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  await page.context().setOffline(false);
  // On attend le rechargement par son EFFET RÉSEAU observable, jamais par un délai fixe.
  for (let i = 0; i < 80 && historyCalls.length === historyCallsBeforeCut; i += 1) {
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  const sentAfterReconnect = await log.getByText(sent, { exact: true }).count();
  const receivedAfterReconnect = await log.getByText(received, { exact: true }).count();
  const logsMounted = await page.getByRole('group', { name: /^Conversation with / }).count();
  step(
    'C7',
    offlineNotice &&
      historyCalls.length > historyCallsBeforeCut &&
      sentAfterReconnect === 1 &&
      receivedAfterReconnect === 1 &&
      logsMounted === 1,
    `état hors ligne annoncé=${offlineNotice}, rechargements d'historique déclenchés par la reconnexion : ${historyCalls.length - historyCallsBeforeCut} (≥ 1 attendu — sans lui, un message reçu pendant la coupure serait perdu pour de bon), occurrences après fusion : envoyé ${sentAfterReconnect}, reçu ${receivedAfterReconnect} (1 chacune — ils sont désormais dans le tampon temps réel ET dans l'historique rechargé), conversations montées ${logsMounted} (1 attendue)`,
  );

  // ------------------------------------------------------------------- §8 375 px
  setPhase('8. conversation à 375 px');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open social panel' }).click();
  const mobilePanel = page.getByRole('dialog', { name: 'Social' });
  await mobilePanel.waitFor({ timeout: 5000 });
  await mobilePanel.getByRole('tab', { name: 'Friends' }).click();
  await mobilePanel.getByRole('button', { name: `Send a message to @${peer.pseudo}` }).click();
  const mobileLog = mobilePanel.getByRole('group', { name: /^Conversation with / });
  const mobileShown = await mobileLog
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const mobileGeometry = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  step(
    'C8',
    mobileShown && mobileGeometry.doc <= 0,
    `conversation ouverte dans le panneau mobile=${mobileShown}, débordement horizontal du document : ${mobileGeometry.doc}px (≤ 0 attendu)`,
  );

  // ------------------------------------------------------------ §9 filets transverses
  setPhase('9. filets transverses');
  step(
    'C9',
    clientErrors.length === 0,
    `réponses 4xx sur tout le parcours : ${clientErrors.length} (0 attendue)${clientErrors.length ? ` — ${clientErrors.join(', ')}` : ''} ; lectures d'historique au total : ${historyCalls.length}`,
  );

  await peerContext.close();
}
