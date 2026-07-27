import { describe, it, expect } from 'vitest'
import { shapeRankings, type RankingRow } from '../../src/utils/leaderboard.js'

// Fabrique une ligne brute en ne précisant que ce qui compte pour le test.
function row(overrides: Partial<RankingRow>): RankingRow {
  return {
    elo: 1000,
    wins: 0,
    losses: 0,
    userId: null,
    teamId: null,
    userPseudo: null,
    userDisplayName: null,
    userAvatarUrl: null,
    teamName: null,
    teamLogoUrl: null,
    ...overrides,
  }
}

describe('shapeRankings', () => {
  it('renvoie [] quand il n y a aucune ligne', () => {
    expect(shapeRankings([])).toEqual([])
  })

  it('attribue le rang selon la position (1-based)', () => {
    const result = shapeRankings([
      row({ userId: 'u1', userPseudo: 'alice', elo: 1500 }),
      row({ userId: 'u2', userPseudo: 'bob', elo: 1200 }),
      row({ userId: 'u3', userPseudo: 'carol', elo: 900 }),
    ])
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('construit un competitor "user" quand userId est présent', () => {
    const [entry] = shapeRankings([
      row({ userId: 'u1', userPseudo: 'alice', userDisplayName: 'Alice', userAvatarUrl: 'a.png' }),
    ])
    expect(entry?.competitor).toEqual({
      type: 'user',
      id: 'u1',
      pseudo: 'alice',
      displayName: 'Alice',
      avatarUrl: 'a.png',
    })
  })

  it('construit un competitor "team" quand userId est null', () => {
    const [entry] = shapeRankings([
      row({ teamId: 't1', teamName: 'Team Alpha', teamLogoUrl: 'logo.png' }),
    ])
    expect(entry?.competitor).toEqual({ type: 'team', id: 't1', name: 'Team Alpha', logoUrl: 'logo.png' })
  })

  it('reporte elo / wins / losses sur chaque entrée', () => {
    const [entry] = shapeRankings([row({ userId: 'u1', elo: 1234, wins: 7, losses: 3 })])
    expect(entry).toMatchObject({ elo: 1234, wins: 7, losses: 3 })
  })
})
