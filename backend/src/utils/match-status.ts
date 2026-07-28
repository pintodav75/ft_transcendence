import type { matchStatusEnum } from '../db/schema.js';

/**
 * Les deux familles de statuts de match qui « occupent » quelqu'un.
 *
 * Extraites de `routes/matches.ts` quand `routes/users.ts` et `routes/teams.ts` en ont eu
 * besoin à leur tour (BX-DEL) : la suppression d'un compte et la dissolution d'une équipe
 * doivent refuser exactement les mêmes matchs que ceux qui bloquent un créneau. Les
 * dupliquer aurait garanti qu'un jour les trois listes divergent — et le jour où un statut
 * s'ajoute, c'est une garde qu'on oublierait, silencieusement.
 *
 * 🔑 Le type des membres est DÉRIVÉ de `matchStatusEnum` : renommer ou retirer un statut
 * dans le schéma casse la compilation ici, au lieu de laisser une garde comparer à une
 * valeur qui n'existe plus. (L'exhaustivité, elle, reste un choix humain : ces listes sont
 * des sous-ensembles voulus, pas tous les statuts.)
 */
type MatchStatus = (typeof matchStatusEnum.enumValues)[number];

// §5.2 — seuls les matchs ACTIFS verrouillent : un match terminé ou annulé libère aussitôt.
export const LOCKING_STATUSES = [
  'in_progress',
  'awaiting_confirmation',
  'disputed',
] as const satisfies readonly MatchStatus[];

// Un camp est ENGAGÉ par un slot ouvert (il peut être accepté à tout moment) comme par
// un match actif. Un match `completed` ou `cancelled` n'engage plus personne.
export const ENGAGING_STATUSES = [
  'pending',
  ...LOCKING_STATUSES,
] as const satisfies readonly MatchStatus[];
