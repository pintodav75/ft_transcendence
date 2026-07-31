/**
 * [FS-1] — l'onglet « Friends » du rail social.
 *
 * `fs0-social.mjs` prouve le TRANSPORT (une socket, la présence, la reconnexion, le panneau
 * mobile) ; il ouvre bien l'onglet Friends au clavier mais n'y clique jamais rien. Ce
 * scénario-ci prouve le CONTENU de l'onglet.
 *
 * Ce qu'il vérifie :
 *   - un compte **sans ami** rend l'état vide, et **aucun** groupe En ligne / Hors ligne ;
 *   - avec deux amis dont un connecté, les groupes titrent `Online — 1` / `Offline — 1` et
 *     chaque liste porte un nom accessible distinct ;
 *   - 🚨 **Remove friend part sur l'id de la RELATION, Block player sur l'id de l'UTILISATEUR.**
 *     C'est LE défaut que ce ticket pouvait produire : `GET /friends` rend les deux, les
 *     confondre donne un 404 ou un 400, donc une ligne rouge en console — motif de rejet du
 *     projet. On l'assert sur le **statut HTTP réel** de chaque appel, pas sur l'écran ;
 *   - la ligne disparaît **sans rechargement** après chaque action, et le compteur du groupe
 *     est recalculé ;
 *   - le focus revient sur un élément **visible** après une confirmation (annulée comme
 *     acceptée), jamais sur `<body>` ;
 *   - à 375 px, `Escape` sur la confirmation ferme **la confirmation seule** et laisse le
 *     panneau social ouvert — le piège de focus du panneau mobile est posé sur `document`, il
 *     lui aurait pris son `Escape` ;
 *   - le menu « ⋮ » n'expose **qu'un seul arrêt de tabulation**.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - **L'état d'erreur de la liste** (« Could not load your friends. ») : il faudrait faire
 *     tomber `GET /friends`, ce qui écrirait une ligne réseau à cloisonner pour un seul check.
 *   - **Le repli « Checking who is online… »** : il ne dure que le temps du handshake temps
 *     réel, quelques dizaines de millisecondes — l'attendre serait une course, pas un test.
 *   - **Le rendu visuel** à 312 px avec un pseudo long : mesuré ici en largeur, mais
 *     l'apparence (troncature lisible, densité des filets) reste à valider à l'œil.
 */
export const name = 'fs1-friends';
export const surface = "rail social — onglet Amis : présence, retrait, blocage";
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

/**
 * Amitié acceptée fabriquée par **appel API direct**. Le parcours « envoyer et accepter une
 * demande » appartient à [FS-5] et aura son propre scénario : le dérouler ici ne prouverait
 * rien de neuf et doublerait la durée du run.
 */
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
  // Filet transverse : sur ce ticket, un 4xx N'EST PAS un détail — c'est exactement la forme
  // que prendrait la confusion des deux identifiants. On les collecte pour pouvoir DIRE
  // lesquels sont partis.
  const clientErrors = [];
  page.on('response', (res) => {
    if (res.status() >= 400 && res.status() < 500) {
      clientErrors.push(`${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()}`);
    }
  });

  // Les statuts des deux mutations du ticket, relevés à la source. Un écran qui « a l'air »
  // juste sur un 404 silencieux est le faux vert qu'on refuse ici.
  const mutations = [];
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    const method = res.request().method();
    if (method === 'DELETE' && /^\/api\/friends\//.test(pathname)) {
      mutations.push({ kind: 'remove', status: res.status(), pathname });
    }
    if (method === 'POST' && /^\/api\/blocks\//.test(pathname)) {
      mutations.push({ kind: 'block', status: res.status(), pathname });
    }
  });

  let nativeDialogs = 0;
  page.on('dialog', () => {
    nativeDialogs += 1;
  });

  const friendsTab = page.getByRole('tab', { name: 'Friends' });
  const onlineList = page.getByRole('list', { name: 'Friends online' });
  const offlineList = page.getByRole('list', { name: 'Friends offline' });

  // ------------------------------------------------------------------ §1 état vide
  setPhase('1. compte sans ami');
  await login(user);
  await friendsTab.click();

  const emptyShown = await page
    .getByText('No friends yet.')
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  // Les deux groupes doivent être ABSENTS, pas vides : un compte sans ami n'a pas de
  // question « qui est en ligne » à se poser.
  const groupsHidden = (await onlineList.count()) === 0 && (await offlineList.count()) === 0;
  step(
    'F1',
    emptyShown && groupsHidden,
    `état vide affiché=${emptyShown}, groupes En ligne/Hors ligne rendus=${!groupsHidden} (aucun attendu)`,
  );

  // ------------------------------------------------------- §2 deux amis, un seul connecté
  setPhase('2. deux amis dont un connecté');
  const onlineFriend = await createUser();
  const offlineFriend = await createUser();
  await makeFriends(user, onlineFriend, ORIGIN);
  await makeFriends(user, offlineFriend, ORIGIN);
  await page.reload({ waitUntil: 'networkidle' });
  await friendsTab.click();

  // Le second compte ouvre une VRAIE session dans son propre contexte : c'est sa socket qui
  // fait basculer la présence, jamais une écriture directe dans le magasin.
  const friendContext = await page.context().browser().newContext({ ignoreHTTPSErrors: true });
  await friendContext.addCookies(onlineFriend.cookies);
  const friendPage = await friendContext.newPage();
  await friendPage.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });

  const splitCorrect = await page
    .getByText('Online — 1', { exact: true })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const offlineCount = await offlineList.getByRole('listitem').count();
  const onlineNames = await onlineList.getByRole('listitem').count();
  step(
    'F2',
    splitCorrect && onlineNames === 1 && offlineCount === 1,
    `groupe « Online — 1 » affiché=${splitCorrect}, lignes en ligne=${onlineNames} (1 attendue), hors ligne=${offlineCount} (1 attendue)`,
  );

  // --------------------------------------------------- §3 largeur : le nom ne tombe pas à 0
  setPhase('3. largeur de la colonne');
  const nameBox = await onlineList
    .getByRole('listitem')
    .first()
    .locator('a')
    .evaluate((link) => {
      const rail = link.closest('aside') ?? document.body;
      return {
        link: Math.round(link.getBoundingClientRect().width),
        rail: Math.round(rail.getBoundingClientRect().width),
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })
    .catch(() => ({ link: -1, rail: -1, docOverflow: 999 }));
  step(
    'F3',
    nameBox.link > 100 && nameBox.link < nameBox.rail && nameBox.docOverflow <= 0,
    `lien de la ligne : ${nameBox.link}px dans un rail de ${nameBox.rail}px (> 100 et < rail attendus — le piège vécu est un nom rendu sur 0 px), débordement horizontal du document : ${nameBox.docOverflow}px (≤ 0 attendu)`,
  );

  // ------------------------------------------------------- §4 un seul arrêt de tabulation
  setPhase('4. menu d’actions au clavier');
  const menuTrigger = onlineList
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: /^Actions for @/ });
  await menuTrigger.click();
  const menuItems = page.getByRole('menuitem');
  await menuItems.first().waitFor({ timeout: 5000 });
  // Le motif APG demande UN seul arrêt de tabulation pour tout le menu : les items non actifs
  // portent `tabindex="-1"`. Sans ça, Tab circule dans le menu au lieu d'en sortir.
  const tabStops = await menuItems.evaluateAll(
    (items) => items.filter((item) => item.getAttribute('tabindex') !== '-1').length,
  );
  const itemCount = await menuItems.count();
  await page.keyboard.press('Escape');
  const menuClosed = (await page.getByRole('menuitem').count()) === 0;
  // ⚠️ ATTENDRE, ne pas lire tout de suite. Le composant rend le focus au déclencheur à la
  // frame SUIVANTE, exprès : le faire dans le même rendu poserait le focus sur un nœud que
  // React est en train de démonter. Un `evaluate` immédiat lit donc l'état d'avant et rougit
  // sur un composant correct — la famille de faux rouge décrite par l'invariant #11.
  const focusBackOnTrigger = await menuTrigger
    .evaluate(
      (el) =>
        new Promise((resolve) => {
          const deadline = Date.now() + 2000;
          const check = () => {
            if (el === document.activeElement) return resolve(true);
            if (Date.now() > deadline) return resolve(false);
            requestAnimationFrame(check);
          };
          check();
        }),
    )
    .catch(() => false);
  step(
    'F4',
    itemCount === 2 && tabStops === 1 && menuClosed && focusBackOnTrigger,
    `items=${itemCount} (2 attendus), arrêts de tabulation=${tabStops} (1 attendu — tabindex glissant), Escape referme=${menuClosed}, focus rendu au déclencheur=${focusBackOnTrigger}`,
  );

  // --------------------------------------------- §5 annulation : rien ne part, focus visible
  setPhase('5. confirmation annulée');
  const mutationsBeforeCancel = mutations.length;
  await menuTrigger.click();
  await page.getByRole('menuitem', { name: 'Remove friend' }).click();
  const cancelDialog = page.getByRole('dialog', { name: 'Remove this friend?' });
  await cancelDialog.waitFor({ timeout: 5000 });
  await cancelDialog.getByRole('button', { name: 'Cancel' }).click();
  await awaitFocusRestored();
  const focusAfterCancel = await focusLanding();
  // 🔑 « Pas BODY » ne suffit PAS ici : la première livraison garait le focus sur un titre
  // `sr-only`, donc hors de BODY mais INVISIBLE — un utilisateur clavier voyant regardait
  // l'anneau de focus disparaître sans savoir où repartirait son Tab. On mesure donc aussi
  // que l'élément focalisé occupe une surface à l'écran.
  const focusVisible = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  const stillThere = (await onlineList.getByRole('listitem').count()) === 1;
  step(
    'F5',
    mutations.length === mutationsBeforeCancel &&
      stillThere &&
      focusAfterCancel.tag !== 'BODY' &&
      focusVisible,
    `requêtes de mutation parties : ${mutations.length - mutationsBeforeCancel} (0 attendue), ami toujours listé=${stillThere}, focus après annulation : <${focusAfterCancel.tag}> « ${focusAfterCancel.label} », visible à l'écran=${focusVisible} (ni BODY ni sr-only)`,
  );

  // ------------------------------ §6 RETRAIT : l'id de la RELATION, pas celui de l'ami
  setPhase('6. retirer un ami');
  const removedPseudo = onlineFriend.pseudo;
  await menuTrigger.click();
  await page.getByRole('menuitem', { name: 'Remove friend' }).click();
  const removeDialog = page.getByRole('dialog', { name: 'Remove this friend?' });
  await removeDialog.waitFor({ timeout: 5000 });
  const removeAnnounced = awaitAnnouncement(`@${removedPseudo} was removed`);
  await removeDialog.getByRole('button', { name: 'Remove friend' }).click();
  const removeHeard = await removeAnnounced.then(() => true).catch(() => false);
  const onlineGone = await page
    .getByText('Online — 0', { exact: true })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const removeCall = mutations.filter((m) => m.kind === 'remove').at(-1);
  step(
    'F6',
    removeCall?.status === 200 && onlineGone && removeHeard,
    `DELETE /api/friends/{id} -> HTTP ${removeCall?.status ?? 'aucun appel'} (200 attendu — un 404 ici signerait l'envoi de l'id de l'UTILISATEUR au lieu de celui de la RELATION), groupe repassé à « Online — 0 » sans rechargement=${onlineGone}, annonce lue=${removeHeard}`,
  );

  // ------------------------------ §7 BLOCAGE : l'id de l'UTILISATEUR, pas celui de la relation
  setPhase('7. bloquer un joueur');
  const blockedPseudo = offlineFriend.pseudo;
  const offlineTrigger = offlineList
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: /^Actions for @/ });
  await offlineTrigger.click();
  await page.getByRole('menuitem', { name: 'Block player' }).click();
  const blockDialog = page.getByRole('dialog', { name: 'Block this player?' });
  await blockDialog.waitFor({ timeout: 5000 });
  const blockAnnounced = awaitAnnouncement(`@${blockedPseudo} was blocked`);
  await blockDialog.getByRole('button', { name: 'Block player' }).click();
  const blockHeard = await blockAnnounced.then(() => true).catch(() => false);
  const backToEmpty = await page
    .getByText('No friends yet.')
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const blockCall = mutations.filter((m) => m.kind === 'block').at(-1);
  step(
    'F7',
    (blockCall?.status === 200 || blockCall?.status === 201) && backToEmpty && blockHeard,
    `POST /api/blocks/{userId} -> HTTP ${blockCall?.status ?? 'aucun appel'} (200/201 attendu — un 404 ici signerait l'envoi de l'id de la RELATION au lieu de celui de l'UTILISATEUR), retour à l'état vide=${backToEmpty} (le serveur casse l'amitié en bloquant), annonce lue=${blockHeard}`,
  );

  // ---------------------------------- §8 375 px : Escape ne doit pas fermer les deux couches
  setPhase('8. confirmation dans le panneau mobile');
  const third = await createUser();
  await makeFriends(user, third, ORIGIN);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open social panel' }).click();
  const mobilePanel = page.getByRole('dialog', { name: 'Social' });
  await mobilePanel.waitFor({ timeout: 5000 });
  await mobilePanel.getByRole('tab', { name: 'Friends' }).click();
  await mobilePanel
    .getByRole('button', { name: /^Actions for @/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Remove friend' }).click();
  await page.getByRole('dialog', { name: 'Remove this friend?' }).waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
  // La confirmation part, le panneau RESTE : le piège de focus du panneau mobile est posé sur
  // `document` et cherche un attribut `[role="dialog"]` qu'un `<dialog>` natif ne porte pas —
  // sans isolation, ce même Escape aurait fermé les deux couches d'un coup.
  const confirmClosed = (await page.getByRole('dialog', { name: 'Remove this friend?' }).count()) === 0;
  const panelStillOpen = await mobilePanel
    .isVisible()
    .then((v) => v)
    .catch(() => false);
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'F8',
    confirmClosed && panelStillOpen && mobileOverflow <= 0,
    `Escape ferme la confirmation=${confirmClosed}, panneau social encore ouvert=${panelStillOpen} (les deux couches ne doivent PAS tomber ensemble), débordement horizontal à 375 px : ${mobileOverflow}px (≤ 0 attendu)`,
  );

  // ------------------------------------------------------------- §9 filets transverses
  setPhase('9. filets transverses');
  step(
    'F9',
    clientErrors.length === 0 && nativeDialogs === 0,
    `réponses 4xx sur tout le parcours : ${clientErrors.length} (0 attendue)${clientErrors.length ? ` — ${clientErrors.join(', ')}` : ''} ; boîtes natives (window.confirm/alert) : ${nativeDialogs} (0 attendue — la confirmation passe par ConfirmDialog)`,
  );

  await friendContext.close();
}
