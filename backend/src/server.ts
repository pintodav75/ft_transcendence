// ⚠️ DOIT rester le tout premier import : valide l'environnement (effet de bord) avant que
// db/index.ts ou storage/minio.ts ne lisent process.env à leur chargement. Échoue tôt et
// lisiblement (nom de la variable fautive, jamais sa valeur) si la config est invalide.
import './config/validate-env.js';
import fastify from 'fastify';
import { readFileSync } from 'node:fs';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { userRoutes } from './routes/users.js';
import { ensureBucket } from './storage/minio.js';
import multipart from '@fastify/multipart';
import oauth2 from '@fastify/oauth2';
import { authBasicRoutes } from './routes/auth/index.js';
import { googleRoutes } from './routes/auth/google.js';
import { twoFactorRoutes } from './routes/auth/2fa.js';
import { friendsRoutes } from './routes/friends.js';
import { messagesRoutes } from './routes/messages.js';
import { blocksRoutes } from './routes/blocks.js';
import { gamesRoutes } from './routes/games.js';
import websocket from '@fastify/websocket';
import { chatRoutes } from './routes/chat.js';
import { redisClient } from './storage/redis.js';
import fastifyCors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { rateLimitKey, rlMax, RATE_LIMIT_FACTOR } from './utils/rate-limit.js';
import { laddersRoutes } from './routes/ladders.js';
import { externalAccountsRoutes } from './routes/external-accounts.js';
import { teamsRoutes } from './routes/teams.js';
import { matchesRoutes } from './routes/matches.js';
import { disputesRoutes } from './routes/disputes.js';
import { notificationsRoutes } from './routes/notifications.js';
import { searchRoutes } from './routes/search.js';
import { startJobs } from './jobs/index.js';

const server = fastify({
  https: {
    key: readFileSync('certs/key.pem'),
    cert: readFileSync('certs/cert.pem'),
  },
});

await server.register(cookie);
await server.register(jwt, {
  secret: process.env.JWT_SECRET!,
});
await server.register(oauth2, {
  name: 'googleOAuth2',
  credentials: {
    client: { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET },
    auth: (oauth2 as any).GOOGLE_CONFIGURATION,
  },
  startRedirectPath: '/auth/oauth/google/start',
  callbackUri: process.env.GOOGLE_REDIRECT_URI,
  scope: ['profile', 'email'],
  // Cookie d'ÉTAT OAuth (anti-CSRF, posé au /start, relu au /callback). SameSite=Lax est
  // VOLONTAIRE : le retour de Google est une navigation top-level cross-site, un cookie
  // `Strict` ne serait PAS renvoyé au callback et l'échange échouerait. Path `/` pour qu'il
  // survive à la réécriture de chemin du proxy (le callback arrive sur /api/auth/...).
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  },
});

server.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
    // Seul un token d'ACCÈS ouvre les routes protégées. Un refresh (7 j), un tempToken 2FA
    // ou un token émis avant l'ajout du claim `type` n'ont pas `type: 'access'` → rejet.
    // La garde `pending` reste explicite (héritée de la review) : défense en profondeur.
    if ('pending' in request.user || request.user.type !== 'access')
      return reply.code(401).send({ error: 'Token cannot be used here' });
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

// Origine unique de l'app navigateur, lue depuis FRONTEND_URL (jamais de wildcard). En dev
// proxifié tout est same-origin (https://localhost:5173) ; CORS ne sert qu'à l'accès direct
// au backend (:3000) pour les tests. FRONTEND_URL est validé au démarrage (config/env.ts).
await server.register(fastifyCors, {
  origin: [process.env.FRONTEND_URL],
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  credentials: true,
});

// Quota global, pour toutes les routes qui ne declarent pas le leur. Attention : une route qui
// declare son propre quota n'est plus soumise a celui-ci, il le remplace au lieu de s'ajouter.
// Par contre elle herite des options qu'elle ne redefinit pas, dont le keyGenerator.
//
// On compte par utilisateur et pas par IP. Quatre coequipiers derriere la meme box partagent
// une seule adresse : a 100 requetes par minute pour tout le monde, une navigation un peu
// soutenue les epuise a eux quatre. Sur le sub du JWT chacun a les siennes, et changer d'IP
// ne sert plus a rien pour qui est connecte. Ce qui est anonyme reste compte par IP, donc
// register et login gardent leurs quotas serres.
//
// Ce qu'on paie : quelqu'un avec N comptes valides obtient N fois 100 requetes par minute.
// On l'accepte parce que l'inverse cassait l'app pour des gens legitimes.

await server.register(rateLimit, {
  max: rlMax(100),
  timeWindow: '1 minute',
  keyGenerator: rateLimitKey,
});

// console.warn et pas server.log.warn : le serveur est instancie sans logger, donc server.log
// n'ecrit nulle part. Or tout l'interet de cet avertissement est qu'on le voie au demarrage.
if (RATE_LIMIT_FACTOR !== 1) {
  console.warn(
    `⚠️  RATE_LIMIT_FACTOR=${RATE_LIMIT_FACTOR} — tous les quotas sont multipliés par ${RATE_LIMIT_FACTOR} ` +
      `(register ${rlMax(3)}/min, global ${rlMax(100)}/min). Confort de développement UNIQUEMENT : ` +
      `remettre RATE_LIMIT_FACTOR=1 dans .env avant toute livraison ou démonstration.`,
  );
}

await server.register(websocket);
await server.register(chatRoutes, { prefix: '/ws' });
await server.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 } });
await server.register(authBasicRoutes, { prefix: '/auth' });
await server.register(googleRoutes, { prefix: '/auth/oauth/google' });
await server.register(twoFactorRoutes, { prefix: '/auth/2fa' });
await server.register(userRoutes, { prefix: '/users' });
await server.register(friendsRoutes, { prefix: '/friends' });
await server.register(messagesRoutes, { prefix: '/messages' });
await server.register(blocksRoutes, { prefix: '/blocks' });
await server.register(gamesRoutes, { prefix: '/games' });
await server.register(laddersRoutes, { prefix: '/ladders' });
await server.register(externalAccountsRoutes, { prefix: '/users/me/external-accounts' });
await server.register(teamsRoutes, { prefix: '/teams' });
await server.register(matchesRoutes, { prefix: '/matches' });
await server.register(disputesRoutes, { prefix: '/disputes' });
await server.register(notificationsRoutes, { prefix: '/notifications' });
await server.register(searchRoutes, { prefix: '/search' });

server.get('/ping', async (request, reply) => {
  return 'pong-from-docker\n';
});

try {
  await redisClient.connect();
  const pong = await redisClient.ping();
  console.log('Redis ping:', pong);
  await ensureBucket();
  const address = await server.listen({ port: 3000, host: '0.0.0.0' });
  console.log(`Server listening at ${address}`);

  // Le planificateur : la seule partie du backend qui tourne sans requete HTTP. Il annule les
  // creneaux perimes et les matchs fantomes, confirme les scores restes sans reponse 24h et
  // clot les litiges qu'aucun admin n'a arbitres.
  startJobs((msg) => console.log(msg));
} catch (err) {
  console.error(err);
  process.exit(1);
}
