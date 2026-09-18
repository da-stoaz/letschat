import { describe, it, expect } from 'vitest'
import {
  makeAdmin,
  makeUser,
  mintIdentity,
  ownerSql,
  ReducerError,
  type TestUser,
} from './harness'

// Bootstrap authority belongs to the identity that published the module. The
// init reducer gives that owner a reserved User row immediately; public account
// registration must never grant instance-admin rights, even to the first user.

/** Identities are printed as long hex; header and rule lines never match. */
function adminIdentities(): string[] {
  return ownerSql('SELECT identity FROM user WHERE is_admin = true')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^"?(0x)?[0-9a-f]{32,}"?$/i.test(line))
}

async function isAdmin(user: TestUser): Promise<boolean> {
  return adminIdentities().some((id) =>
    id.replace(/[^0-9a-f]/gi, '').toLowerCase().endsWith(user.identity.toLowerCase()),
  )
}

describe('instance admin bootstrap', () => {
  it('seeds the module owner and never promotes a public registrant', async () => {
    expect(
      ownerSql("SELECT is_admin FROM user WHERE username = '@module-owner'"),
    ).toMatch(/\btrue\b/i)

    // Compare against a baseline because the suite shares one database and
    // other files legitimately promote temporary admins of their own.
    const baseline = adminIdentities()
    expect(baseline.length).toBeGreaterThanOrEqual(1)

    const firstPublicUser = await makeUser('first_public')
    expect(await isAdmin(firstPublicUser)).toBe(false)
    expect(adminIdentities()).toEqual(baseline)

    await expect(
      firstPublicUser.call('set_user_admin', [firstPublicUser.idArg, true]),
    ).rejects.toThrow(ReducerError)
    await expect(
      firstPublicUser.call('set_archive_service_identity', [firstPublicUser.idArg]),
    ).rejects.toThrow(ReducerError)

    expect(adminIdentities()).toEqual(baseline)
  })

  it('applies an explicit admin grant when the target registers later', async () => {
    const grantor = await makeAdmin('grantor')
    const futureAdmin = await mintIdentity('future_admin')

    try {
      await grantor.call('set_user_admin', [futureAdmin.idArg, true])
      expect(await isAdmin(futureAdmin)).toBe(false)

      await futureAdmin.call('register_user', [futureAdmin.username, futureAdmin.username])
      expect(await isAdmin(futureAdmin)).toBe(true)
    } finally {
      // Keep the shared suite independent even when an assertion fails.
      ownerSql(`UPDATE user SET is_admin = false WHERE identity = 0x${grantor.identity}`)
      ownerSql(`UPDATE user SET is_admin = false WHERE identity = 0x${futureAdmin.identity}`)
    }
  })
})
