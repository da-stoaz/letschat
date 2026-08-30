import { describe, it, expect } from 'vitest'
import { makeUser, ownerSql, ReducerError, type TestUser } from './harness'

// The first-admin bootstrap is a privilege grant, so it needs a guard against
// the obvious abuse: everyone becoming an admin. Exactly one account may be
// promoted this way, and only while the instance has no admin at all.
//
// Context: a container deployment publishes the module with an automated
// identity that never signs in, so `init` cannot promote anyone. Without this
// bootstrap a fresh instance has zero admins and no way to create one, which
// makes `set_archive_service_identity` — and therefore the entire cold-archive
// durability guarantee — permanently unreachable.

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
  it('grants admin to the first registrant and to nobody after', async () => {
    // Order-independent: claim the bootstrap here if no other file has, so the
    // assertions below hold however vitest orders the suite.
    if (adminIdentities().length === 0) {
      const first = await makeUser('firstadm')
      expect(await isAdmin(first)).toBe(true)
    }

    // Compare against a baseline rather than asserting a global count of one.
    // The suite shares a database and other files legitimately promote admins
    // of their own (`makeAdmin`), so "exactly one admin exists" is a claim about
    // the whole suite's ordering, not about this bootstrap — and it made this
    // test fail on roughly half of all runs. What actually matters is that
    // registering does not ADD an admin once the instance has one.
    const baseline = adminIdentities()
    expect(baseline.length).toBeGreaterThanOrEqual(1)

    // The instance now has an admin, so nobody else is promoted on registration.
    const later = await makeUser('late')
    expect(await isAdmin(later)).toBe(false)
    expect(adminIdentities()).toEqual(baseline)

    // …and a non-admin cannot promote itself,
    await expect(later.call('set_user_admin', [later.idArg, true])).rejects.toThrow(ReducerError)
    // …nor register the archive service, the reducer this bootstrap exists for.
    await expect(later.call('set_archive_service_identity', [later.idArg])).rejects.toThrow(
      ReducerError,
    )

    expect(adminIdentities()).toEqual(baseline)
  })
})
