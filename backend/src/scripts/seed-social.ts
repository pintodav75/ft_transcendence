// Fixtures du rail social : amities, blocages, messages et notifications. C'est un
// complement de seed:dev, qui ne peuple que le jeu et ne cree aucun de ces etats.
// Il ne nettoie que ce qu'il a lui-meme produit et ne touche jamais aux matchs, aux equipes
// ni aux classements. Il ne cree aucun compte non plus, il relie ceux qui existent, donc il
// exige que seed:dev ait deja tourne.
//
// Usage : docker compose exec backend npm run seed:social
import { db } from '../db/index.js';
import {
  usersTable,
  friendshipsTable,
  messagesTable,
  blocksTable,
  notificationsTable,
  matchesTable,
  disputesTable,
  teamsTable,
} from '../db/schema.js';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** Le compte depuis lequel on recette : c'est LUI qui doit avoir tous les états à l'écran. */
const ME = 'alice';
/** Le second compte connectable : à ouvrir dans une 2ᵉ fenêtre pour la présence et le chat. */
const PEER = 'bob';

/** Amitiés acceptées de `alice`. `bob` et `carol` sont connectables, les autres non. */
const FRIENDS = ['bob', 'carol', 'dave', 'erin'];
/** Demandes REÇUES par `alice`, à accepter ou refuser depuis l'onglet Ajouter. */
const INCOMING = ['grace', 'heidi'];
/** Demandes ENVOYÉES par `alice`, à annuler depuis l'onglet Ajouter. */
const OUTGOING = ['ivan'];
/** Comptes bloqués par `alice`, à débloquer depuis l'onglet Ajouter. */
const BLOCKED = ['karl'];

/**
 * Préfixe d'id déterministe : c'est LUI qui dit « cette notification vient de ce script ».
 *
 * 🚨 Surtout PAS un marqueur dans `data` : les payloads de notifications sont validés en
 * `strictObject` côté serveur ET côté front, une clé en trop les fait rejeter — on livrerait
 * une fixture que l'application refuse d'afficher. Même convention que les matchs de démo
 * `ffff1xxx` de `seed-dev`.
 */
const NOTIF_ID_PREFIX = 'dddd0000-0000-4000-8000-';
const notifId = (n: number) => `${NOTIF_ID_PREFIX}${String(n).padStart(12, '0')}`;

const HOURS = 3_600_000;

/**
 * Conversation `alice` ↔ `bob`, la plus fournie : elle sert à voir l'ordre stable, le
 * regroupement et le défilement. `from` est le pseudo de l'expéditeur.
 */
const CHAT_WITH_PEER: Array<{ from: string; content: string }> = [
  { from: PEER, content: 'yo, dispo pour le match de ce soir ?' },
  { from: ME, content: 'ouais je suis là' },
  { from: PEER, content: 'on part sur quelle map en premier ?' },
  { from: ME, content: 'Mirage, comme la dernière fois' },
  { from: PEER, content: 'ok ça marche' },
  { from: ME, content: "j'ai prévenu le reste de la team" },
  { from: PEER, content: 'nickel. il manque personne ?' },
  { from: ME, content: 'non, on est cinq' },
  { from: PEER, content: 'parfait' },
  { from: ME, content: 'tu veux échauffer avant ?' },
  { from: PEER, content: 'ouais 20 min avant si tu peux' },
  { from: ME, content: 'ça marche, je serai là' },
  { from: PEER, content: 'au fait ton Elo a bien monté' },
  { from: ME, content: 'la série de la semaine dernière a aidé' },
  { from: PEER, content: 'clairement' },
  { from: ME, content: 'bon, à ce soir' },
  { from: PEER, content: 'à ce soir 👋' },
];

const CHAT_WITH_OTHERS: Array<{ friend: string; from: string; content: string }> = [
  { friend: 'carol', from: 'carol', content: 'salut, tu joues encore aux échecs ?' },
  { friend: 'carol', from: ME, content: 'de temps en temps ouais' },
  { friend: 'carol', from: 'carol', content: 'on se fait une partie cette semaine ?' },
  { friend: 'dave', from: 'dave', content: 'gg pour hier' },
];

async function main() {
  const pseudos = [
    ME,
    ...FRIENDS,
    ...INCOMING,
    ...OUTGOING,
    ...BLOCKED,
    ...CHAT_WITH_OTHERS.map((m) => m.friend),
  ];
  const rows = await db
    .select({ id: usersTable.id, pseudo: usersTable.pseudo })
    .from(usersTable)
    .where(inArray(usersTable.pseudo, [...new Set(pseudos)]));

  const idOf = new Map(rows.map((r) => [r.pseudo, r.id]));
  const missing = [...new Set(pseudos)].filter((p) => !idOf.has(p));
  if (missing.length) {
    // Ce script relie des comptes, il n'en crée aucun : sans `seed:dev`, il n'a rien à relier.
    console.error(
      `❌ comptes de fixture absents : ${missing.join(', ')}\n` +
        '   -> lancer d’abord : docker compose exec backend npm run seed:dev',
    );
    process.exit(1);
  }

  const me = idOf.get(ME)!;
  const everyone = [...idOf.values()];

  // ---------------------------------------------------------------- purge de sa production
  // Bornée aux comptes de fixture dans les DEUX sens : une amitié ou un message impliquant
  // un compte réel (audit, coéquipier) n'est jamais touché.
  await db
    .delete(friendshipsTable)
    .where(
      and(
        inArray(friendshipsTable.requesterId, everyone),
        inArray(friendshipsTable.addresseeId, everyone),
      ),
    );
  await db
    .delete(messagesTable)
    .where(
      and(inArray(messagesTable.senderId, everyone), inArray(messagesTable.receiverId, everyone)),
    );
  await db
    .delete(blocksTable)
    .where(
      and(inArray(blocksTable.blockerId, everyone), inArray(blocksTable.blockedId, everyone)),
    );
  // Les notifications ne se reconnaissent pas à leurs acteurs : `seed-dev` et l'application
  // en produisent aussi pour `alice`. On ne supprime que celles dont l'id porte notre préfixe.
  await db
    .delete(notificationsTable)
    .where(sql`${notificationsTable.id}::text LIKE ${NOTIF_ID_PREFIX + '%'}`);
  // Nettoyage de la PREMIÈRE version de ce script, qui marquait ses notifications par une clé
  // `seedSocial` dans le payload. C'était une mauvaise idée — les payloads sont validés en
  // `strictObject`, une clé en trop les fait rejeter — et les lignes ainsi posées ne portent
  // pas le préfixe d'id, donc la purge ci-dessus ne les voit pas. À retirer quand plus aucune
  // base de dev de l'équipe n'en contient.
  await db
    .delete(notificationsTable)
    .where(sql`${notificationsTable.data} @> '{"seedSocial": true}'::jsonb`);

  // ---------------------------------------------------------------- amitiés et blocages
  const now = Date.now();

  await db.insert(friendshipsTable).values([
    ...FRIENDS.map((pseudo, index) => ({
      requesterId: me,
      addresseeId: idOf.get(pseudo)!,
      status: 'accepted' as const,
      createdAt: new Date(now - (FRIENDS.length - index + 10) * 24 * HOURS),
    })),
    // Reçues : c'est l'AUTRE qui est demandeur, sinon elles s'afficheraient côté « envoyées ».
    ...INCOMING.map((pseudo, index) => ({
      requesterId: idOf.get(pseudo)!,
      addresseeId: me,
      status: 'pending' as const,
      createdAt: new Date(now - (index + 1) * 2 * HOURS),
    })),
    ...OUTGOING.map((pseudo, index) => ({
      requesterId: me,
      addresseeId: idOf.get(pseudo)!,
      status: 'pending' as const,
      createdAt: new Date(now - (index + 1) * 5 * HOURS),
    })),
  ]);

  await db.insert(blocksTable).values(
    BLOCKED.map((pseudo) => ({
      blockerId: me,
      blockedId: idOf.get(pseudo)!,
    })),
  );

  // ---------------------------------------------------------------- messages
  // Horodatages ESPACÉS et croissants : l'ordre doit être lisible à l'œil, et la liste des
  // conversations se trie sur le dernier message — deux messages à la même seconde
  // rendraient ce tri non reproductible d'un seed à l'autre.
  const peer = idOf.get(PEER)!;
  const peerMessages = CHAT_WITH_PEER.map((message, index) => {
    const senderIsMe = message.from === ME;
    return {
      senderId: senderIsMe ? me : peer,
      receiverId: senderIsMe ? peer : me,
      content: message.content,
      createdAt: new Date(now - (CHAT_WITH_PEER.length - index) * 7 * 60_000),
    };
  });

  const otherMessages = CHAT_WITH_OTHERS.map((message, index) => {
    const friend = idOf.get(message.friend)!;
    const senderIsMe = message.from === ME;
    return {
      senderId: senderIsMe ? me : friend,
      receiverId: senderIsMe ? friend : me,
      content: message.content,
      createdAt: new Date(now - (CHAT_WITH_OTHERS.length - index + 2) * 3 * HOURS),
    };
  });

  await db.insert(messagesTable).values([...peerMessages, ...otherMessages]);

  // ---------------------------------------------------------------- notifications
  // 🚨 CHAQUE NOTIFICATION POINTE VERS UNE CIBLE QUI EXISTE VRAIMENT.
  // La cloche mène à l'écran concerné : semer un `matchId` inventé produirait un 404 au clic,
  // donc une ligne rouge dans la console — motif de rejet du projet. On construit donc les
  // payloads à partir des VRAIES lignes posées par `seed:dev` et par ce script, et on saute
  // simplement les familles dont la cible manque.
  const pendingIn = await db
    .select({
      id: friendshipsTable.id,
      requesterId: friendshipsTable.requesterId,
    })
    .from(friendshipsTable)
    .where(and(eq(friendshipsTable.addresseeId, me), eq(friendshipsTable.status, 'pending')));

  const [acceptedWithDave] = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(
      and(eq(friendshipsTable.requesterId, me), eq(friendshipsTable.addresseeId, idOf.get('dave')!)),
    );

  // Les matchs de démo de `seed:dev` : on prend un état par famille de notification.
  const demoMatches = await db
    .select({
      id: matchesTable.id,
      ladderId: matchesTable.ladderId,
      status: matchesTable.status,
      scheduledAt: matchesTable.scheduledAt,
    })
    .from(matchesTable)
    .where(inArray(matchesTable.status, ['in_progress', 'awaiting_confirmation', 'disputed']));

  const matchOf = (status: string) => demoMatches.find((m) => m.status === status);
  const [demoDispute] = await db
    .select({ id: disputesTable.id, matchId: disputesTable.matchId })
    .from(disputesTable)
    .limit(1);

  const [charlie] = await db
    .select({ id: teamsTable.id, name: teamsTable.name, ladderId: teamsTable.ladderId })
    .from(teamsTable)
    .where(eq(teamsTable.name, 'Team Charlie'));

  type SeedNotification = {
    type: (typeof notificationsTable.$inferInsert)['type'];
    data: Record<string, unknown>;
    read: boolean;
  };
  const notifications: SeedNotification[] = [];

  for (const request of pendingIn) {
    const fromPseudo = [...idOf.entries()].find(([, id]) => id === request.requesterId)?.[0];
    if (!fromPseudo) continue;
    notifications.push({
      type: 'friend_request_received',
      data: { friendshipId: request.id, fromUserId: request.requesterId, fromPseudo },
      read: false,
    });
  }

  if (acceptedWithDave) {
    notifications.push({
      type: 'friend_request_accepted',
      data: {
        friendshipId: acceptedWithDave.id,
        byUserId: idOf.get('dave')!,
        byPseudo: 'dave',
      },
      read: false,
    });
  }

  // Un match ACCEPTÉ dont le coup d'envoi est passé porte le statut `in_progress` : c'est la
  // cible juste pour « quelqu'un a accepté ton créneau ». Il n'existe pas de statut `accepted`.
  const accepted = matchOf('in_progress');
  if (accepted?.scheduledAt) {
    notifications.push({
      type: 'match_accepted',
      data: {
        matchId: accepted.id,
        ladderId: accepted.ladderId,
        scheduledAt: accepted.scheduledAt.toISOString(),
      },
      read: false,
    });
  }

  const awaiting = matchOf('awaiting_confirmation');
  if (awaiting) {
    notifications.push({
      type: 'result_submitted',
      data: { matchId: awaiting.id, ladderId: awaiting.ladderId },
      read: false,
    });
  }

  const disputed = matchOf('disputed');
  if (disputed && demoDispute && demoDispute.matchId === disputed.id) {
    notifications.push({
      type: 'dispute_opened',
      data: { matchId: disputed.id, ladderId: disputed.ladderId, disputeId: demoDispute.id },
      read: true,
    });
  }

  if (charlie) {
    // ⚠️ `team_member_added` est MORT depuis B-INV — plus personne ne l'émet, mais la valeur
    // reste en base et d'anciennes notifications y font référence. On en sème une EXPRÈS :
    // le rendu doit la gérer, pas l'exclure.
    for (const type of ['team_member_added', 'team_member_removed'] as const) {
      notifications.push({
        type,
        data: {
          teamId: charlie.id,
          teamName: charlie.name,
          ladderId: charlie.ladderId,
          byUserId: idOf.get('carol')!,
          byPseudo: 'carol',
        },
        read: true,
      });
    }
  }

  await db.insert(notificationsTable).values(
    notifications.map((notification, index) => ({
      // Id déterministe : c'est ce qui rend la purge de ce script exacte et sans marqueur
      // dans le payload (voir `NOTIF_ID_PREFIX`).
      id: notifId(index + 1),
      userId: me,
      type: notification.type,
      data: notification.data,
      readAt: notification.read ? new Date(now - (index + 1) * HOURS) : null,
      createdAt: new Date(now - (index + 1) * 40 * 60_000),
    })),
  );

  const unread = notifications.filter((n) => !n.read).length;
  const skipped =
    charlie && demoMatches.length
      ? ''
      : '  ⚠️ cibles de match/équipe absentes — relancer `seed:dev` pour les avoir';

  console.log(`\n👥 Rail social semé pour « ${ME} » :`);
  console.log(`   ${FRIENDS.length} amis            ${FRIENDS.join(', ')}`);
  console.log(`   ${INCOMING.length} demandes reçues  ${INCOMING.join(', ')}`);
  console.log(`   ${OUTGOING.length} demande envoyée  ${OUTGOING.join(', ')}`);
  console.log(`   ${BLOCKED.length} compte bloqué    ${BLOCKED.join(', ')}`);
  console.log(
    `   ${peerMessages.length + otherMessages.length} messages         ${CHAT_WITH_PEER.length} avec ${PEER}, le reste réparti sur les autres conversations`,
  );
  console.log(
    `   ${notifications.length} notifications     dont ${unread} non lues — toutes pointées sur de VRAIES cibles${skipped}`,
  );

  console.log('\n🔑 Recette à deux fenêtres (mot de passe : Test1234!) :');
  console.log(`   alice@dev.local   le compte à regarder — c'est lui qui porte tous les états`);
  console.log(`   bob@dev.local     l'ami à connecter/déconnecter pour voir la présence bouger`);
  console.log(
    '   carol@dev.local   3ᵉ compte connectable, ami d’alice lui aussi (2ᵉ conversation)\n',
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
