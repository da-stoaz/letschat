import { beforeAll, describe, expect, it } from 'vitest'
import {
  createChannel,
  createServer,
  makeFriends,
  makeOpenJoinable,
  makeUser,
  type TestUser,
} from './harness'

function dmScope(a: TestUser, b: TestUser): string {
  return `dm:${[a.identity, b.identity].map((identity) => identity.toLowerCase()).sort().join(':')}`
}

describe('typing scope authorization', () => {
  let owner: TestUser
  let member: TestUser
  let outsider: TestUser
  let channelId: number

  beforeAll(async () => {
    owner = await makeUser('typing_owner')
    member = await makeUser('typing_member')
    outsider = await makeUser('typing_outsider')
    await makeFriends(owner, member)

    const serverId = await createServer(owner)
    channelId = await createChannel(owner, serverId)
    await makeOpenJoinable(owner, serverId)
    await member.call('join_discoverable_server', [serverId])
  })

  it('allows accepted friends to set and clear DM typing state', async () => {
    const scope = dmScope(owner, member)

    await owner.call('set_typing_state', [scope, true])
    const active = await member.sql(
      `SELECT scope_key FROM my_typing_states WHERE scope_key = '${scope}'`,
    )
    expect(active.rows).toHaveLength(1)

    await owner.call('set_typing_state', [scope, false])
    const cleared = await member.sql(
      `SELECT scope_key FROM my_typing_states WHERE scope_key = '${scope}'`,
    )
    expect(cleared.rows).toHaveLength(0)
  })

  it('rejects DM typing state for users who are not friends', async () => {
    await expect(
      outsider.call('set_typing_state', [dmScope(owner, outsider), true]),
    ).rejects.toThrow(/friendship not accepted/)
  })

  it('uses channel membership to allow members and reject outsiders', async () => {
    const scope = `channel:${channelId}`

    await expect(member.call('set_typing_state', [scope, true])).resolves.toBeUndefined()
    await expect(outsider.call('set_typing_state', [scope, true])).rejects.toThrow(
      /not a member/,
    )
    await member.call('set_typing_state', [scope, false])
  })
})
