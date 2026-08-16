import type { FastifyReply } from 'fastify';

// Les options du cookie de refresh, au meme endroit pour la pose comme pour l'effacement.
// Register, login, 2FA, OAuth, logout et suppression de compte doivent utiliser exactement
// les memes attributs, sinon ils divergent sans qu'on s'en apercoive.
// Le chemin reste /auth cote backend, c'est le proxy Vite qui le reecrit en /api/auth pour le
// navigateur. Changer l'un sans l'autre casse la restauration de session en silence : le
// navigateur cesse simplement de renvoyer le cookie.
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
