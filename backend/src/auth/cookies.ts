import type { FastifyReply } from 'fastify';

// Options CENTRALISÉES du refresh cookie (set ET clear). But : que register, login, 2FA,
// OAuth, logout et suppression de compte ne divergent JAMAIS sur les attributs du cookie.
//
// ⚠️ INVARIANT I4 — le path reste `/auth` CÔTÉ BACKEND. Le proxy Vite le réécrit en
// `/api/auth` pour le navigateur (`cookiePathRewrite` dans vite.config.ts). Modifier ce
// path ici sans toucher le proxy (ou l'inverse) casse SILENCIEUSEMENT la restauration de
// session : le navigateur ne renverrait plus le cookie sur `/api/auth/refresh`.
// Les tests/curl directs sur `https://localhost:3000/auth/*` continuent de fonctionner car
// pour eux le path `/auth` est déjà le bon (aucun proxy dans la boucle).
const REFRESH_COOKIE_NAME = 'refresh';
const REFRESH_COOKIE_PATH = '/auth';
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 jours

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_MAX_AGE_SECONDS,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}
