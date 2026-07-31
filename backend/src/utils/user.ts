import type { usersTable } from '../db/schema.js';

/** Une ligne brute de `users`, secrets compris. Ne quitte JAMAIS le backend telle quelle. */
export type UserRow = typeof usersTable.$inferSelect;

/**
 * Le user tel que le contrat OpenAPI le décrit (schéma `User`) : la ligne `users` privée de ses
 * deux secrets, augmentée du booléen dérivé `hasPassword`.
 */
export type AuthUser = Omit<UserRow, 'passwordHash' | 'totpSecret'> & { hasPassword: boolean };

/**
 * Seule fabrique autorisée du user authentifié renvoyé par l'API.
 *
 * ⚠️ Le retrait de `passwordHash`/`totpSecret` était recopié à la main sur 8 sites (7 routes —
 * `DELETE /users/me/avatar` en compte deux) : une seule
 * omission = fuite du hash de mot de passe. Tout ajout de colonne sensible à `users` se traite
 * désormais ICI, une fois.
 *
 * `hasPassword` répond à une question que `oauthProvider` NE répond PAS : le callback Google
 * (`routes/auth/google.ts`) rattache un provider à un compte existant retrouvé par email **sans
 * toucher à son `passwordHash`**. Un tel compte a donc `oauthProvider = 'google'` ET un mot de
 * passe local — c'est `hasPassword` qui dit si `PATCH /users/me/password` est utilisable.
 *
 * ⚠️ Ne pas l'employer pour le profil public (`GET /users/{pseudo}`) : `hasPassword` est une
 * information sur les moyens d'authentification d'autrui, il n'a rien à y faire.
 */
export function toAuthUser(user: UserRow): AuthUser {
  const { passwordHash, totpSecret: _totpSecret, ...safe } = user;
  return { ...safe, hasPassword: passwordHash !== null };
}
