import { describe, it, expect } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { rateLimitKey } from '../../src/utils/rate-limit.js'

// Fabrique une requête minimale : seuls `user` et `ip` comptent pour ce générateur.
const asRequest = (user: unknown, ip: string) => ({ user, ip }) as unknown as FastifyRequest

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
