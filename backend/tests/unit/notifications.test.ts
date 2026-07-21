import { describe, it, expect } from 'vitest'
import { notificationPayloadSchemas } from '../../src/utils/notification-schemas.js'

// Review B9 #2 — la garantie "data display-safe" doit être vérifiée À L'ÉCRITURE, pas
// seulement documentée en commentaire. Ces tests couvrent le schéma qui la fait respecter :
// un payload correct passe, un payload incomplet, mal typé ou avec un champ EN TROP (le
// scénario qui aurait laissé passer un email/hash par erreur) doit être rejeté.

// De vrais UUID v4 (nibble de version '4', nibble de variant '8'-'b') : le validateur
// Zod v4 vérifie ces bits, pas juste la forme "32 hex chars avec des tirets".
const uuid1 = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d'
const uuid2 = 'b2c3d4e5-f6a7-4b2c-9d3e-4f5a6b7c8d9e'

describe('notificationPayloadSchemas — display-safe garanti à l\'écriture', () => {
  it('un payload result_submitted valide passe', () => {
    const parsed = notificationPayloadSchemas.result_submitted.parse({
      matchId: uuid1,
      ladderId: uuid2,
    })
    expect(parsed).toEqual({ matchId: uuid1, ladderId: uuid2 })
  })

  it('un champ manquant est rejeté', () => {
    expect(() => notificationPayloadSchemas.result_confirmed.parse({ matchId: uuid1 })).toThrow()
  })

  it('un champ EN TROP est rejeté (ex. un email glissé par erreur)', () => {
    expect(() =>
      notificationPayloadSchemas.result_submitted.parse({
        matchId: uuid1,
        ladderId: uuid2,
        email: 'leak@example.com',
      }),
    ).toThrow()
  })

  it('un id mal formé (pas un uuid) est rejeté', () => {
    expect(() =>
      notificationPayloadSchemas.match_ghost_cancelled.parse({
        matchId: 'not-a-uuid',
        ladderId: uuid2,
      }),
    ).toThrow()
  })

  it('dispute_resolved exige une resolution dans l\'enum', () => {
    expect(() =>
      notificationPayloadSchemas.dispute_resolved.parse({
        matchId: uuid1,
        ladderId: uuid2,
        disputeId: uuid1,
        resolution: 'side_2_wins', // hors enum
      }),
    ).toThrow()

    const parsed = notificationPayloadSchemas.dispute_resolved.parse({
      matchId: uuid1,
      ladderId: uuid2,
      disputeId: uuid1,
      resolution: 'side_0_wins',
    })
    expect(parsed.resolution).toBe('side_0_wins')
  })

  it('match_accepted exige scheduledAt au format ISO datetime', () => {
    expect(() =>
      notificationPayloadSchemas.match_accepted.parse({
        matchId: uuid1,
        ladderId: uuid2,
        scheduledAt: 'demain vers 21h', // pas de l'ISO
      }),
    ).toThrow()

    const parsed = notificationPayloadSchemas.match_accepted.parse({
      matchId: uuid1,
      ladderId: uuid2,
      scheduledAt: new Date().toISOString(),
    })
    expect(typeof parsed.scheduledAt).toBe('string')
  })

  it('les 10 types de notification ont bien un schéma', () => {
    const expectedTypes = [
      'match_accepted',
      'result_submitted',
      'result_confirmed',
      'dispute_opened',
      'dispute_resolved',
      'dispute_auto_cancelled',
      'match_ghost_cancelled',
      'dispute_needs_admin',
      // social
      'friend_request_received',
      'friend_request_accepted',
    ]
    expect(Object.keys(notificationPayloadSchemas).sort()).toEqual(expectedTypes.sort())
  })

  it('les payloads social sont stricts (champ en trop rejeté, pseudo requis)', () => {
    const ok = notificationPayloadSchemas.friend_request_received.parse({
      friendshipId: uuid1,
      fromUserId: uuid2,
      fromPseudo: 'bob',
    })
    expect(ok.fromPseudo).toBe('bob')

    // champ en trop (ex. un email glissé par erreur) -> rejeté
    expect(() =>
      notificationPayloadSchemas.friend_request_accepted.parse({
        friendshipId: uuid1,
        byUserId: uuid2,
        byPseudo: 'bob',
        email: 'leak@example.com',
      }),
    ).toThrow()

    // pseudo manquant -> rejeté
    expect(() =>
      notificationPayloadSchemas.friend_request_accepted.parse({
        friendshipId: uuid1,
        byUserId: uuid2,
      }),
    ).toThrow()
  })
})
