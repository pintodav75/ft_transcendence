/**
 * [FS-5] — l'onglet « Ajouter » du rail social : recherche, demandes, blocages.
 *
 * 🚨 CET ÉCRAN EST LE PLUS EXPOSÉ DU RAIL À LA CONSOLE, et c'est ce que le scénario garde
 * en priorité. Une barre de recherche produit des saisies invalides **en permanence**, et
 * chaque refus du serveur écrit une ligne rouge — motif de rejet du projet. Trois gardes
 * doivent tenir **sans jamais toucher le réseau** : moins de 2 caractères, soi-même, et une
 * personne à qui on vient déjà d'écrire.
 * 🔑 C'est pour la même raison que cet écran cherche par `GET /search` (200 avec une liste
 * vide) et non par `GET /users/{pseudo}` (404 sur chaque faute de frappe) — décision du 01/08.
 *
 * Ce qu'il vérifie encore :
 *   - les trois listes ne se chargent **pas** tant que l'onglet n'est pas ouvert (le rail est
 *     monté sur toutes les pages authentifiées) ;
 *   - envoyer une demande la fait apparaître dans « Requests sent » sans rechargement ;
 *   - 🚨 **quand l'autre accepte, la ligne « Requests sent » DISPARAÎT en direct** — c'est le
 *     défaut le plus grave trouvé sur tout le rail : sans l'abonnement au temps réel, la ligne
 *     restait avec son bouton « Annuler », et ce bouton **supprimait l'amitié** en affichant
 *     « demande annulée », sans prévenir personne ;
 *   - accepter une demande reçue la fait passer côté amis.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - 🚨 **TROIS BOUTONS DE CET ÉCRAN NE SONT CLIQUÉS PAR AUCUN SCÉNARIO DU PROJET** :
 *     « Refuser » une demande reçue (`POST /friends/{id}/reject`, un appel qu'aucun test
 *     n'exerce), « Annuler » une demande envoyée, et « Débloquer ». Ils fonctionnent — vérifié
 *     à la main le 01/08 — mais rien ne rougira le jour où ils cesseront de fonctionner.
 *     ⚠️ **Cet en-tête AFFIRMAIT les couvrir** (« annuler une demande envoyée et débloquer un
 *     compte marchent sans rechargement ») : phrase fausse depuis l'origine, corrigée le 01/08
 *     après avoir induit en erreur une review qui la lisait pour savoir ce qui était gardé.
 *     🔑 **Un scénario ne décrit que ce qu'il CLIQUE.** Carte à créer.
 *   - **L'acceptation automatique** (l'autre m'avait déjà écrit) : le chemin est couvert par
 *     le code, mais l'éprouver demande d'orchestrer deux demandes croisées au bon moment.
 *   - **Le blocage** lui-même : il se déclenche depuis l'onglet Amis (`fs1-friends` F7).
 *   - **Le rendu visuel** à 312 px avec un pseudo long et deux boutons : à l'œil.
 */
export const name = 'fs5-add-friend';
export const surface = 'rail social — onglet Ajouter : recherche, demandes, blocages';
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

export async function run({
  page,
  setPhase,
  step,
  user,
  createUser,
  login,
  awaitAnnouncement,
  ORIGIN,
}) {
  const clientErrors = [];
  page.on('response', (res) => {
    if (res.status() >= 400 && res.status() < 500) {
      clientErrors.push(`${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()}`);
    }
  });

  // Tout ce que l'onglet peut demander. Séparé du reste pour prouver le « rien avant
  // l'ouverture », puis pour compter les requêtes que les gardes doivent ÉVITER.
  const tabCalls = [];
  const searchCalls = [];
  page.on('request', (req) => {
    const { pathname } = new URL(req.url());
    if (!pathname.startsWith('/api/')) return;
    if (pathname === '/api/search') searchCalls.push(req.url());
    if (['/api/friends/requests', '/api/blocks'].includes(pathname)) tabCalls.push(pathname);
    if (pathname === '/api/friends' && req.method() === 'POST') tabCalls.push('POST /friends');
  });

  const addTab = page.getByRole('tab', { name: 'Add friend' });
  const search = page.getByPlaceholder('Search a player by pseudo…');
  const sentList = page.getByRole('list', { name: 'Friend requests sent' });
  const receivedList = page.getByRole('list', { name: 'Friend requests received' });

  const target = await createUser();
  const suitor = await createUser();

  // ------------------------------------- §1 rien ne charge avant l'ouverture de l'onglet
  setPhase('1. les listes ne se chargent pas avant l’ouverture');
  await login(user);
  const railNav = page.getByRole('navigation', { name: 'Primary navigation' });
  await railNav.getByRole('link', { name: 'My teams' }).click();
  await page.waitForURL('**/teams');
  await railNav.getByRole('link', { name: 'Home' }).click();
  await page.waitForURL('**/home');
  const callsBeforeTab = tabCalls.length;
  await addTab.click();
  await page.getByRole('heading', { name: 'Requests received' }).waitFor({ timeout: 10000 });
  step(
    'A1',
    callsBeforeTab === 0 && tabCalls.length >= 2,
    `requêtes de l'onglet avant son ouverture : ${callsBeforeTab} (0 attendue — le rail est monté sur toutes les pages), après ouverture : ${tabCalls.length} (≥ 2 attendues : demandes et blocages)`,
  );

  // ------------------------------ §2 LES GARDES : aucune requête, aucune ligne rouge
  setPhase('2. les gardes ne touchent pas le réseau');
  // 🚨 Le cœur du ticket. Chacune de ces trois saisies produirait un refus du serveur, donc
  // une ligne rouge en console, si elle partait. On compte les requêtes, pas les messages.
  const searchesBefore = searchCalls.length;
  await search.fill('a');
  await page.waitForTimeout(900);
  const afterOneChar = searchCalls.length;

  // Se chercher soi-même : la route ne filtre PAS l'appelant, on se retrouve donc bien dans
  // les résultats — c'est la garde du front qui doit empêcher l'envoi.
  const postsBefore = tabCalls.filter((c) => c === 'POST /friends').length;
  await search.fill(user.pseudo);
  const selfResult = page.getByRole('button', { name: new RegExp(user.pseudo) });
  const selfShown = await selfResult
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (selfShown) await selfResult.first().click();
  await page.waitForTimeout(600);
  const postsAfterSelf = tabCalls.filter((c) => c === 'POST /friends').length;
  step(
    'A2',
    afterOneChar === searchesBefore && postsAfterSelf === postsBefore,
    `recherche à 1 caractère : ${afterOneChar - searchesBefore} requête(s) (0 attendue — en dessous de 2 caractères le serveur rend 400) ; clic sur SOI-MÊME dans les résultats (retourné=${selfShown}, la route ne filtre pas l'appelant) : ${postsAfterSelf - postsBefore} envoi(s) (0 attendu — le serveur rendrait 400)`,
  );

  // -------------------------------------------- §3 envoyer une demande
  setPhase('3. envoyer une demande');
  await search.fill(target.pseudo);
  const targetResult = page.getByRole('button', { name: new RegExp(target.pseudo) });
  await targetResult.first().waitFor({ timeout: 10000 });
  const sentAnnounced = awaitAnnouncement('Friend request sent');
  await targetResult.first().click();
  const heard = await sentAnnounced;
  const appeared = await sentList
    .getByRole('listitem')
    .filter({ hasText: target.pseudo })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  // Recliquer la même personne : la garde « déjà demandé » doit tenir, toujours sans réseau.
  const postsBeforeRepeat = tabCalls.filter((c) => c === 'POST /friends').length;
  await search.fill(target.pseudo);
  await targetResult.first().waitFor({ timeout: 10000 });
  await targetResult.first().click();
  await page.waitForTimeout(600);
  const postsAfterRepeat = tabCalls.filter((c) => c === 'POST /friends').length;
  step(
    'A3',
    appeared && heard && postsAfterRepeat === postsBeforeRepeat,
    `demande apparue dans « Requests sent » sans rechargement=${appeared}, annonce lue=${heard}, second clic sur la même personne : ${postsAfterRepeat - postsBeforeRepeat} envoi(s) (0 attendu — le serveur rendrait 400 « déjà demandé »)`,
  );

  // ---------- §4 🚨 L'AUTRE ACCEPTE : la ligne doit DISPARAÎTRE, onglet resté ouvert
  setPhase('4. l’autre accepte pendant que je regarde');
  // 🚨 CE CHECK GARDE LE DÉFAUT LE PLUS GRAVE DU RAIL.
  // Sans abonnement au temps réel, la ligne restait affichée AVEC son bouton « Annuler » —
  // or le serveur accepte cette suppression même sur une amitié ACCEPTÉE. Le clic détruisait
  // donc l'amitié en affichant « demande annulée », sans prévenir personne.
  const pending = await fetch(`${ORIGIN}/api/friends/requests?direction=received`, {
    headers: authHeaders(target),
  }).then((r) => r.json());
  const mine = pending.requests.find((r) => r.from.pseudo === user.pseudo);
  if (!mine) throw new Error("la demande envoyée n'est pas visible côté destinataire");
  const accept = await fetch(`${ORIGIN}/api/friends/${mine.id}/accept`, {
    method: 'POST',
    headers: authHeaders(target),
  });
  if (!accept.ok) throw new Error(`acceptation a répondu ${accept.status}`);

  const lineGone = await page
    .waitForFunction(
      (pseudo) => {
        const list = document.querySelector('ul[aria-label="Friend requests sent"]');
        if (!list) return true;
        return ![...list.querySelectorAll('li')].some((li) => (li.textContent ?? '').includes(pseudo));
      },
      target.pseudo,
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  step(
    'A4',
    lineGone,
    `ligne « Requests sent » disparue en direct quand l'autre accepte=${lineGone} — SANS abonnement au temps réel elle restait, avec un bouton « Annuler » qui SUPPRIME l'amitié en disant « demande annulée »`,
  );

  // ------------------------------------------- §5 accepter une demande reçue
  setPhase('5. accepter une demande reçue');
  const suitorId = await userIdOf(user, ORIGIN);
  const request = await fetch(`${ORIGIN}/api/friends`, {
    method: 'POST',
    headers: authHeaders(suitor, true),
    body: JSON.stringify({ addresseeId: suitorId }),
  });
  if (!request.ok) throw new Error(`POST /friends a répondu ${request.status}`);
  const acceptResponses = [];
  page.on('response', (res) => {
    if (/\/api\/friends\/[0-9a-f-]{36}\/accept$/.test(new URL(res.url()).pathname)) {
      acceptResponses.push(res.status());
    }
  });
  const incoming = receivedList.getByRole('listitem').filter({ hasText: suitor.pseudo });
  const incomingShown = await incoming
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  // 🚨 ON LAISSE LES RÉSULTATS DE RECHERCHE AFFICHÉS, ET C'EST TOUT L'INTÉRÊT.
  // Défaut trouvé en écrivant ce scénario : le panneau de résultats, en se démontant sur
  // `pointerdown`, faisait REMONTER tout ce qui était en dessous — le navigateur ne
  // dispatchait alors plus aucun `click` sur le bouton visé (il le posait sur l'ancêtre
  // commun de `mousedown` et `mouseup`). Le PREMIER clic ailleurs dans l'onglet était donc
  // perdu, sans rien à l'écran pour l'expliquer, et c'est le parcours normal : on cherche
  // quelqu'un, on ne le trouve pas, on traite une demande juste en dessous.
  // ⚠️ Vider le champ avant de cliquer FAIT DISPARAÎTRE le défaut — c'est exactement le
  // contournement à ne pas écrire ici.
  await search.fill(target.pseudo);
  await page
    .getByRole('button', { name: new RegExp(target.pseudo) })
    .first()
    .waitFor({ timeout: 10000 });
  const resultsVisible = await page
    .getByRole('button', { name: new RegExp(target.pseudo) })
    .first()
    .isVisible()
    .catch(() => false);

  let acceptClicked = false;
  if (incomingShown) {
    const acceptButton = page.getByRole('button', {
      name: `Accept the friend request from @${suitor.pseudo}`,
    });
    acceptClicked = await acceptButton
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    // UN SEUL clic. Un second masquerait le défaut.
    if (acceptClicked) await acceptButton.click();
    await page.waitForTimeout(1500);
  }
  const acceptedGone = await page
    .waitForFunction(
      (pseudo) => {
        const list = document.querySelector('ul[aria-label="Friend requests received"]');
        if (!list) return true;
        return ![...list.querySelectorAll('li')].some((li) => (li.textContent ?? '').includes(pseudo));
      },
      suitor.pseudo,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  // Elle doit maintenant être dans l'onglet Amis, et la présence doit avoir été resynchronisée.
  await page.getByRole('tab', { name: 'Friends' }).click();
  const nowFriend = await page
    .getByRole('listitem')
    .filter({ hasText: suitor.pseudo })
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  step(
    'A5',
    incomingShown && resultsVisible && acceptResponses.includes(200) && acceptedGone && nowFriend,
    `demande reçue apparue EN DIRECT sans rechargement=${incomingShown} ; résultats de recherche encore affichés au moment du clic=${resultsVisible} (c'est la condition du défaut) ; UN SEUL clic sur « Accepter » → réponses du serveur : [${acceptResponses.join(', ') || 'AUCUNE — le premier clic a été avalé'}], ligne partie=${acceptedGone}, la personne est dans l'onglet Amis=${nowFriend}`,
  );

  // ------------------------------------------------------------ §6 filets transverses
  setPhase('6. filets transverses');
  step(
    'A6',
    clientErrors.length === 0,
    `réponses 4xx sur tout le parcours : ${clientErrors.length} (0 attendue — c'est LE critère de cet écran)${clientErrors.length ? ` — ${clientErrors.join(', ')}` : ''} ; requêtes de recherche : ${searchCalls.length}`,
  );
}
