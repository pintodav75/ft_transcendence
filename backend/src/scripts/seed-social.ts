/**
 * Seed SOCIAL (fixtures du rail droit) — complément de `seed-dev.ts`, jamais un remplacement.
 *
 * `seed-dev` peuple le domaine JEU (joueurs, équipes, matchs). Il ne crée aucune amitié,
 * aucun message, aucune notification : recetter le rail social imposait donc de fabriquer
 * ces états à la main à chaque fois. Ce script les pose en une commande, et il est bien plus
 * rapide que `seed-dev` puisqu'il n'écrit que 4 tables.
 *
 * Il est IDEMPOTENT et NE PURGE QUE SA PROPRE PRODUCTION : amitiés, blocages et messages
 * entre comptes de fixture, et les seules notifications qu'il a lui-même posées (marquées
 * par `seedSocial: true` dans leur payload). Il ne touche jamais aux matchs, aux équipes,
 * aux classements, ni aux comptes créés par l'audit ou par un membre de l'équipe.
 *
 * ⚠️ Il exige que `seed:dev` ait déjà tourné : il ne crée aucun compte, il relie ceux qui
 * existent. Les deux SEULS comptes connectables restent `alice` et `bob` (plus `carol`),
 * avec le mot de passe de fixture de `seed-dev` — ce script n'ouvre aucun nouveau secret.
 *
 * Usage : docker compose exec backend npm run seed:social
 */
import { db } from '../db/index.js';
import {
  usersTable,
  friendshipsTable,
  messagesTable,
  blocksTable,
  notificationsTable,
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

/** Marqueur de propriété : ne purger que les notifications posées par CE script. */
const OWNED = { seedSocial: true };

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

/**
 * Notifications de `alice`. On couvre plusieurs familles pour que la cloche ait de quoi
 * afficher, dont `team_member_added` — MORT depuis B-INV mais toujours présent en base :
 * le rendu doit le gérer, pas l'exclure.
 */
const NOTIFICATIONS: Array<{ type: string; data: Record<string, unknown>; read: boolean }> = [
  { type: 'friend_request_received', data: { fromPseudo: 'grace' }, read: false },
  { type: 'friend_request_received', data: { fromPseudo: 'heidi' }, read: false },
  { type: 'friend_request_accepted', data: { byPseudo: 'dave' }, read: false },
  { type: 'team_invitation_received', data: { teamName: 'Team Bravo', byPseudo: 'bob' }, read: false },
  { type: 'match_accepted', data: { teamName: 'Team Alpha' }, read: false },
  { type: 'result_submitted', data: { teamName: 'Team Bravo' }, read: true },
  { type: 'dispute_opened', data: { teamName: 'Team Bravo' }, read: true },
  { type: 'team_member_removed', data: { teamName: 'Team Charlie', byPseudo: 'carol' }, read: true },
  { type: 'team_member_added', data: { teamName: 'Team Charlie', byPseudo: 'carol' }, read: true },
  { type: 'team_disbanded', data: { teamName: 'Team Charlie', byPseudo: 'carol' }, read: true },
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
  // Les notifications, elles, ne se reconnaissent pas à leurs acteurs : `seed-dev` et l'app
  // en produisent aussi pour `alice`. On ne supprime QUE celles que ce script a marquées.
  await db
    .delete(notificationsTable)
    .where(
      and(
        inArray(notificationsTable.userId, everyone),
        sql`${notificationsTable.data} @> ${JSON.stringify(OWNED)}::jsonb`,
      ),
    );

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
  await db.insert(notificationsTable).values(
    NOTIFICATIONS.map((notification, index) => ({
      userId: me,
      type: notification.type as (typeof notificationsTable.$inferInsert)['type'],
      data: { ...notification.data, ...OWNED },
      readAt: notification.read ? new Date(now - (index + 1) * HOURS) : null,
      createdAt: new Date(now - (index + 1) * 40 * 60_000),
    })),
  );

  const unread = NOTIFICATIONS.filter((n) => !n.read).length;

  console.log(`\n👥 Rail social semé pour « ${ME} » :`);
  console.log(`   ${FRIENDS.length} amis            ${FRIENDS.join(', ')}`);
  console.log(`   ${INCOMING.length} demandes reçues  ${INCOMING.join(', ')}`);
  console.log(`   ${OUTGOING.length} demande envoyée  ${OUTGOING.join(', ')}`);
  console.log(`   ${BLOCKED.length} compte bloqué    ${BLOCKED.join(', ')}`);
  console.log(
    `   ${peerMessages.length + otherMessages.length} messages         ${CHAT_WITH_PEER.length} avec ${PEER}, le reste réparti sur les autres conversations`,
  );
  console.log(`   ${NOTIFICATIONS.length} notifications    dont ${unread} non lues`);

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
