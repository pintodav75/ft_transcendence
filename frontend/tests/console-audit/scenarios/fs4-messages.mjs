/**
 * [FS-4] — l'onglet Messages et les fenêtres de conversation multiples.
 *
 * `fs3-chat` prouve UNE conversation (historique, envoi, réception, dédup, reconnexion). Ce
 * scénario prouve les deux couches que FS-4 ajoute par-dessus : la **liste** des conversations
 * et le **gestionnaire de fenêtres**.
 *
 * 🚨 LE CHECK CENTRAL EST UN CLIC QUI NE FAISAIT RIEN.
 * `M5` garde le défaut trouvé en review, atteignable par un simple `Ctrl +` : au-delà du
 * maximum de fenêtres, une conversation reste OUVERTE dans l'état mais n'est plus AFFICHÉE.
 * La garde « déjà ouverte » renvoyait alors l'état inchangé — aucune fenêtre, aucun focus,
 * aucune explication. Le seul point d'entrée de l'onglet devenait silencieusement inopérant.
 *
 * Ce qu'il vérifie encore :
 *   - la liste ne montre **que** les amis avec qui j'ai échangé (un ami sans message n'y est
 *     pas : la liste d'amis est l'autre onglet) ;
 *   - les deux points d'entrée — liste des conversations et liste d'amis — atteignent la
 *     **même** fenêtre, jamais deux ;
 *   - une conversation **remonte en tête** à la réception d'un message, sans rechargement ;
 *   - fermer une fenêtre laisse les autres intactes, et le focus ne tombe jamais sur `<body>` ;
 *   - **aucune fenêtre flottante sous 1024 px** : la conversation s'y affiche dans le panneau.
 *     Ce n'est pas une préférence — le panneau mobile est une fenêtre modale faite main dont
 *     le gestionnaire d'`Escape` vit sur `document`, empiler une fenêtre par-dessus rejouerait
 *     ce piège.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - **Trois fenêtres simultanées** : il faudrait un viewport ≥ 1600 px, que le harnais
 *     n'utilise nulle part ailleurs. `M4` prouve la règle sur le passage de 2 à 1.
 *   - **La survie du brouillon à un redimensionnement** : le brouillon est désormais hissé
 *     dans le panneau, mais l'éprouver demanderait de traverser un seuil de largeur en
 *     gardant la même session — coûteux pour un check, et `fs3-chat` C6 couvre déjà la
 *     conservation du brouillon.
 *   - **Le rendu visuel** des fenêtres (ombre, alignement de la bande, proportions) : à l'œil.
 */
export const name = 'fs4-messages';
export const surface = 'rail social — liste des conversations et fenêtres multiples';
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

  const friendsTab = page.getByRole('tab', { name: 'Friends' });
  const messagesTab = page.getByRole('tab', { name: 'Messages' });
  const conversationsList = page.getByRole('list', { name: 'Conversations' });
  const windows = page.getByRole('region', { name: /^Chat with / });

  // Trois interlocuteurs : deux à qui on écrit, un ami muet qui doit rester HORS de la liste.
  const talkative = await createUser();
  const second = await createUser();
  const silent = await createUser();

  setPhase('1. la liste ne contient que les échanges réels');
  await login(user);
  await makeFriends(user, talkative, ORIGIN);
  await makeFriends(user, second, ORIGIN);
  await makeFriends(user, silent, ORIGIN);
  await page.reload({ waitUntil: 'networkidle' });
  await messagesTab.click();
  const emptyList = await page
    .getByText('No conversations yet.')
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  // On écrit à deux des trois, par l'interface, pour que la liste se peuple pour de vrai.
  await friendsTab.click();
  await page.getByRole('button', { name: `Send a message to @${talkative.pseudo}` }).click();
  const firstWindow = page.getByRole('region', { name: new RegExp(`^Chat with `) });
  await firstWindow.first().waitFor({ timeout: 10000 });
  await page.getByPlaceholder('Send a message…').first().fill('premier');
  await page.getByPlaceholder('Send a message…').first().press('Enter');
  await page.waitForTimeout(1200);

  await friendsTab.click();
  await page.getByRole('button', { name: `Send a message to @${second.pseudo}` }).click();
  await page.waitForTimeout(500);
  const composers = page.getByPlaceholder('Send a message…');
  await composers.last().fill('second');
  await composers.last().press('Enter');
  await page.waitForTimeout(1200);

  await messagesTab.click();
  await conversationsList.waitFor({ timeout: 10000 });
  const rows = await conversationsList.getByRole('listitem').count();
  const silentListed = await conversationsList
    .getByText(silent.pseudo, { exact: false })
    .count();
  step(
    'M1',
    emptyList && rows === 2 && silentListed === 0,
    `état vide au départ=${emptyList}, lignes après deux échanges : ${rows} (2 attendues), ami sans aucun message présent dans la liste : ${silentListed} (0 attendue — la liste d'amis est l'autre onglet)`,
  );

  // ------------------------------------------- §2 les deux points d'entrée convergent
  setPhase('2. liste et amis ouvrent la MÊME fenêtre');
  // Les deux fenêtres sont déjà ouvertes par la phase 1. On reclique le premier interlocuteur
  // depuis la LISTE, puis depuis les AMIS : ni l'un ni l'autre ne doit créer de copie.
  await conversationsList
    .getByRole('listitem')
    .filter({ hasText: talkative.pseudo })
    .getByRole('button')
    .first()
    .click();
  await page.waitForTimeout(600);
  const afterListClick = await windows.count();
  await friendsTab.click();
  await page.getByRole('button', { name: `Send a message to @${talkative.pseudo}` }).click();
  await page.waitForTimeout(600);
  const afterFriendClick = await windows.count();
  step(
    'M2',
    afterListClick === 2 && afterFriendClick === 2,
    `fenêtres après un clic depuis la LISTE : ${afterListClick}, puis depuis les AMIS : ${afterFriendClick} (2 dans les deux cas — les deux points d'entrée doivent atteindre la même fenêtre, jamais en créer une seconde)`,
  );

  // ------------------------------------- §3 réordonnancement en direct de la liste
  setPhase('3. une conversation remonte en tête à la réception');
  const peerContext = await page.context().browser().newContext({ ignoreHTTPSErrors: true });
  await peerContext.addCookies(talkative.cookies);
  const peerPage = await peerContext.newPage();
  await peerPage.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
  await peerPage.getByRole('tab', { name: 'Friends' }).click();
  await peerPage.getByRole('button', { name: `Send a message to @${user.pseudo}` }).click();
  const peerComposer = peerPage.getByPlaceholder('Send a message…').first();
  await peerComposer.waitFor({ timeout: 10000 });

  await messagesTab.click();
  await conversationsList.waitFor({ timeout: 10000 });
  const firstBefore = (await conversationsList.getByRole('listitem').first().innerText()).trim();
  const bump = `remontee-${Date.now()}`;
  await peerComposer.fill(bump);
  await peerComposer.press('Enter');
  // On attend l'EFFET (la ligne passe en tête), jamais un délai fixe.
  const movedUp = await page
    .waitForFunction(
      (pseudo) => {
        const list = document.querySelector('ul[aria-label="Conversations"]');
        const first = list?.querySelector('li');
        return Boolean(first && first.textContent && first.textContent.includes(pseudo));
      },
      talkative.pseudo,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  const rowsAfterBump = await conversationsList.getByRole('listitem').count();
  step(
    'M3',
    movedUp && rowsAfterBump === 2,
    `1ʳᵉ ligne avant : « ${firstBefore.replace(/\s+/g, ' ').slice(0, 40)} » ; conversation remontée en tête à la réception=${movedUp} (sans rechargement), lignes après : ${rowsAfterBump} (2 attendues — remonter ne doit pas dupliquer)`,
  );

  // ------------------------- §4 le maximum de fenêtres évince la plus ancienne
  setPhase('4. plafond de fenêtres à 1280 px');
  // Le harnais tourne à 1280 px : le plafond y vaut 2. Ouvrir un 3ᵉ interlocuteur doit donc
  // faire céder le plus ancien, jamais empiler une fenêtre hors de l'écran.
  await friendsTab.click();
  await page.getByRole('button', { name: `Send a message to @${silent.pseudo}` }).click();
  await page.waitForTimeout(800);
  const windowCount = await windows.count();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'M4',
    windowCount === 2 && overflow <= 0,
    `fenêtres après ouverture d'un 3ᵉ interlocuteur à 1280 px : ${windowCount} (2 attendues — la plus ancienne cède, on n'empile pas hors écran), débordement horizontal du document : ${overflow}px (≤ 0 attendu)`,
  );

  // ---------- §5 LE DÉFAUT DE REVIEW : une conversation ouverte mais MASQUÉE par la largeur
  setPhase('5. rouvrir une conversation masquée par un changement de largeur');
  // 🚨 CE CHECK GARDE UN CLIC QUI NE FAISAIT RIEN, atteignable par un simple Ctrl +.
  //
  // ⚠️ ET IL A ÉTÉ VU FAUX VERT AVANT DE MARCHER. Première version : ouvrir un 3ᵉ
  // interlocuteur pour faire céder le plus ancien, puis le recliquer. Ça ne reproduit RIEN —
  // l'éviction retire l'entrée de l'état lui-même, donc la garde « déjà ouverte » est fausse
  // et le clic rouvre normalement. Vérifié en réintroduisant le défaut : le check restait vert.
  //
  // Le seul chemin réel est un CHANGEMENT DE LARGEUR : l'état garde N conversations, la
  // largeur n'en affiche plus que M < N. C'est exactement ce que produit un Ctrl + du
  // navigateur. On ouvre donc 3 fenêtres au large, on rétrécit, et on reclique la masquée.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.reload({ waitUntil: 'networkidle' });
  await friendsTab.click();
  for (const who of [talkative, second, silent]) {
    await page.getByRole('button', { name: `Send a message to @${who.pseudo}` }).click();
    await page.waitForTimeout(400);
    await friendsTab.click();
  }
  const wideCount = await windows.count();
  // Rétrécir : le plafond retombe à 2, la plus ancienne (talkative) sort de l'affichage mais
  // RESTE dans l'état — c'est précisément la situation que la garde ne savait pas distinguer.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(600);
  const narrowCount = await windows.count();
  const hiddenOne = await page
    .getByRole('region', { name: new RegExp(`^Chat with .*${talkative.pseudo}`) })
    .count();

  await messagesTab.click();
  await conversationsList.waitFor({ timeout: 10000 });
  await conversationsList
    .getByRole('listitem')
    .filter({ hasText: talkative.pseudo })
    .getByRole('button')
    .first()
    .click();
  const reopened = await page
    .getByRole('region', { name: new RegExp(`^Chat with .*${talkative.pseudo}`) })
    .first()
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const countAfterReopen = await windows.count();
  step(
    'M5',
    wideCount === 3 &&
      narrowCount === 2 &&
      hiddenOne === 0 &&
      reopened &&
      countAfterReopen === 2,
    `fenêtres à 1600 px : ${wideCount} (3 attendues) ; après rétrécissement à 1280 px : ${narrowCount} (2 attendues) et la plus ancienne n'est plus rendue (${hiddenOne} occurrence, 0 attendue) alors qu'elle reste OUVERTE dans l'état ; la recliquer depuis la liste la réaffiche=${reopened} (AVANT correction ce clic était MORT : la garde « déjà ouverte » renvoyait l'état inchangé, aucune fenêtre, aucune explication), fenêtres finales : ${countAfterReopen} (2 attendues)`,
  );

  // --------------------------------- §6 fermeture : les autres restent, le focus atterrit
  setPhase('6. fermer une fenêtre');
  const before = await windows.count();
  await page
    .getByRole('button', { name: /^Close the conversation with / })
    .first()
    .click();
  await page.waitForTimeout(600);
  const after = await windows.count();
  await awaitFocusRestored();
  const landing = await focusLanding();
  step(
    'M6',
    after === before - 1 && landing.tag !== 'BODY',
    `fenêtres : ${before} → ${after} (une de moins attendue, les autres intactes), focus après fermeture : <${landing.tag}> « ${landing.label} » (jamais BODY)`,
  );

  // ------------------------------- §7 sous 1024 px : AUCUNE fenêtre flottante
  setPhase('7. petit écran : pas de fenêtre flottante');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'networkidle' });
  const floatingOnMobile = await windows.count();
  await page.getByRole('button', { name: 'Open social panel' }).click();
  const mobilePanel = page.getByRole('dialog', { name: 'Social' });
  await mobilePanel.waitFor({ timeout: 5000 });
  await mobilePanel.getByRole('tab', { name: 'Messages' }).click();
  await mobilePanel
    .getByRole('list', { name: 'Conversations' })
    .getByRole('listitem')
    .first()
    .getByRole('button')
    .first()
    .click();
  const inlineOpened = await mobilePanel
    .getByRole('group', { name: /^Conversation with / })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const floatingAfterOpen = await windows.count();
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'M7',
    floatingOnMobile === 0 && inlineOpened && floatingAfterOpen === 0 && mobileOverflow <= 0,
    `fenêtres flottantes à 375 px : ${floatingOnMobile} au chargement puis ${floatingAfterOpen} après ouverture (0 dans les deux cas — une fenêtre par-dessus le panneau modal rejouerait le piège d'Escape), conversation ouverte DANS le panneau=${inlineOpened}, débordement horizontal : ${mobileOverflow}px (≤ 0 attendu)`,
  );

  // ------------------------------------------------------------ §8 filets transverses
  setPhase('8. filets transverses');
  step(
    'M8',
    clientErrors.length === 0,
    `réponses 4xx sur tout le parcours : ${clientErrors.length} (0 attendue)${clientErrors.length ? ` — ${clientErrors.join(', ')}` : ''}`,
  );

  await peerContext.close();
}
