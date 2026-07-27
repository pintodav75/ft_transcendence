export const K_FACTOR = 32;

// Décision produit : TOUS les matchs, tous jeux et tous ladders confondus, sont en
// best-of-3 — la manche gagnante est celle qui atteint ce nombre de victoires (2, donc
// un score de 2 ou 1 côté perdant). Constante nommée plutôt que dispersée en dur dans les
// gardes : un futur Bo5 par ladder devient un simple ajout de colonne, pas une chasse aux
// magic numbers.
export const WINS_REQUIRED = 2;

export function updateElo(
  eloA: number,
  eloB: number,
  winner: 'A' | 'B',
): { newEloA: number; newEloB: number } {
  const expectedA = 1 / (1 + 10 ** ((eloB - eloA) / 400));
  const resultA = winner === 'A' ? 1 : 0;
  const resultB = 1 - resultA;
  const expectedB = 1 - expectedA;
  const newEloA = Math.round(eloA + K_FACTOR * (resultA - expectedA));
  const newEloB = Math.round(eloB + K_FACTOR * (resultB - expectedB));
  return { newEloA, newEloB };
}
