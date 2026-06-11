import { describe, it, expect, beforeAll } from 'vitest'
import {
  makeUser,
  createServer,
  createChannel,
  makeFriends,
  makeOpenJoinable,
  uniqueName,
  none,
  some,
  type TestUser,
} from './harness'

// Each `my_*` view must return only what the calling identity is entitled to —
// a member's own spaces, a participant's own DMs, etc. The cross-user negative
// assertions (a non-member / third party sees nothing) are the security core.

describe('my_channel_messages: only members of the channel’s space', () => {
  let alice: TestUser
  let bob: TestUser
  const content = `secret-channel-${uniqueName()}`

  beforeAll(async () => {
    alice = await makeUser('alice')
    bob = await makeUser('bob')
    const serverId = await createServer(alice)
    const channelId = await createChannel(alice, serverId)
    await alice.call('send_message', [channelId, content])
  })

  it('the author (a member) sees the message', async () => {
    const { rows } = await alice.sql('SELECT content FROM my_channel_messages')
    expect(rows.some((r) => r.content === content)).toBe(true)
  })

  it('a non-member sees nothing', async () => {
    const { rows } = await bob.sql('SELECT content FROM my_channel_messages')
    expect(rows).toHaveLength(0)
  })
})

describe('my_direct_messages: only the two participants', () => {
  let alice: TestUser
  let bob: TestUser
  let carol: TestUser
  const content = `secret-dm-${uniqueName()}`

  beforeAll(async () => {
    alice = await makeUser('alice')
    bob = await makeUser('bob')
    carol = await makeUser('carol')
    await makeFriends(alice, bob)
    await alice.call('send_direct_message', [bob.idArg, content])
  })

  it('both participants see the DM', async () => {
    const fromAlice = await alice.sql('SELECT content FROM my_direct_messages')
    const fromBob = await bob.sql('SELECT content FROM my_direct_messages')
    expect(fromAlice.rows.some((r) => r.content === content)).toBe(true)
    expect(fromBob.rows.some((r) => r.content === content)).toBe(true)
  })

  it('a third party sees nothing', async () => {
    const { rows } = await carol.sql('SELECT content FROM my_direct_messages')
    expect(rows).toHaveLength(0)
  })
})

describe('my_servers: member spaces ∪ discoverable spaces', () => {
  let alice: TestUser
  let bob: TestUser
  const privateName = uniqueName('priv')
  const discoverableName = uniqueName('disc')

  beforeAll(async () => {
    alice = await makeUser('alice')
    bob = await makeUser('bob')
    await createServer(alice, privateName)
    const discoverableId = await createServer(alice, discoverableName)
    await alice.call('set_server_discovery', [discoverableId, true, none])
  })

  it('the owner sees both of their spaces', async () => {
    const names = (await alice.sql('SELECT name FROM my_servers')).rows.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining([privateName, discoverableName]))
  })

  it('a non-member sees the discoverable space but not the private one', async () => {
    const names = (await bob.sql('SELECT name FROM my_servers')).rows.map((r) => r.name)
    expect(names).toContain(discoverableName)
    expect(names).not.toContain(privateName)
  })
})

describe('my_server_members: not exposed for spaces you are not in', () => {
  let alice: TestUser
  let bob: TestUser
  let privateServerId: number

  beforeAll(async () => {
    alice = await makeUser('alice')
    bob = await makeUser('bob')
    privateServerId = await createServer(alice) // private: ModeratorsOnly, not discoverable
  })

  it('the owner sees their own membership row', async () => {
    const { rows } = await alice.sql('SELECT server_id FROM my_server_members')
    expect(rows.map((r) => Number(r.server_id))).toContain(privateServerId)
  })

  it('a non-member cannot see the membership of a private space', async () => {
    const { rows } = await bob.sql('SELECT server_id FROM my_server_members')
    expect(rows.map((r) => Number(r.server_id))).not.toContain(privateServerId)
  })
})

describe('my_visible_users: a directory of people you can see, not everyone', () => {
  let alice: TestUser
  let bob: TestUser
  let stranger: TestUser

  beforeAll(async () => {
    alice = await makeUser('alice')
    bob = await makeUser('bob')
    stranger = await makeUser('stranger')
    await makeFriends(alice, bob)
  })

  it('a user sees themselves and their friends', async () => {
    const names = (await alice.sql('SELECT username FROM my_visible_users')).rows.map(
      (r) => r.username,
    )
    expect(names).toEqual(expect.arrayContaining([alice.username, bob.username]))
  })

  it('a user cannot enumerate an unrelated user', async () => {
    const names = (await alice.sql('SELECT username FROM my_visible_users')).rows.map(
      (r) => r.username,
    )
    expect(names).not.toContain(stranger.username)
  })
})

describe('my_bans: visible only to a space’s moderators', () => {
  let owner: TestUser
  let member: TestUser
  let outsider: TestUser
  let serverId: number

  beforeAll(async () => {
    owner = await makeUser('owner')
    member = await makeUser('member')
    outsider = await makeUser('outsider')
    serverId = await createServer(owner)
    await makeOpenJoinable(owner, serverId)
    await member.call('join_discoverable_server', [serverId])
    await owner.call('ban_member', [serverId, member.idArg, some('spam')])
  })

  it('a moderator sees the ban for their space', async () => {
    const { rows } = await owner.sql('SELECT server_id FROM my_bans')
    expect(rows.map((r) => Number(r.server_id))).toContain(serverId)
  })

  it('a non-moderator sees no bans', async () => {
    const { rows } = await outsider.sql('SELECT server_id FROM my_bans')
    expect(rows.map((r) => Number(r.server_id))).not.toContain(serverId)
  })
})
