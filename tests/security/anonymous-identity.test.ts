// The anonymous-identity boundary (BUG_ANALYSIS A1).
//
// SpacetimeDB hands an identity to anyone who asks — `POST /v1/identity` is
// unauthenticated — and the module only ever sees `ctx.sender()`. So without a
// gate, the public chat WebSocket is a side door around every account control
// core-api enforces on the HTTP path: registration open/closed, e-mail
// confirmation, admin approval, disabled accounts.
//
// Two gates close it, and both are asserted here:
//   • `require_account` on every client-callable reducer — you need a `User` row.
//   • `require_trusted_issuer` on `register_user` — the only reducer that
//     creates a `User` row, so it is the only one that has to look at the
//     caller's token issuer.
//
// The whole existing suite mints SpacetimeDB-issued identities and registers
// them, which is precisely the attack this fixes. That keeps working because
// `trusted_issuer` is unset on a fresh database (the check is off until an
// operator's core-api pins it) — so this file pins it explicitly, asserts the
// behaviour, and clears it again.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  makeAdmin,
  makeUser,
  mintIdentity,
  none,
  ownerSql,
  some,
  uniqueName,
  type TestUser,
} from './harness'

/** The `iss` claim of a token, read straight out of its JWT payload segment. */
function issuerOf(token: string): string {
  const payload = token.split('.')[1]
  const json = Buffer.from(payload, 'base64url').toString('utf-8')
  return (JSON.parse(json) as { iss: string }).iss
}

// An admin, needed to set instance-wide settings.
//
// Created in `beforeAll` rather than at module scope so it is this file's FIRST
// registration: `register_user` grants instance admin to the first account on
// an instance that has none, so a registration racing ahead of this one would
// leave the database with two admins and break `admin-bootstrap.test.ts`. The
// suite shares one database, so this file also hands back exactly what it took
// (see the teardown below).
let admin: TestUser

beforeAll(async () => {
  admin = await makeAdmin('iss_adm')
})

async function setTrustedIssuer(issuer: string | null): Promise<void> {
  await admin.call('set_trusted_issuer', [issuer === null ? none : some(issuer)])
}

afterAll(async () => {
  try {
    // Unpin, or every other file's SpacetimeDB-issued registrations start failing.
    await setTrustedIssuer(null)
  } finally {
    // Give the admin bit back too, so the admin count is exactly what this file
    // found — whichever order vitest runs the files in. In `finally` because a
    // failing test above must not leak an extra admin into the shared database.
    ownerSql(`UPDATE user SET is_admin = false WHERE identity = 0x${admin.identity}`)
  }
})

describe('require_account — an identity without an account has no standing', () => {
  it('refuses every client-callable reducer for an unregistered identity', async () => {
    const stranger = await mintIdentity('anon')

    // One per shape of gate that used to be reachable without an account:
    // instance-level creation, social graph, presence, and profile.
    const attempts: [string, unknown[]][] = [
      ['create_server', [uniqueName('srv')]],
      ['send_friend_request', [stranger.idArg]],
      ['touch_presence', []],
      ['use_invite', ['abcd1234']],
      ['request_to_join', [1]],
      ['send_direct_message', [stranger.idArg, 'hello']],
    ]

    for (const [reducer, args] of attempts) {
      await expect(stranger.call(reducer, args), reducer).rejects.toThrow(
        /no account for this identity/,
      )
    }
  })

  it('still lets a registered user through', async () => {
    // The gate must reject the stranger for lacking an account, not reject
    // everyone — without this the test above would pass on a broken module.
    const user = await makeUser('acct_ok')
    await expect(user.call('create_server', [uniqueName('srv')])).resolves.toBeUndefined()
  })
})

describe('require_trusted_issuer — only core-api tokens may register', () => {
  it('is off while no issuer is pinned, so publishing cannot lock an instance out', async () => {
    await setTrustedIssuer(null)
    await expect(makeUser('unpinned')).resolves.toBeDefined()
  })

  it('rejects registration by a token from any other issuer', async () => {
    await setTrustedIssuer('https://core-api.example.invalid')

    const stranger = await mintIdentity('anon')
    await expect(stranger.call('register_user', [stranger.username, stranger.username]))
      .rejects.toThrow(/registration requires an account token/)

    // …and having been refused, it still has no standing anywhere else.
    await expect(stranger.call('create_server', [uniqueName('srv')])).rejects.toThrow(
      /no account for this identity/,
    )
  })

  it('accepts registration by a token from the pinned issuer', async () => {
    // Pin the issuer these test tokens genuinely carry (SpacetimeDB's own,
    // since the harness mints through `/v1/identity`). In production that value
    // is core-api's `SPACETIME_OIDC_ISSUER`, pinned by core-api itself — the
    // mechanism under test is the `iss` comparison, not which string it is.
    await setTrustedIssuer(issuerOf(admin.token))

    await expect(makeUser('pinned')).resolves.toBeDefined()
  })

  it('only an instance admin can pin the issuer', async () => {
    const user = await makeUser('not_adm')
    await expect(user.call('set_trusted_issuer', [some('https://evil.example')])).rejects.toThrow(
      /instance admin permission required/,
    )
  })
})

describe('the archive worker is not caught by the account gate', () => {
  it('rejects a stranger with the worker gate, not the account gate', async () => {
    // The `archive_*` reducers have their own, stricter boundary (a registered
    // worker identity) and deliberately do NOT call `require_account` — the
    // worker is a service, not a user. Asserting the error message proves the
    // account gate was not bolted onto them by mistake.
    const stranger = await mintIdentity('anon')
    await expect(stranger.call('archive_restore_message', [[]])).rejects.toThrow(
      /archive service identity only/,
    )
  })
})
