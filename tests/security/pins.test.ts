import { describe, it, expect, beforeAll } from 'vitest'
import {
  makeUser,
  createServer,
  createChannel,
  makeOpenJoinable,
  uniqueName,
  ReducerError,
  type TestUser,
} from './harness'

// Pin behaviour end-to-end: the moderator gate on pin_message/unpin_message, the
// scoped my_pinned_messages view (members see pins, outsiders don't), and the
// two auto-cleanup paths (unpin, and deleting a pinned message).

async function sendMessage(user: TestUser, channelId: number, content: string): Promise<number> {
  await user.call('send_message', [channelId, content])
  const { rows } = await user.sql('SELECT id, content FROM my_channel_messages')
  const row = rows.find((r) => r.content === content)
  if (!row) throw new Error(`sent message "${content}" not visible in my_channel_messages`)
  return Number(row.id)
}

async function pinnedIds(user: TestUser): Promise<number[]> {
  const { rows } = await user.sql('SELECT message_id FROM my_pinned_messages')
  return rows.map((r) => Number(r.message_id))
}

describe('pin_message / unpin_message / my_pinned_messages', () => {
  let owner: TestUser
  let member: TestUser
  let outsider: TestUser
  let serverId: number
  let channelId: number
  let messageId: number
  const content = `pin-me-${uniqueName()}`

  beforeAll(async () => {
    owner = await makeUser('owner')
    member = await makeUser('member')
    outsider = await makeUser('outsider')
    serverId = await createServer(owner)
    channelId = await createChannel(owner, serverId)
    await makeOpenJoinable(owner, serverId)
    await member.call('join_discoverable_server', [serverId])
    messageId = await sendMessage(owner, channelId, content)
  })

  it('an owner/moderator can pin a message', async () => {
    await owner.call('pin_message', [channelId, messageId])
    expect(await pinnedIds(owner)).toContain(messageId)
  })

  it('a member of the space sees the pin', async () => {
    expect(await pinnedIds(member)).toContain(messageId)
  })

  it('a non-member sees no pins', async () => {
    expect(await pinnedIds(outsider)).not.toContain(messageId)
  })

  it('a non-moderator member cannot pin', async () => {
    const mid = await sendMessage(owner, channelId, `no-pin-${uniqueName()}`)
    await expect(member.call('pin_message', [channelId, mid])).rejects.toBeInstanceOf(ReducerError)
    expect(await pinnedIds(owner)).not.toContain(mid)
  })

  it('unpin removes the pin', async () => {
    await owner.call('unpin_message', [channelId, messageId])
    expect(await pinnedIds(owner)).not.toContain(messageId)
  })

  it('deleting a pinned message auto-removes the pin', async () => {
    const mid = await sendMessage(owner, channelId, `pin-then-delete-${uniqueName()}`)
    await owner.call('pin_message', [channelId, mid])
    expect(await pinnedIds(owner)).toContain(mid)

    await owner.call('delete_message', [mid])
    expect(await pinnedIds(owner)).not.toContain(mid)
  })
})
