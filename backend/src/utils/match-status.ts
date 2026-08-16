import type { matchStatusEnum } from '../db/schema.js';

// Les deux familles de statuts qui occupent un joueur ou une equipe. Elles sont ici et pas dans
// matches.ts parce que la suppression de compte et la dissolution d'equipe doivent refuser
// exactement les memes matchs : trois copies auraient fini par diverger.
// Le type est derive de l'enum du schema, donc renommer un statut casse la compilation ici.
type MatchStatus = (typeof matchStatusEnum.enumValues)[number];

// Seuls les matchs actifs verrouillent, un match termine ou annule libere tout de suite.
export const LOCKING_STATUSES = [
  'in_progress',
  'awaiting_confirmation',
  'disputed',
] as const satisfies readonly MatchStatus[];

// Un creneau ouvert engage aussi, puisque n'importe qui peut l'accepter d'un instant a l'autre.
export const ENGAGING_STATUSES = [
  'pending',
  ...LOCKING_STATUSES,
] as const satisfies readonly MatchStatus[];
