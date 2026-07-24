import '@fastify/jwt';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // Ce qu'on SIGNE : soit un token d'usage (access/refresh, claim `type` obligatoire),
    // soit le tempToken 2FA (claim `pending`). L'union force le claim `type` sur tout
    // nouveau token d'usage — on ne peut plus en signer un « anonyme » par oubli.
    payload: { sub: string; type: 'access' | 'refresh' } | { sub: string; pending: 'totp' };
    // Ce qu'on LIT après vérification : les claims sont optionnels côté lecture, car un
    // token peut venir d'une version antérieure (sans `type`) et doit alors être REJETÉ
    // par les gardes, pas faire échouer la compilation.
    user: { sub: string; type?: 'access' | 'refresh'; pending?: 'totp' };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (FastifyRequest, FastifyReply) => Promise<void>;
  }
}
