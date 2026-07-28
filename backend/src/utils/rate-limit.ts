import type { FastifyRequest } from 'fastify';

/**
 * Multiplicateur appliqué à TOUS les quotas de l'API (`rlMax`). Vaut 1 en marche normale.
 *
 * POURQUOI : nos quotas sont calibrés pour un humain (register 3/min, global 100/min), pas
 * pour un harnais. L'audit console rejoue 9 parcours en rafale et les tests e2e Python
 * tapent des centaines de requêtes en quelques secondes : les deux passent l'essentiel de
 * leur temps à ATTENDRE la reconstitution d'une fenêtre, pas à tester. Mesuré : une campagne
 * d'audit complète est dominée par ces attentes, ce qui rend le cycle d'un ticket front
 * inutilisable. Un facteur global déplace le plafond sans toucher UNE SEULE règle métier :
 * le code des routes, l'ordre des hooks, les clés de comptage et le montage à deux étages de
 * `/2fa/verify` sont rigoureusement identiques — seul le nombre change.
 *
 * ⚠️ CE N'EST PAS UN INTERRUPTEUR « OFF ». On ne désactive pas le plugin, on ne saute pas le
 * hook : à facteur 1000, `/auth/register` répond toujours 429 au 3001ᵉ appel de la minute, et
 * la mécanique reste donc DÉMONTRABLE en soutenance (baisser la variable à 1 et rejouer).
 * Désactiver le plugin, à l'inverse, aurait fait diverger le code testé du code livré.
 *
 * ⚠️ DOIT VALOIR 1 À LA LIVRAISON. `.env.example` est à 1, docker-compose retombe sur 1 si la
 * variable est absente, et le backend écrit une bannière d'avertissement à CHAQUE démarrage
 * tant qu'elle ne vaut pas 1 (voir `server.ts`) — c'est le rappel qui empêche d'oublier.
 */
export const RATE_LIMIT_FACTOR = (() => {
  const raw = Number(process.env.RATE_LIMIT_FACTOR ?? '1');
  // Repli défensif sur 1 : une valeur absurde doit DURCIR, jamais relâcher silencieusement.
  // (Le cas ne se produit pas en pratique — `config/env.ts` refuse le démarrage avant.)
  return Number.isInteger(raw) && raw >= 1 && raw <= 10_000 ? raw : 1;
})();

/**
 * Le plafond réellement passé à `@fastify/rate-limit`. Toute route qui déclare un quota DOIT
 * passer par ici : un `max:` littéral oublié quelque part rend le harnais bloquant sur cette
 * seule route, et le symptôme (une attente de 60 s au milieu d'un scénario) est pénible à
 * relier à sa cause.
 */
export const rlMax = (base: number): number => base * RATE_LIMIT_FACTOR;

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

/**
 * Clé du compteur de `POST /auth/2fa/verify` : le COMPTE VISÉ par le tempToken, l'IP en repli.
 *
 * POURQUOI une clé dédiée : cette route est la seule à identifier son utilisateur SANS passer
 * par `server.authenticate` — un tempToken n'est pas encore une session, elle le vérifie
 * elle-même dans son handler. `rateLimitKey` ne voit donc rien dans `request.user` et retombe
 * sur l'IP : les 5 essais/min bornent une ADRESSE, pas le compte attaqué. Or deviner 6 chiffres
 * demande ~230 000 essais pour une chance sur deux — un mois depuis une IP, 1 h 30 depuis un
 * pool de 500. Indexé sur le compte, le budget d'essais est le même quel que soit le nombre
 * d'adresses employées, ce qui est exactement le rôle de la 2FA : tenir quand le mot de passe
 * est tombé.
 *
 * ⚠️ Ce générateur ne peut pas tourner dans un hook `onRequest` — le corps n'y est pas encore
 * décodé, `request.body` est vide et la clé retomberait TOUJOURS sur l'IP. Il est donc branché
 * sur un compteur appelé à la main DANS le handler (`server.createRateLimit`), pendant que la
 * route garde par ailleurs un plancher par IP en `onRequest`. Le détail du montage, et les
 * deux pièges qu'il évite, sont commentés dans `routes/auth/2fa.ts`.
 *
 * La signature EST vérifiée ici, mais uniquement pour CHOISIR un compteur — le handler refait
 * sa propre vérification, il ne fait aucune confiance à ce qui est décodé ici. Vérifier plutôt
 * que décoder n'est pas cosmétique : avec un simple décodage, n'importe qui fabriquerait des
 * `sub` bidon à volonté et s'offrirait un compteur neuf à chaque requête, donc plus aucune
 * limite du tout sur la route.
 *
 * Repli sur l'IP si le tempToken est absent, illisible, expiré, ou n'est pas un token `totp`
 * (un access token égaré ne doit pas consommer le quota d'une étape de connexion) — jamais sur
 * une clé « inconnu » qui serait partagée par tous les appelants sans token valide.
 *
 * ⚠️ Ce repli est une CEINTURE, pas le chemin nominal : la route n'appelle le compteur par
 * compte que si `twoFactorVerifyAccountKey` a rendu une clé (voir `2fa.ts`), justement pour
 * que ces requêtes-là ne tombent PAS dans un bucket à 5/min. Pourquoi : le backend n'est pas
 * en `trustProxy`, donc `req.ip` est l'IP de socket — tout le trafic navigateur arrive par le
 * conteneur front et partage UNE adresse. Un bucket IP à 5/min sur cette route est donc
 * commun à toute la plateforme, et 5 tempTokens périmés dans la minute (cas légitime : on
 * laisse l'écran 2FA ouvert plus de 5 min) suffiraient à répondre « trop de tentatives » au
 * 6ᵉ utilisateur, qui ré-essaierait au lieu de se reconnecter. Ces requêtes sont déjà bornées
 * par le plancher à 30/min de la route.
 *
 * CE QU'ON PAIE, et c'est assumé : compter par compte rend possible un **lockout ciblé**. Un
 * attaquant qui a le mot de passe peut maintenir la victime à 429 en permanence (5 requêtes/min
 * suffisent) sans jamais deviner le code — avant, il épuisait le quota de SON adresse et la
 * victime se connectait tranquillement depuis la sienne. C'est le compromis standard de la 2FA
 * et le bon sens du choix : un déni de service temporaire vaut mieux qu'un contournement
 * définitif. À noter, le compteur incrémente aussi sur le SUCCÈS — un bon code ne le remet
 * pas à zéro.
 */
export const twoFactorVerifyAccountKey = (req: FastifyRequest): string | null => {
  const body = req.body as { tempToken?: unknown } | undefined;
  if (typeof body?.tempToken === 'string') {
    try {
      const payload = req.server.jwt.verify<{ sub?: string; pending?: string }>(body.tempToken);
      if (payload.pending === 'totp' && payload.sub) return `u:${payload.sub}`;
    } catch {
      // Token illisible ou expiré : ce n'est pas à ce générateur de le refuser, seulement de
      // ne pas s'en servir comme clé. Le handler répondra 401.
    }
  }
  return null;
};

/**
 * Le `keyGenerator` réellement passé au compteur : la clé de compte, l'IP en dernier recours.
 *
 * Cette ceinture ne sert que si la garde de `2fa.ts` et ce générateur divergeaient un jour —
 * compter sur l'IP reste alors infiniment préférable à une clé partagée par tout le monde.
 * En marche nominale, la route ne l'appelle que lorsque `twoFactorVerifyAccountKey` a déjà
 * rendu une clé, donc le repli ne s'exerce pas.
 */
export const twoFactorVerifyRateLimitKey = (req: FastifyRequest): string =>
  twoFactorVerifyAccountKey(req) ?? `ip:${req.ip}`;
