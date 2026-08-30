// Token revocation inside the chat module (BUG_ANALYSIS A4).
//
// The client talks to SpacetimeDB directly, so core-api's account checks are
// simply not on that path. Disabling an account only stopped it signing in
// again, and resetting a password revoked nothing at all — the stolen token
// kept full chat access for its entire 30-day life. The module therefore holds
// two facts per account, pushed by core-api:
//
//   • `suspended`             — refuses every client-callable reducer outright.
//   • `min_token_generation`  — refuses tokens minted before the last
//                               credential change.
//
// Coverage note: these tokens come from SpacetimeDB's own `/v1/identity`, so
// they carry no `gen` claim and read as generation 0. That exercises the
// revoking direction exactly (floor 1 rejects them) and the not-revoked
// direction (floor 0 admits them). The "a freshly minted token clears the
// floor" direction needs a core-api-signed token and is covered there, in
// TokenRevocationTests.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createServer,
  makeAdmin,
  makeUser,
  ownerSql,
  uniqueName,
  type TestUser,
} from './harness'

// Created in `beforeAll` so it is this file's first registration, and handed
// back in `afterAll` — the suite shares one database. Same reasoning as
// anonymous-identity.test.ts.
let admin: TestUser

beforeAll(async () => {
  admin = await makeAdmin('rev_adm')
})

afterAll(async () => {
  ownerSql(`UPDATE user SET is_admin = false WHERE identity = 0x${admin.identity}`)
})

/** Push an account's access state, exactly as core-api does. */
async function setAccess(
  target: TestUser,
  suspended: boolean,
  minGeneration: number,
): Promise<void> {
  await admin.call('admin_set_account_access', [target.idArg, suspended, minGeneration])
}

/** The floor the module currently holds for an account. */
function storedFloor(target: TestUser): number {
  const out = ownerSql(
    `SELECT min_token_generation FROM user WHERE identity = 0x${target.identity}`,
  )
  const match = out.match(/\b(\d+)\b(?![^\n]*identity)/)
  return match ? Number(match[1]) : -1
}

describe('suspended — an admin disabling an account stops it acting', () => {
  it('refuses reducers while suspended and allows them again after', async () => {
    const user = await makeUser('susp')

    // Works before.
    await expect(user.call('touch_presence', [])).resolves.toBeUndefined()

    await setAccess(user, true, 0)
    await expect(user.call('touch_presence', [])).rejects.toThrow(
      /this account has been disabled/,
    )
    await expect(user.call('create_server', [uniqueName('srv')])).rejects.toThrow(
      /this account has been disabled/,
    )

    // Re-enabling is a plain status change, so it must fully restore access.
    await setAccess(user, false, 0)
    await expect(user.call('touch_presence', [])).resolves.toBeUndefined()
  })

  it('strips a suspended admin of admin powers too', async () => {
    const other = await makeAdmin('susp_adm')
    await setAccess(other, true, 0)

    // Otherwise a disabled admin keeps every instance-wide reducer.
    await expect(other.call('set_trusted_issuer', [{ none: [] }])).rejects.toThrow(
      /this account has been disabled/,
    )

    ownerSql(`UPDATE user SET is_admin = false, suspended = false WHERE identity = 0x${other.identity}`)
  })
})

describe('min_token_generation — a credential change ends existing sessions', () => {
  it('is off at generation 0, so an untouched account is unaffected', async () => {
    const user = await makeUser('gen_zero')
    expect(storedFloor(user)).toBe(0)
    await expect(user.call('touch_presence', [])).resolves.toBeUndefined()
  })

  it('refuses a token minted below the floor', async () => {
    const user = await makeUser('gen_old')
    await createServer(user)

    await setAccess(user, false, 1)

    // The token is unchanged and still cryptographically valid — it is simply
    // older than the account's current generation now.
    await expect(user.call('touch_presence', [])).rejects.toThrow(
      /session is no longer valid/,
    )
    await expect(user.call('create_server', [uniqueName('srv')])).rejects.toThrow(
      /session is no longer valid/,
    )
  })

  it('never lowers the floor, so a stale retry cannot re-open a session', async () => {
    const user = await makeUser('gen_mono')

    await setAccess(user, false, 5)
    expect(storedFloor(user)).toBe(5)

    // core-api pushes best-effort and may retry; an out-of-order or replayed
    // call must not undo a revocation that already landed.
    await setAccess(user, false, 2)
    expect(storedFloor(user)).toBe(5)

    await expect(user.call('touch_presence', [])).rejects.toThrow(/session is no longer valid/)
  })
})

describe('admin_set_account_access', () => {
  it('is refused to a non-admin', async () => {
    const user = await makeUser('rev_nonadm')
    const victim = await makeUser('rev_victim')

    await expect(
      user.call('admin_set_account_access', [victim.idArg, true, 0]),
    ).rejects.toThrow(/instance admin permission required/)
  })

  it('no-ops for an identity that never registered in chat', async () => {
    // core-api pushes for every account it disables, including ones that only
    // ever used the web login — their disable flow must not fail on that.
    const stranger = await makeUser('rev_ghost')
    ownerSql(`DELETE FROM user WHERE identity = 0x${stranger.identity}`)

    await expect(setAccess(stranger, true, 3)).resolves.toBeUndefined()
  })
})
