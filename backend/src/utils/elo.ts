export const K_FACTOR = 32;

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
