/**
 * [FS-2] — la cloche de notifications du rail social.
 *
 * 🚨 TOUTES LES NOTIFICATIONS DE CE SCÉNARIO SONT PRODUITES PAR DE VRAIES ACTIONS.
 * Aucune n'est écrite en base : un tiers envoie une demande d'ami (→ `friend_request_received`),
 * le compte du run l'accepte (→ `friend_request_accepted` chez le tiers). C'est la seule façon
 * d'être sûr que le payload rendu à l'écran est celui que le serveur émet réellement — une
 * fixture écrite à la main peut avoir une forme que le vrai code ne produit jamais.
 *
 * Ce qu'il vérifie :
 *   - **aucune lecture de la LISTE tant que la cloche est fermée** — le rail est monté sur
 *     toutes les pages authentifiées ; seul le compteur a le droit de partir, c'est ce que la
 *     pastille affiche en permanence ;
 *   - la pastille compte juste, et **s'incrémente en direct** sans rechargement ;
 *   - le panneau rend une **phrase lisible**, et **aucun contenu technique** : ni identifiant,
 *     ni accolade, ni nom de champ ;
 *   - marquer lue décrémente la pastille **et tient au rechargement** (c'était bien le serveur,
 *     pas un affichage optimiste) ;
 *   - « tout marquer lu » fait disparaître la pastille ;
 *   - `Escape` rend le focus à la cloche — avant ce ticket le panneau ne contenait aucun
 *     élément focalisable, c'est FS-2 qui rend le problème atteignable ;
 *   - **sous 1024 px, le déclencheur du panneau porte l'information** : sans ça rien ne
 *     signale une notification sur téléphone tant qu'on n'ouvre pas le rail.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - **Les 17 types** : seuls deux sont atteignables sans fabriquer un match, une équipe et
 *     un litige. Les autres phrases et leurs liens restent à voir à l'œil, avec `seed:social`.
 *   - **La pagination** : il faudrait 21 notifications, donc 21 comptes tiers.
 *   - **Le repli sur un type inconnu** : il exige un type que le serveur n'émet pas.
 */
export const name = 'fs2-notifications';
export const surface = 'rail social — cloche : pastille, liste, marquage lu';
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

/** Une VRAIE demande d'ami : c'est elle qui produit la notification chez la cible. */
async function sendFriendRequest(from, to, ORIGIN) {
  const toId = await userIdOf(to, ORIGIN);
  const response = await fetch(`${ORIGIN}/api/friends`, {
    method: 'POST',
    headers: authHeaders(from, true),
    body: JSON.stringify({ addresseeId: toId }),
  });
  if (!response.ok) throw new Error(`POST /friends a répondu ${response.status}`);
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

  // On sépare les deux appels : le COMPTEUR a le droit de partir sur chaque page (c'est la
  // pastille), la LISTE ne doit partir qu'à l'ouverture du panneau. Le serveur les sert par la
  // même route, on les distingue donc par leur `limit`.
  const listCalls = [];
  const probeCalls = [];
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (res.request().method() !== 'GET' || url.pathname !== '/api/notifications') return;
    (url.searchParams.get('limit') === '1' ? probeCalls : listCalls).push(url.search);
  });

  const bell = page.getByRole('button', { name: /^Notifications/ });

  // ------------------------------------ §1 rien ne charge la liste avant l'ouverture
  setPhase('1. une notification arrive, la liste ne se charge pas');
  const sender = await createUser();
  await sendFriendRequest(sender, user, ORIGIN);
  await login(user);
  // On navigue pour éprouver « le rail est monté partout » : la liste ne doit toujours pas
  // partir, même après plusieurs écrans.
  const railNav = page.getByRole('navigation', { name: 'Primary navigation' });
  await railNav.getByRole('link', { name: 'My teams' }).click();
  await page.waitForURL('**/teams');
  await railNav.getByRole('link', { name: 'Home' }).click();
  await page.waitForURL('**/home');
  const badgeShown = await bell
    .filter({ hasText: '1' })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'N1',
    badgeShown && listCalls.length === 0 && probeCalls.length > 0,
    `pastille à 1 sur une demande d'ami réellement reçue=${badgeShown}, lectures de la LISTE avant ouverture : ${listCalls.length} (0 attendue — le rail est monté sur toutes les pages), lectures du COMPTEUR : ${probeCalls.length} (≥ 1 attendue, c'est la pastille)`,
  );

  // ---------------------------------- §2 le panneau rend une phrase, pas de la technique
  setPhase('2. ouvrir la cloche');
  await bell.click();
  const list = page.getByRole('list', { name: 'Notifications' });
  const listShown = await list
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const firstText = ((await list.getByRole('listitem').first().innerText()) || '').trim();
  // 🔑 On refuse la TECHNIQUE, on n'exige pas une phrase précise : un uuid, une accolade ou un
  // nom de champ à l'écran signifient qu'un payload est rendu brut.
  const looksTechnical =
    /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(firstText) ||
    /[{}[\]]/.test(firstText) ||
    /friendshipId|fromUserId|ladderId|matchId/.test(firstText);
  const mentionsSender = firstText.includes(sender.pseudo);
  step(
    'N2',
    listShown && listCalls.length === 1 && !looksTechnical && mentionsSender,
    `liste montée à l'ouverture=${listShown}, lectures de la LISTE : ${listCalls.length} (1 attendue — elle part MAINTENANT, pas avant), contenu technique visible (uuid, accolade, nom de champ)=${looksTechnical} (false attendu), la phrase nomme l'expéditeur=${mentionsSender} — « ${firstText.replace(/\s+/g, ' ').slice(0, 70)} »`,
  );

  // ------------------------------------------- §3 une 2ᵉ notification arrive EN DIRECT
  setPhase('3. incrément en direct, panneau ouvert');
  const secondSender = await createUser();
  await sendFriendRequest(secondSender, user, ORIGIN);
  const grewLive = await bell
    .filter({ hasText: '2' })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const rowsLive = await list.getByRole('listitem').count();
  step(
    'N3',
    grewLive && rowsLive === 2,
    `pastille passée à 2 sans rechargement=${grewLive}, lignes dans le panneau : ${rowsLive} (2 attendues — la notification arrivée pendant que le panneau est OUVERT doit entrer dans la liste, sans écraser le chargement en cours)`,
  );

  // -------------------------------- §4 marquer lue : la pastille bouge ET ça tient
  setPhase('4. marquer une notification lue');
  await page
    .getByRole('button', { name: /^Mark as read: / })
    .first()
    .click();
  const decremented = await bell
    .filter({ hasText: '1' })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  // 🔑 Le rechargement est le vrai check : sans lui on prouverait un affichage optimiste, pas
  // une écriture serveur.
  await page.reload({ waitUntil: 'networkidle' });
  const stillOne = await bell
    .filter({ hasText: '1' })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'N4',
    decremented && stillOne,
    `pastille décrémentée à 1=${decremented}, encore à 1 APRÈS rechargement complet=${stillOne} (sinon on aurait prouvé un affichage optimiste, pas une écriture serveur)`,
  );

  // ------------------------------------------------- §5 tout marquer lu
  setPhase('5. tout marquer lu');
  await bell.click();
  await list.waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Mark all read' }).click();
  const badgeGone = await page
    .waitForFunction(
      () => {
        const button = [...document.querySelectorAll('button')].find((b) =>
          (b.getAttribute('aria-label') ?? '').startsWith('Notifications'),
        );
        return Boolean(button) && !/\d/.test(button.textContent ?? '');
      },
      undefined,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  step(
    'N5',
    badgeGone,
    `pastille disparue après « tout marquer lu »=${badgeGone} (le compteur compte TOUTES mes non-lues, pas seulement la page affichée)`,
  );

  // --------------------------------------- §6 Escape rend le focus à la cloche
  setPhase('6. Escape rend le focus');
  await page.keyboard.press('Escape');
  await awaitFocusRestored();
  const landing = await focusLanding();
  const backOnBell = (landing.label ?? '').startsWith('Notifications');
  step(
    'N6',
    backOnBell && landing.tag !== 'BODY',
    `focus après Escape : <${landing.tag}> « ${landing.label} » (la cloche attendue — avant ce ticket le panneau ne contenait AUCUN élément focalisable, c'est lui qui rend le problème atteignable)`,
  );

  // ------------------- §7 sous 1024 px : le déclencheur du panneau porte l'information
  setPhase('7. petit écran : l’information est visible sans ouvrir');
  const thirdSender = await createUser();
  await sendFriendRequest(thirdSender, user, ORIGIN);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'networkidle' });
  const mobileTrigger = page.getByRole('button', { name: /^Open social panel/ });
  const mobileName = await mobileTrigger.getAttribute('aria-label').catch(() => '');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  step(
    'N7',
    /unread/i.test(mobileName ?? '') && overflow <= 0,
    `nom accessible du déclencheur mobile : « ${mobileName} » (il doit porter le nombre de non-lues — sinon rien ne signale une notification sur téléphone tant qu'on n'ouvre pas le rail), débordement horizontal : ${overflow}px (≤ 0 attendu)`,
  );

  // ------------------------------------------------------------ §8 filets transverses
  setPhase('8. filets transverses');
  step(
    'N8',
    clientErrors.length === 0,
    `réponses 4xx sur tout le parcours : ${clientErrors.length} (0 attendue)${clientErrors.length ? ` — ${clientErrors.join(', ')}` : ''} ; lectures de la liste au total : ${listCalls.length}`,
  );
}
