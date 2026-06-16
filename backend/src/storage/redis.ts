import { createClient } from 'redis';

const HOSTNAME = process.env.REDIS_HOSTNAME;
const PORT = Number(process.env.REDIS_PORT);

export const redisClient = createClient({
  socket: {
    host: HOSTNAME,
    port: PORT,
  },
});

redisClient.on('error', (err) => {
  console.error('Redis error:', err);
});
