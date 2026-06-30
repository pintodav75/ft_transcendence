import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/auth/password.js'

describe('password hashing', () => {
  it('hashes a password into a non-empty string different from the plaintext', async () => {
    const plain = 'monMotDePasse'
    const hash = await hashPassword(plain)

    expect(hash).toBeTruthy()
    expect(hash).not.toBe(plain)
  })

  it('verifyPassword returns true for the correct password', async () => {
    const plain = 'monMotDePasse'
    const hash = await hashPassword(plain)

    expect(await verifyPassword(plain, hash)).toBe(true)
  })

  it('verifyPassword returns false for a wrong password', async () => {
    const hash = await hashPassword('monMotDePasse')

    expect(await verifyPassword('mauvais', hash)).toBe(false)
  })
})
