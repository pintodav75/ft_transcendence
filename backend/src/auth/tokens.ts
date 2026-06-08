import type { FastifyInstance } from 'fastify'

const ACCESS_TTL = '15m'
const REFRESH_TTL = '7d'

type Payload = { sub: string }

export const signAccessToken = (server: FastifyInstance, payload: Payload): string => {
  return server.jwt.sign(payload, { expiresIn: ACCESS_TTL })
}

export const signRefreshToken = (server: FastifyInstance, payload: Payload): string => {
  return server.jwt.sign(payload, { expiresIn: REFRESH_TTL })
}
