import type { FastifyRequest } from 'fastify';

/**
 * Clé du compteur de rate-limit : l'UTILISATEUR quand la requête est authentifiée, l'IP sinon.
 *
 * Sûr parce que `@fastify/rate-limit` AJOUTE son hook à la FIN du tableau `onRequest` de la
 * route (`routeOptions[hook].push(...)`) : sur une route protégée, `server.authenticate` a
 * déjà tourné quand ce générateur est appelé. `request.user` est donc peuplé ET VÉRIFIÉ
 * (signature + claim `type: 'access'`), et un anonyme est sorti en 401 avant d'arriver ici.
 *
 * Sur une route ANONYME, rien ne peuple `request.user` : le repli sur l'IP s'applique, et les
 * quotas stricts de `/auth/register` (3/min) et `/auth/login` (5/min) restent bien par IP —
 * c'est leur rôle, borner un attaquant NON authentifié.
 *
 * Préfixes `u:` / `ip:` : sans eux, un uuid et une adresse partagent le même espace de clés.
 */
export const rateLimitKey = (req: FastifyRequest): string => {
  const user = req.user as { sub?: string } | undefined;
  return user?.sub ? `u:${user.sub}` : `ip:${req.ip}`;
};
