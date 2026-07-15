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
import { laddersRoutes } from './routes/ladders.js';
import { externalAccountsRoutes } from './routes/external-accounts.js';
import { teamsRoutes } from './routes/teams.js';
import { matchesRoutes } from './routes/matches.js';
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
});

server.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
    if ('pending' in request.user)
      return reply.code(401).send({ error: 'Token cannot be used here' });
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

await server.register(fastifyCors, {
  origin: ['http://localhost:5173'],
  credentials: true,
});

await server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

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

  // Le planificateur : la seule partie du backend qui tourne sans requête HTTP.
  // Pour l'instant il n'annule que les slots périmés (B5d) ; B6 et B7 y ajouteront
  // la confirmation automatique des scores et le timeout des disputes.
  startJobs((msg) => console.log(msg));
} catch (err) {
  console.error(err);
  process.exit(1);
}
