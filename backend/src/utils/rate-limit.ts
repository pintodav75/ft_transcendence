import type { FastifyRequest } from 'fastify';

// Multiplie tous les quotas de l'API. Vaut 1 normalement, on ne le monte que pour enchainer
// des requetes sans attendre la fin de chaque fenetre. Ca ne desactive rien, on repond
// toujours 429, juste plus tard. Valeur bizarre = on retombe sur 1.
export const RATE_LIMIT_FACTOR = (() => {
  const raw = Number(process.env.RATE_LIMIT_FACTOR ?? '1');
  return Number.isInteger(raw) && raw >= 1 && raw <= 10_000 ? raw : 1;
})();

// Toute route qui met un quota doit passer par la, sinon le facteur ne s'applique pas a elle.
export const rlMax = (base: number): number => base * RATE_LIMIT_FACTOR;

// On compte par utilisateur si on sait qui c'est, par IP sinon. request.user est deja rempli
// ici parce que le hook du rate-limit passe apres celui de l'authentification.
export const rateLimitKey = (req: FastifyRequest): string => {
  const user = req.user as { sub?: string } | undefined;
  return user?.sub ? `u:${user.sub}` : `ip:${req.ip}`;
};

// Pour la verification 2FA on compte par compte, pas par IP : tout le trafic passe par le
// conteneur front donc tout le monde partage la meme adresse, et a l'inverse un attaquant qui
// change d'IP repartirait a zero a chaque fois. On verifie la signature du token, on ne se
// contente pas de le lire, sinon n'importe qui inventerait un sub et se donnerait un compteur
// neuf. Le handler revalide tout de toute facon.
export const twoFactorVerifyAccountKey = (req: FastifyRequest): string | null => {
  const body = req.body as { tempToken?: unknown } | undefined;
  if (typeof body?.tempToken === 'string') {
    try {
      const payload = req.server.jwt.verify<{ sub?: string; pending?: string }>(body.tempToken);
      if (payload.pending === 'totp' && payload.sub) return `u:${payload.sub}`;
    } catch {
      // Token invalide, on ne le refuse pas ici, le handler repondra 401.
    }
  }
  return null;
};

// Si on n'a pas pu sortir de cle de compte, on retombe sur l'IP plutot que sur une cle que
// tout le monde partagerait.
export const twoFactorVerifyRateLimitKey = (req: FastifyRequest): string =>
  twoFactorVerifyAccountKey(req) ?? `ip:${req.ip}`;
