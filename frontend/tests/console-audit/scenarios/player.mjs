/**
 * [F-PLAYER] — `/players/$pseudo` : la fiche d'un autre joueur et les actions de relation.
 *
 * 🚨 CE SCÉNARIO EXISTE POUR UN DÉFAUT MESURÉ EN USAGE RÉEL, pas pour couvrir une page.
 * La route est **réutilisée d'un joueur au suivant** — seul le param change, donc React garde
 * la même instance et TOUT l'état local survit à la navigation. Vécu par David : demande d'ami
 * envoyée à Bob, puis ouverture du profil d'Erin par la barre de recherche → le bandeau vert
 * « Friend request sent to… » était toujours là, **re-rendu au nom d'Erin**, au-dessus d'un
 * profil avec qui on était **déjà ami**. C'est `P4` qui garde ça, et il faut le lire avec `P3` :
 * `P3` établit le bandeau, `P4` exige sa disparition APRÈS une navigation **client**.
 *
 * ⚠️ LA NAVIGATION DE `P4` DOIT RESTER CLIENT (barre de recherche du rail). Un `page.goto`
 * recharge la SPA, remonte tout, et **fait disparaître le défaut** : le scénario sortirait vert
 * sur du code cassé. C'est le contournement à ne pas écrire ici.
 *
 * Les deux autres défauts gardés, tous deux trouvés en review :
 *   - `P5` — « Block » était offert à un AMI mais la fenêtre de confirmation n'était montée que
 *     pour un inconnu : le clic n'armait rien, aucun message, aucune requête. Or se brouiller
 *     avec quelqu'un qu'on connaît est la raison ordinaire de bloquer.
 *   - `P6` — un blocage réussi laissait la fiche affichée AVEC « Add friend », alors que le
 *     serveur rend 404 au bloqueur lui-même à partir de cet instant.
 *
 * `P7` garde la conséquence la moins visible : la fiche appelle les mutations du RAIL
 * (`lib/friend-mutations.ts`). Avec la copie privée qu'elle portait au départ, bloquer depuis
 * un profil laissait la personne dans l'onglet Amis et hors des bloqués jusqu'au rechargement.
 * `P2R` garde l'autre direction du même contrat : envoyer puis annuler depuis le RAIL doit
 * changer le bouton de la fiche déjà ouverte, sans rechargement.
 * `P2B` garde le cycle demande → blocage → déblocage → nouvelle demande depuis le rail : la
 * garde anti-double-clic ne doit pas survivre à la suppression serveur de la première demande.
 * `P7U` vérifie enfin que débloquer depuis ce rail libère aussi l'écran local « Player blocked ».
 * `P7R` garde le sens qui manquait : bloquer depuis le rail doit fermer la fiche déjà ouverte.
 *
 * ⚠️ CE QUE CE SCÉNARIO NE PROUVE PAS.
 *   - Le RANG et la taille du ladder (`#2 / 23`) : ça demande des matchs joués, c'est la suite
 *     Python `test_users_profile.py` qui le garde, ex æquo compris.
 *   - L'acceptation automatique (`POST /friends` quand l'autre a déjà demandé).
 *   - Le rendu visuel du hero à 375 px avec un pseudo long : à l'œil.
 */
export const name = 'player';
export const surface = '/players/$pseudo — fiche joueur, relations, blocage';

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

/** Amitié ACCEPTÉE entre `from` et `to`, par l'API — l'UI n'a pas de chemin pour la fabriquer. */
async function befriend(from, to, ORIGIN) {
  const toId = await userIdOf(to, ORIGIN);
  const sent = await fetch(`${ORIGIN}/api/friends`, {
    method: 'POST',
    headers: authHeaders(from, true),
    body: JSON.stringify({ addresseeId: toId }),
  });
  if (!sent.ok) throw new Error(`POST /friends a répondu ${sent.status}`);

  const inbox = await fetch(`${ORIGIN}/api/friends/requests?direction=received`, {
    headers: authHeaders(to),
  }).then((r) => r.json());
  const request = inbox.requests.find((r) => r.from.pseudo === from.pseudo);
  if (!request) throw new Error("la demande n'est pas visible côté destinataire");

  const accepted = await fetch(`${ORIGIN}/api/friends/${request.id}/accept`, {
    method: 'POST',
    headers: authHeaders(to),
  });
  if (!accepted.ok) throw new Error(`acceptation a répondu ${accepted.status}`);
}

export async function run({
  page,
  setPhase,
  step,
  user,
  createUser,
  awaitAnnouncement,
  expectHttp,
  ORIGIN,
}) {
  const clientErrors = [];
  page.on('response', (res) => {
    if (res.status() >= 400 && res.status() < 500) {
      clientErrors.push(
        `${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()}`,
      );
    }
  });

  const main = page.getByRole('main');
  const search = page.getByPlaceholder(/Search a player or team/);
  const sentCallout = page.getByText(/Friend request sent to/);

  const stranger = await createUser();
  const mate = await createUser();
  const railMate = await createUser();
  await befriend(user, mate, ORIGIN);
  await befriend(user, railMate, ORIGIN);

  // ------------------------------------------------ §1 la fiche d'un inconnu, compte neuf
  setPhase('1. fiche d’un inconnu');
  await page.goto(`${ORIGIN}/players/${stranger.pseudo}`, { waitUntil: 'networkidle' });

  const titled = await main
    .getByRole('heading', { level: 1, name: stranger.pseudo })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const handle = await main.getByText(`@${stranger.pseudo}`).count();
  const memberSince = await main.getByText('Member since').count();
  step(
    'P1',
    titled && handle === 1 && memberSince === 1,
    `titre de niveau 1 au nom du joueur=${titled}, « @pseudo » en sous-titre : ${handle} (1 attendu — un identifiant se relit exactement comme il a été tapé), « Member since » : ${memberSince} (1 attendu)`,
  );

  // 🚨 UN COMPTE NEUF N'EST PAS UN COMPTE CASSÉ. Une ligne de classement naît du PREMIER
  // RÉSULTAT DE MATCH, jamais d'une inscription : les deux listes vides sont l'état NORMAL,
  // et la copie doit le dire ainsi. Doublé du négatif qui porte la décision produit du 31/07 :
  // ni historique de matchs ni comptes de jeu liés sur le profil de quelqu'un d'autre.
  const noRanked = await main.getByText(/has not finished a ranked match yet/).count();
  const noTeam = await main.getByText(/is not in any team yet/).count();
  const privateSections = await main
    .getByRole('heading', { name: /match history|linked account/i })
    .count();
  step(
    'P2',
    noRanked === 1 && noTeam === 1 && privateSections === 0,
    `état vide des classements : ${noRanked} (1 attendu — un compte neuf n'a PAS de ligne, ce n'est pas une anomalie), état vide des équipes : ${noTeam} (1 attendu), sections « historique de matchs » ou « comptes liés » : ${privateSections} (0 attendue — décision produit du 31/07, ça se lit sur SON PROPRE compte)`,
  );

  // --------------------- §1b le rail et la fiche partagent l'état de la relation
  setPhase('1b. le rail actualise la fiche ouverte');
  await page.getByRole('tab', { name: 'Add friend' }).click();
  const railSearch = page.getByPlaceholder('Search a player by pseudo…');
  await railSearch.fill(stranger.pseudo);
  const strangerAdd = page.getByRole('button', { name: `Add @${stranger.pseudo}` });
  await strangerAdd.waitFor({ timeout: 10000 });
  await strangerAdd.click();

  // The profile query embeds `friendship`; refreshing only "Requests sent" leaves this button
  // on "Add friend", and the next click then produces the server's "already requested" 400.
  const railSendUpdatedProfile = await main
    .getByRole('button', { name: 'Cancel request' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  // ---------- §1c une demande supprimée par un blocage peut être renvoyée après déblocage
  setPhase('1c. redemander après blocage et déblocage');
  await main.getByRole('button', { name: 'Block' }).click();
  await page.getByRole('button', { name: 'Block player' }).click();
  const blockedAfterRequest = await main
    .getByRole('heading', { name: 'Player blocked' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  const earlyBlockedList = page.getByRole('list', { name: 'Blocked players' });
  const earlyUnblock = earlyBlockedList.getByRole('button', {
    name: `Unblock @${stranger.pseudo}`,
  });
  await earlyUnblock.waitFor({ timeout: 10000 });
  await earlyUnblock.click();
  const recoveredAfterUnblock = await main
    .getByRole('button', { name: 'Add friend' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  await railSearch.clear();
  await railSearch.fill(stranger.pseudo);
  await strangerAdd.waitFor({ timeout: 10000 });
  await strangerAdd.click();
  const requestedAgain = await main
    .getByRole('button', { name: 'Cancel request' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  // Restore a stranger with no pending request so P3 can exercise the profile's own action.
  let railCancelUpdatedProfile = false;
  if (requestedAgain) {
    const sentRow = page
      .getByRole('list', { name: 'Friend requests sent' })
      .getByRole('listitem')
      .filter({ hasText: stranger.pseudo });
    const railCancel = sentRow.getByRole('button', {
      name: `Cancel the friend request to @${stranger.pseudo}`,
    });
    await railCancel.waitFor({ timeout: 10000 });
    await railCancel.click();
    railCancelUpdatedProfile = await main
      .getByRole('button', { name: 'Add friend' })
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
  }
  await railSearch.clear();
  step(
    'P2R',
    railSendUpdatedProfile && railCancelUpdatedProfile,
    `envoi depuis le rail → bouton « Cancel request »=${railSendUpdatedProfile}, annulation depuis le rail → retour à « Add friend »=${railCancelUpdatedProfile} (les deux sans rechargement de la fiche)`,
  );
  step(
    'P2B',
    blockedAfterRequest && recoveredAfterUnblock && requestedAgain,
    `demande suivie d'un blocage → écran bloqué=${blockedAfterRequest}, profil revenu après déblocage=${recoveredAfterUnblock}, nouvelle demande réellement envoyée depuis le rail=${requestedAgain}`,
  );

  // ------------------------------------------------------- §2 envoyer une demande d'ami
  setPhase('2. envoyer une demande d’ami');
  const addFriend = main.getByRole('button', { name: 'Add friend' });
  await addFriend.waitFor({ timeout: 10000 });
  const sentAnnounced = awaitAnnouncement('Friend request sent');
  await addFriend.click();
  const heard = await sentAnnounced;
  const calloutShown = await sentCallout
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  // 🔑 Le bouton qui CHANGE prouve que le profil a été réinvalidé : la relation est portée par
  // `GET /users/{pseudo}`, donc sans invalidation il dirait encore « Add friend » après coup.
  const becameCancel = await main
    .getByRole('button', { name: 'Cancel request' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step(
    'P3',
    heard && calloutShown && becameCancel,
    `annonce lue=${heard}, bandeau affiché=${calloutShown}, le bouton est devenu « Cancel request »=${becameCancel} (c'est lui qui prouve que la fiche a été réinvalidée — la relation vient de GET /users/{pseudo})`,
  );

  // ---------- §3 🚨 LE DÉFAUT : changer de joueur SANS recharger doit effacer le bandeau
  setPhase('3. changer de joueur sans recharger');
  // ⚠️ NAVIGATION CLIENT, par la barre du rail. Un `page.goto` remonterait tout et rendrait ce
  // check vert par construction — c'est précisément ce que le défaut exploitait.
  await search.fill(mate.pseudo);
  // ⚠️ FILTRÉ SUR LE TEXTE VISIBLE, pas sur le nom accessible. Le rail social est monté sur
  // TOUTES les pages authentifiées, et `mate` y figure comme ami : ses boutons d'action y
  // portent le pseudo dans leur `aria-label` tout en étant des icônes SANS texte. Un
  // `getByRole('button', { name: /pseudo/ })` en ramenait donc deux, et `.first()` cliquait
  // celui du rail — la page ne bougeait pas, sans la moindre erreur.
  const mateResult = page.getByRole('button').filter({ hasText: mate.pseudo });
  await mateResult.first().waitFor({ timeout: 10000 });
  await mateResult.first().click();
  await page.waitForURL(`**/players/${mate.pseudo}`, { timeout: 10000 });
  const mateTitled = await main
    .getByRole('heading', { level: 1, name: mate.pseudo })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const staleCallout = await sentCallout.count();
  // Le profil d'arrivée est un AMI : c'est la situation exacte du défaut vécu — un bandeau
  // « demande envoyée » au-dessus d'une pastille « Friends ».
  const friendPill = await main.getByText('Friends', { exact: true }).count();
  step(
    'P4',
    mateTitled && staleCallout === 0 && friendPill === 1,
    `titre passé au 2ᵉ joueur=${mateTitled}, bandeaux « Friend request sent to » restants : ${staleCallout} (0 attendu — la route N'EST PAS remontée d'un joueur à l'autre, tout l'état local survivait), pastille « Friends » : ${friendPill} (1 attendue — on arrive sur un AMI, c'est ce qui rendait le bandeau absurde)`,
  );

  // ------------------------------------- §4 « Block » doit s'armer sur la fiche d'un AMI
  setPhase('4. bloquer un ami');
  // 🚨 L'ONGLET DES BLOQUÉS EST OUVERT **AVANT** LE BLOCAGE, ET C'EST TOUTE LA VALEUR DE `P7`.
  // Première version de ce scénario : l'onglet n'était ouvert qu'APRÈS, donc la liste se
  // montait de zéro et se chargeait toute seule — le check restait VERT même en supprimant
  // l'invalidation du hook. Faux vert mesuré, dans la même famille que les cinq du rail. Ouvert
  // d'abord, la liste a un observateur monté : seule une invalidation peut la faire bouger.
  await page.getByRole('tab', { name: 'Add friend' }).click();
  const blockedList = page.getByRole('list', { name: 'Blocked players' });
  const blockedEmpty = page
    .getByRole('heading', { name: 'Blocked players' })
    .waitFor({ timeout: 15000 });
  await blockedEmpty;
  const alreadyThere = await blockedList
    .getByRole('listitem')
    .filter({ hasText: mate.pseudo })
    .count();

  const block = main.getByRole('button', { name: 'Block' });
  await block.waitFor({ timeout: 10000 });
  await block.click();
  // 🚨 LE CHECK EST L'OUVERTURE DE LA FENÊTRE, pas le blocage. Avant le correctif le bouton
  // était bien là, le clic partait, et RIEN ne se montait : la fenêtre était gardée sur le rôle
  // « inconnu ». Aucun message, aucune requête, rien à l'écran pour l'expliquer.
  const dialogOpened = await page
    .getByRole('heading', { name: 'Block this player?' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step(
    'P5',
    dialogOpened && alreadyThere === 0,
    `fenêtre de confirmation ouverte depuis la fiche d'un AMI=${dialogOpened} (la garde ne connaissait que le rôle « inconnu » : le bouton n'armait rien) ; déjà dans les bloqués avant l'action : ${alreadyThere} (0 attendu — c'est le témoin de P7)`,
  );

  // ------------------------------- §5 après le blocage, la page ne propose plus rien
  setPhase('5. après le blocage');
  const blockAnnounced = awaitAnnouncement('is now blocked');
  await page.getByRole('button', { name: 'Block player' }).click();
  const blockHeard = await blockAnnounced;
  const endScreen = await main
    .getByRole('heading', { name: 'Player blocked' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  // 🚨 LE NÉGATIF EST LE CHECK. La fiche restait affichée avec « Add friend » juste sous
  // « X est maintenant bloqué » — un bouton qui ne pouvait plus répondre que 404.
  const offersAdd = await main
    .getByRole('button', { name: /add friend|remove friend|block/i })
    .count();
  step(
    'P6',
    blockHeard && endScreen && offersAdd === 0,
    `annonce lue=${blockHeard}, écran de fin affiché=${endScreen}, actions de relation encore proposées : ${offersAdd} (0 attendue — le serveur rend 404 au bloqueur lui-même à partir d'ici, tout bouton restant mène à une ligne rouge)`,
  );

  // -------------------------- §6 le RAIL doit se mettre à jour SANS qu'on y touche
  setPhase('6. le rail se met à jour tout seul');
  // 🔑 C'est ce que la copie privée des mutations ne faisait pas : elle n'invalidait aucune
  // liste du rail. Tout paraissait juste à l'écran, seul le rail mentait — jusqu'au rechargement.
  // ⚠️ ON NE RECLIQUE PAS SUR L'ONGLET : il est resté ouvert depuis §4, donc la ligne ne peut
  // apparaître que parce que la mutation a invalidé la liste.
  const nowBlocked = await blockedList
    .getByRole('listitem')
    .filter({ hasText: mate.pseudo })
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  // Secondaire et volontairement plus faible : ouvrir l'onglet Amis le REFETCHE, donc ceci
  // prouve que le SERVEUR a supprimé l'amitié, pas que le front l'a rafraîchie.
  await page.getByRole('tab', { name: 'Friends' }).click();
  await page.waitForTimeout(1500);
  const stillFriend = await page.getByRole('listitem').filter({ hasText: mate.pseudo }).count();
  step(
    'P7',
    nowBlocked && stillFriend === 0,
    `apparu dans « Blocked players » SANS rouvrir l'onglet=${nowBlocked} (l'onglet est ouvert depuis §4 : seule une invalidation peut le faire bouger), encore listé dans l'onglet Amis après refetch : ${stillFriend} (0 attendu — bloquer SUPPRIME l'amitié côté serveur)`,
  );

  // ---------------------- §6b débloquer rend la fiche courante à nouveau lisible
  setPhase('6b. débloquer libère la fiche ouverte');
  await page.getByRole('tab', { name: 'Add friend' }).click();
  const unblock = blockedList.getByRole('button', { name: `Unblock @${mate.pseudo}` });
  await unblock.waitFor({ timeout: 10000 });
  await unblock.click();
  const profileRecovered = await main
    .getByRole('heading', { level: 1, name: mate.pseudo })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const canRequestAgain = await main
    .getByRole('button', { name: 'Add friend' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step(
    'P7U',
    profileRecovered && canRequestAgain,
    `fiche revenue après déblocage depuis le rail=${profileRecovered}, action « Add friend » disponible=${canRequestAgain} (sans navigation ni rechargement)`,
  );

  // ---------------- §6c bloquer DEPUIS LE RAIL ferme aussi une fiche déjà ouverte
  setPhase('6c. bloquer depuis le rail actualise la fiche ouverte');
  await page.goto(`${ORIGIN}/players/${railMate.pseudo}`, { waitUntil: 'networkidle' });
  await main.getByRole('heading', { level: 1, name: railMate.pseudo }).waitFor({ timeout: 10000 });
  await main.getByText('Friends', { exact: true }).waitFor({ timeout: 10000 });

  await page.getByRole('tab', { name: 'Friends' }).click();
  const railMateActions = page.getByRole('button', {
    name: `Actions for @${railMate.pseudo}`,
  });
  await railMateActions.waitFor({ timeout: 10000 });
  await railMateActions.click();
  await page.getByRole('menuitem', { name: 'Block player' }).click();
  const railBlockDialog = page.getByRole('dialog', { name: 'Block this player?' });
  await railBlockDialog.getByRole('button', { name: 'Block player' }).click();

  const railBlockClosedProfile = await main
    .getByRole('heading', { name: 'Player blocked' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const railBlockActionsLeft = await main
    .getByRole('button', { name: /add friend|remove friend|block/i })
    .count();

  await page.getByRole('tab', { name: 'Add friend' }).click();
  const railMateUnblock = blockedList.getByRole('button', {
    name: `Unblock @${railMate.pseudo}`,
  });
  await railMateUnblock.waitFor({ timeout: 10000 });
  await railMateUnblock.click();
  const railBlockRecovered = await main
    .getByRole('button', { name: 'Add friend' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  step(
    'P7R',
    railBlockClosedProfile && railBlockActionsLeft === 0 && railBlockRecovered,
    `blocage depuis le rail → écran « Player blocked »=${railBlockClosedProfile}, actions de relation restantes=${railBlockActionsLeft} (0 attendue), déblocage depuis le rail → fiche utilisable=${railBlockRecovered} (le tout sans rechargement)`,
  );

  // Remettre l'état bloqué pour conserver le contrôle de confidentialité P8 ci-dessous.
  await page.goto(`${ORIGIN}/players/${mate.pseudo}`, { waitUntil: 'networkidle' });
  await main.getByRole('button', { name: 'Block' }).click();
  await page.getByRole('button', { name: 'Block player' }).click();
  await main.getByRole('heading', { name: 'Player blocked' }).waitFor({ timeout: 10000 });

  // ------------------------------------------- §7 le profil bloqué n'est plus lisible
  setPhase('7. le profil bloqué rend 404');
  // ⚠️ Déclaré ici et pas plus haut : l'exemption ne vaut que dans SA phase. Le 404 est
  // l'objet même du test — le serveur répond « introuvable » au bloqueur AUSSI, et c'est
  // volontaire (on ne dit jamais à quelqu'un qu'il est bloqué).
  expectHttp(
    new RegExp(`/api/users/${mate.pseudo}`),
    'profil bloqué rechargé volontairement -> 404 (le serveur le cache au bloqueur aussi)',
  );
  await page.goto(`${ORIGIN}/players/${mate.pseudo}`, { waitUntil: 'networkidle' });
  const goneScreen = await main
    .getByRole('heading', { name: 'Profile not available' })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  // La copie ne doit JAMAIS nommer le blocage : 404 couvre aussi « ce pseudo n'existe pas »,
  // et c'est cette confusion qui protège celui qui a bloqué.
  const leaksBlocking = await main.getByText(/block/i).count();
  step(
    'P8',
    goneScreen && leaksBlocking === 0,
    `écran « profil indisponible » rendu=${goneScreen}, occurrences du mot « block » dans la copie : ${leaksBlocking} (0 attendue — le 404 couvre aussi un pseudo inexistant, et c'est cette confusion qui est le mécanisme de confidentialité)`,
  );

  // ---------------------------------------------------------------- §8 filet transverse
  setPhase('8. filet transverse');
  // Le 404 de §7 est l'objet du test : il est exclu ici comme il l'est du rapport console.
  // Tout le reste est imputable — une seule 4xx non voulue sur ce parcours est une ligne rouge.
  const unexpected = clientErrors.filter((e) => !e.includes(`/api/users/${mate.pseudo}`));
  step(
    'P9',
    unexpected.length === 0,
    `réponses 4xx hors le 404 déclaré du profil bloqué : ${unexpected.length} (0 attendue)${unexpected.length ? ` — ${unexpected.join(', ')}` : ''}`,
  );
}
