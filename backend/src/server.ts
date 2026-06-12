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

await server.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 } });
await server.register(authBasicRoutes, { prefix: '/auth' });
await server.register(googleRoutes, { prefix: '/auth/oauth/google' });
await server.register(twoFactorRoutes, { prefix: '/auth/2fa' });
await server.register(userRoutes, { prefix: '/users' });

server.get('/ping', async (request, reply) => {
  return 'pong-from-docker\n';
});

try {
  await ensureBucket();
  const address = await server.listen({ port: 3000, host: '0.0.0.0' });
  console.log(`Server listening at ${address}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
