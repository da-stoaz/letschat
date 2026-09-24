import { describe, it, expect } from 'vitest'
import {
  createServer,
  makeAdmin,
  makeOpenJoinable,
  makeUser,
  none,
  ownerSql,
  some,
  type TestUser,
} from './harness'

// Validation and cleanup gaps in the module (BUG_ANALYSIS B5, B7, B8, D3, D5).

async function textChannel(user: TestUser): Promise<number> {
  return Number((await user.sql("SELECT id FROM my_channels WHERE name = 'general'")).rows[0].id)
}

function readStateRows(identity: string): number {
  return ownerSql(`SELECT read_key FROM read_state WHERE user_identity = 0x${identity}`)
    .split('\n')
    .filter((line) => /^\s*"/.test(line)).length
}

describe('display names (B5)', () => {
  it('rejects empty, overlong and control-character names', async () => {
    const user = await makeUser('dname')
    await expect(user.call('update_profile', [some('   '), none])).rejects.toThrow(/display name/)
    await expect(user.call('update_profile', [some('x'.repeat(101)), none])).rejects.toThrow(/display name/)
    await expect(user.call('update_profile', [some('bad\u0007name'), none])).rejects.toThrow(/display name/)
    await expect(user.call('update_profile', [some('  Fine Name  '), none])).resolves.toBeUndefined()
    const { rows } = await user.sql('SELECT display_name FROM my_visible_users')
    expect(rows.map((r) => r.display_name)).toContain('Fine Name')
  })
})

describe('invites (B7, B8)', () => {
  it('issues long tokens and rejects expiries beyond a year', async () => {
    const owner = await makeUser('invtok')
    const serverId = await createServer(owner)
    await owner.call('create_invite', [serverId, some(3600), none, []])
    const { rows } = await owner.sql('SELECT token FROM my_invites')
    expect(String(rows[0].token)).toHaveLength(16)

    await expect(
      owner.call('create_invite', [serverId, some(366 * 24 * 3600), none, []]),
    ).rejects.toThrow(/between 1 second and 365 days/)
    // Overflowed `seconds * 1_000_000` as i64 and wrapped into a past expiry.
    await expect(
      owner.call('create_invite', [serverId, some(1_000_000_000_000_000), none, []]),
    ).rejects.toThrow(/365 days/)
  })
})

describe('departures clean up after themselves (D3)', () => {
  it('drops read cursors on leave and when a channel is deleted', async () => {
    const owner = await makeUser('d3_o')
    const member = await makeUser('d3_m')
    const serverId = await createServer(owner)
    await makeOpenJoinable(owner, serverId)
    await member.call('join_discoverable_server', [serverId])
    const channel = await textChannel(member)

    await member.call('mark_channel_read', [channel])
    expect(readStateRows(member.identity)).toBe(1)
    await member.call('leave_server', [serverId])
    expect(readStateRows(member.identity)).toBe(0)

    await owner.call('create_channel', [serverId, 'extra', { text: [] }, none, false])
    await owner.call('mark_channel_read', [channel])
    expect(readStateRows(owner.identity)).toBe(1)
    await owner.call('delete_channel', [channel])
    expect(readStateRows(owner.identity)).toBe(0)
  })
})

describe('rekey_identities (D5)', () => {
  it('refuses a chained remap instead of losing an account', async () => {
    const admin = await makeAdmin('rekey_adm')
    const a = await makeUser('rekey_a')
    const b = await makeUser('rekey_b')
    const c = await makeUser('rekey_c')
    const pair = (from: TestUser, to: TestUser) => [from.idArg, to.idArg]

    await expect(admin.call('rekey_identities', [[pair(a, b), pair(b, c)]])).rejects.toThrow(
      /chains are not supported/,
    )
    await expect(admin.call('rekey_identities', [[pair(a, c), pair(b, c)]])).rejects.toThrow(
      /same target/,
    )
  })
})
