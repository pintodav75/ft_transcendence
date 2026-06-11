import type { FastifyInstance } from 'fastify';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const TEMP_TTL = '5m';

type Payload = { sub: string };
type TempPayload = { sub: string; pending: 'totp' };

export const signAccessToken = (server: FastifyInstance, payload: Payload): string => {
  return server.jwt.sign(payload, { expiresIn: ACCESS_TTL });
};

export const signRefreshToken = (server: FastifyInstance, payload: Payload): string => {
  return server.jwt.sign(payload, { expiresIn: REFRESH_TTL });
};

export const signTempToken = (server: FastifyInstance, payload: TempPayload): string => {
  return server.jwt.sign(payload, { expiresIn: TEMP_TTL });
};
