import { describe, it, expect } from 'vitest'
import { updateElo } from '../../src/utils/elo.js'

describe('updateElo', () => {
  it('à niveau égal (1000 vs 1000), le gagnant prend 16 et le perdant perd 16', () => {
    const { newEloA, newEloB } = updateElo(1000, 1000, 'A')

    expect(newEloA).toBe(1016)
    expect(newEloB).toBe(984)
  })

  it('battre un adversaire plus faible ne rapporte que peu de points', () => {
    // A (1200) est le favori face à B (1000) : gain attendu faible (+8)
    const { newEloA } = updateElo(1200, 1000, 'A')

    expect(newEloA).toBe(1208)
  })

  it('battre un adversaire plus fort rapporte beaucoup de points', () => {
    // A (1000) est l'outsider face à B (1200) : gros gain (+24)
    const { newEloA } = updateElo(1000, 1200, 'A')

    expect(newEloA).toBe(1024)
  })

  it('conserve le total des ELO (somme des variations ≈ 0, à ±1 près via arrondis)', () => {
    const eloA = 1000
    const eloB = 1200
    const { newEloA, newEloB } = updateElo(eloA, eloB, 'A')

    const variation = newEloA - eloA + (newEloB - eloB)

    expect(Math.abs(variation)).toBeLessThanOrEqual(1)
  })
})