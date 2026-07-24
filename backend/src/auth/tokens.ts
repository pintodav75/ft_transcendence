import type { FastifyInstance } from 'fastify';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const TEMP_TTL = '5m';

type Payload = { sub: string };
type TempPayload = { sub: string; pending: 'totp' };

// Le claim `type` est posé ICI, dans la fonction de signature, et jamais par l'appelant :
// impossible d'oublier de le mettre sur un futur call site. Sans lui, les trois tokens
// partagent secret et payload `{ sub }` — un refresh 7 j était donc un access token
// parfaitement valide (Bearer) avec 672× la durée de vie prévue.
export const signAccessToken = (server: FastifyInstance, payload: Payload): string => {
  return server.jwt.sign({ ...payload, type: 'access' }, { expiresIn: ACCESS_TTL });
};

export const signRefreshToken = (server: FastifyInstance, payload: Payload): string => {
  return server.jwt.sign({ ...payload, type: 'refresh' }, { expiresIn: REFRESH_TTL });
};

export const signTempToken = (server: FastifyInstance, payload: TempPayload): string => {
  return server.jwt.sign(payload, { expiresIn: TEMP_TTL });
};
