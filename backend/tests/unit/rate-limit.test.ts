import { describe, it, expect } from 'vitest'
import type { FastifyRequest } from 'fastify'
import {
  rateLimitKey,
  twoFactorVerifyAccountKey,
  twoFactorVerifyRateLimitKey,
} from '../../src/utils/rate-limit.js'

// Fabrique une requête minimale : seuls `user` et `ip` comptent pour ce générateur.
const asRequest = (user: unknown, ip: string) => ({ user, ip }) as unknown as FastifyRequest

// Requête minimale pour `/auth/2fa/verify` : un corps, une IP, et un `server.jwt.verify` qui
// joue le vrai contrat — il RENVOIE le payload sur une signature valide, il JETTE sinon.
// `valid` est la table des tokens acceptés ; tout le reste est traité comme illisible.
const as2faRequest = (
  body: unknown,
  ip: string,
  valid: Record<string, unknown> = {},
): FastifyRequest =>
  ({
    body,
    ip,
    server: {
      jwt: {
        verify: (token: string) => {
          if (!(token in valid)) throw new Error('invalid signature')
          return valid[token]
        },
      },
    },
  }) as unknown as FastifyRequest

describe('rateLimitKey', () => {
  it("indexe sur le sub du JWT quand la requête est authentifiée", () => {
    expect(rateLimitKey(asRequest({ sub: 'u-1', type: 'access' }, '10.0.0.1'))).toBe('u:u-1')
  })

  it('replie sur l’IP quand rien n’a peuplé request.user (route anonyme)', () => {
    expect(rateLimitKey(asRequest(undefined, '10.0.0.1'))).toBe('ip:10.0.0.1')
  })

  it('donne des clés DIFFÉRENTES à deux users derrière la MÊME IP', () => {
    const a = rateLimitKey(asRequest({ sub: 'u-1' }, '10.0.0.1'))
    const b = rateLimitKey(asRequest({ sub: 'u-2' }, '10.0.0.1'))

    expect(a).not.toBe(b)
  })

  it('donne des clés DIFFÉRENTES à deux IP anonymes distinctes', () => {
    const a = rateLimitKey(asRequest(undefined, '10.0.0.1'))
    const b = rateLimitKey(asRequest(undefined, '10.0.0.2'))

    expect(a).not.toBe(b)
  })

  // Le préfixe n'est pas décoratif : sans lui, un `sub` qui vaudrait « 10.0.0.1 » partagerait
  // le compteur de l'IP 10.0.0.1.
  it('ne confond pas un sub et une IP de même valeur', () => {
    const user = rateLimitKey(asRequest({ sub: '10.0.0.1' }, '192.168.0.9'))
    const anon = rateLimitKey(asRequest(undefined, '10.0.0.1'))

    expect(user).not.toBe(anon)
  })

  // Un `user` présent mais sans `sub` ne doit pas produire la clé « u:undefined », partagée
  // par tout le monde : on retombe sur l'IP.
  it('replie sur l’IP si user existe mais n’a pas de sub', () => {
    expect(rateLimitKey(asRequest({}, '10.0.0.1'))).toBe('ip:10.0.0.1')
  })
})

describe('twoFactorVerifyRateLimitKey', () => {
  const tempToken = { 'temp.victim': { sub: 'u-victim', pending: 'totp' } }

  it('indexe sur le compte visé par le tempToken, pas sur l’IP', () => {
    const key = twoFactorVerifyRateLimitKey(
      as2faRequest({ tempToken: 'temp.victim', code: '000000' }, '10.0.0.1', tempToken),
    )

    expect(key).toBe('u:u-victim')
  })

  // Le cœur du ticket : changer d'IP ne doit PAS rendre un budget d'essais neuf.
  it('donne la MÊME clé au même compte attaqué depuis deux IP différentes', () => {
    const a = twoFactorVerifyRateLimitKey(
      as2faRequest({ tempToken: 'temp.victim' }, '10.0.0.1', tempToken),
    )
    const b = twoFactorVerifyRateLimitKey(
      as2faRequest({ tempToken: 'temp.victim' }, '203.0.113.7', tempToken),
    )

    expect(a).toBe(b)
  })

  it('donne des clés DIFFÉRENTES à deux comptes depuis la même IP', () => {
    const valid = {
      'temp.a': { sub: 'u-a', pending: 'totp' },
      'temp.b': { sub: 'u-b', pending: 'totp' },
    }
    const a = twoFactorVerifyRateLimitKey(as2faRequest({ tempToken: 'temp.a' }, '10.0.0.1', valid))
    const b = twoFactorVerifyRateLimitKey(as2faRequest({ tempToken: 'temp.b' }, '10.0.0.1', valid))

    // Assertions sur la valeur ATTENDUE, pas un simple `not.toBe` : deux clés fausses de la
    // même façon (deux replis IP, p. ex.) seraient elles aussi « différentes ».
    expect(a).toBe('u:u-a')
    expect(b).toBe('u:u-b')
  })

  it('replie sur l’IP quand le corps ne porte aucun tempToken', () => {
    expect(twoFactorVerifyRateLimitKey(as2faRequest({ code: '000000' }, '10.0.0.1'))).toBe(
      'ip:10.0.0.1',
    )
  })

  it('replie sur l’IP quand il n’y a pas de corps du tout', () => {
    expect(twoFactorVerifyRateLimitKey(as2faRequest(undefined, '10.0.0.1'))).toBe('ip:10.0.0.1')
  })

  it('replie sur l’IP quand tempToken n’est pas une chaîne', () => {
    expect(twoFactorVerifyRateLimitKey(as2faRequest({ tempToken: 42 }, '10.0.0.1'))).toBe(
      'ip:10.0.0.1',
    )
  })

  it('replie sur l’IP quand tempToken est une chaîne vide', () => {
    expect(twoFactorVerifyRateLimitKey(as2faRequest({ tempToken: '' }, '10.0.0.1'))).toBe(
      'ip:10.0.0.1',
    )
  })

  // Sans la garde sur `sub`, ce payload produirait « u:undefined » — une clé unique partagée
  // par tous les porteurs d'un tempToken mal formé.
  it('replie sur l’IP pour un tempToken totp valide mais sans sub', () => {
    const noSub = { 'temp.nosub': { pending: 'totp' } }
    const key = twoFactorVerifyRateLimitKey(
      as2faRequest({ tempToken: 'temp.nosub' }, '10.0.0.1', noSub),
    )

    expect(key).toBe('ip:10.0.0.1')
  })

  // Sans vérification de signature, un attaquant fabriquerait un `sub` neuf à chaque requête et
  // s'offrirait un compteur vierge : la limite ne limiterait plus rien.
  it('replie sur l’IP quand la signature du tempToken est invalide', () => {
    const key = twoFactorVerifyRateLimitKey(
      as2faRequest({ tempToken: 'forge.uvictim' }, '10.0.0.1', tempToken),
    )

    expect(key).toBe('ip:10.0.0.1')
  })

  it('replie sur l’IP pour un token valide qui n’est pas un tempToken totp', () => {
    const access = { 'access.tok': { sub: 'u-1', type: 'access' } }
    const key = twoFactorVerifyRateLimitKey(as2faRequest({ tempToken: 'access.tok' }, '10.0.0.1', access))

    expect(key).toBe('ip:10.0.0.1')
  })

  // C'est cette distinction — clé de compte vs pas de compte — que `2fa.ts` utilise pour NE
  // PAS compter les requêtes sans tempToken exploitable : les envoyer dans le repli `ip:` de
  // ce compteur les bornerait à 5/min sur un bucket commun à toute la plateforme.
  it('la variante « compte » rend null quand aucun compte n’est identifiable', () => {
    expect(twoFactorVerifyAccountKey(as2faRequest({ tempToken: 'forge.x' }, '10.0.0.1'))).toBeNull()
    expect(twoFactorVerifyAccountKey(as2faRequest({}, '10.0.0.1'))).toBeNull()
  })

  it('la variante « compte » rend la clé du compte sur un tempToken valide', () => {
    const key = twoFactorVerifyAccountKey(
      as2faRequest({ tempToken: 'temp.victim' }, '10.0.0.1', tempToken),
    )

    expect(key).toBe('u:u-victim')
  })

  // Même piège de préfixe que pour `rateLimitKey` : un `sub` qui vaudrait une IP.
  it('ne confond pas un sub et une IP de même valeur', () => {
    const odd = { 'temp.odd': { sub: '10.0.0.1', pending: 'totp' } }
    const user = twoFactorVerifyRateLimitKey(
      as2faRequest({ tempToken: 'temp.odd' }, '192.168.0.9', odd),
    )
    const anon = twoFactorVerifyRateLimitKey(as2faRequest({}, '10.0.0.1'))

    expect(user).not.toBe(anon)
  })
})
