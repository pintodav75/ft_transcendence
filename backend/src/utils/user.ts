import type { usersTable } from '../db/schema.js';

// Une ligne brute de users, secrets compris. Ne sort jamais du backend telle quelle.
export type UserRow = typeof usersTable.$inferSelect;

// Le user tel que le contrat OpenAPI le decrit : sans les deux secrets, avec hasPassword en plus.
export type AuthUser = Omit<UserRow, 'passwordHash' | 'totpSecret'> & { hasPassword: boolean };

// Seul endroit ou on fabrique le user renvoye par l'API. Avant, le retrait du hash et du secret
// TOTP etait recopie a la main dans 8 endroits, et un seul oubli suffisait a fuiter le mot de
// passe. Toute nouvelle colonne sensible se traite ici.
//
// hasPassword repond a une question a laquelle oauthProvider ne repond pas : quand on se
// connecte avec Google sur un compte qui existait deja, on rattache le provider sans toucher au
// mot de passe. Le compte a donc les deux, et c'est hasPassword qui dit si on peut proposer le
// changement de mot de passe. A ne pas utiliser pour le profil public, ca ne regarde personne.
export function toAuthUser(user: UserRow): AuthUser {
  const { passwordHash, totpSecret: _totpSecret, ...safe } = user;
  return { ...safe, hasPassword: passwordHash !== null };
}
