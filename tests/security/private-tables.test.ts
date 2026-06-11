import { describe, it, expect } from 'vitest'
import { anon } from './harness'

// Every table that holds content, secrets, or the social graph must be private:
// invisible to an unauthenticated `/sql` caller. If a future schema change drops
// `public` protection (or re-adds it), one of these fails.
const PRIVATE_TABLES = [
  'auth_credential',
  'ban',
  'block',
  'channel',
  'direct_message',
  'dm_server_invite',
  'dm_voice_participant',
  'friend',
  'invite',
  'join_request',
  'message',
  'presence_state',
  'read_state',
  'server',
  'server_member',
  'typing_state',
  'user',
  'voice_participant',
]

describe('private tables are not readable over /sql', () => {
  it.each(PRIVATE_TABLES)('rejects an anonymous read of `%s`', async (table) => {
    const res = await anon.sql(`SELECT * FROM ${table}`)
    expect(res.error, `expected "${table}" to be private`).toMatch(
      /no such table|may be marked private/i,
    )
    expect(res.rows).toHaveLength(0)
  })

  it('still serves the public system_settings table (core-api depends on it)', async () => {
    const res = await anon.sql('SELECT space_create_policy FROM system_settings')
    expect(res.error).toBeNull()
  })

  it('does not leak rows through a scoped view to an anonymous caller', async () => {
    // The views are `public` but scope to `ctx.sender`; an anonymous identity
    // matches nothing, so they must come back empty rather than dumping data.
    for (const view of ['my_direct_messages', 'my_channel_messages', 'my_visible_users']) {
      const res = await anon.sql(`SELECT * FROM ${view}`)
      expect(res.error, `view ${view} should be queryable`).toBeNull()
      expect(res.rows, `view ${view} should be empty for anon`).toHaveLength(0)
    }
  })
})
