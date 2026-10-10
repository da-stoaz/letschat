import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Timestamp } from 'spacetimedb'
import { DbConnection } from '../../src/generated'
import { BASE, DB, createChannel, createServer, makeOpenJoinable, makeUser, none, some, variant, type TestUser } from './harness'

function connect(user: TestUser): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 15_000)
    DbConnection.builder().withUri(BASE.replace(/^http/, 'ws')).withDatabaseName(DB)
      .withLightMode(false).withCompression('none').withToken(user.token)
      .onConnect(conn => { clearTimeout(timer); resolve(conn) })
      .onConnectError((_conn, error) => { clearTimeout(timer); reject(error) }).build()
  })
}

describe('moderator-only channel confidentiality', () => {
  let owner: TestUser
  let moderator: TestUser
  let member: TestUser
  let outsider: TestUser
  let ownerConn: DbConnection
  let memberConn: DbConnection
  let serverId: number
  let publicId: number
  let textId: number
  let voiceId: number
  let hiddenIds: number[]

  beforeAll(async () => {
    owner = await makeUser('hidden_owner')
    moderator = await makeUser('hidden_mod')
    member = await makeUser('hidden_member')
    outsider = await makeUser('hidden_out')
    serverId = await createServer(owner)
    await makeOpenJoinable(owner, serverId)
    for (const user of [moderator, member]) await user.call('join_discoverable_server', [serverId])
    await owner.call('set_member_role', [serverId, moderator.idArg, variant('moderator')])
    publicId = await createChannel(owner, serverId, 'public-chat')
    for (const kind of ['text', 'announcement', 'voice']) {
      await owner.call('create_channel', [serverId, `secret-${kind}`, variant(kind), some('Secret section'), true])
    }
    const { rows } = await owner.sql('SELECT id, name FROM my_channels')
    hiddenIds = rows.filter(row => String(row.name).startsWith('secret-')).map(row => Number(row.id))
    textId = Number(rows.find(row => row.name === 'secret-text')!.id)
    voiceId = Number(rows.find(row => row.name === 'secret-voice')!.id)
    await owner.call('send_message', [textId, 'private discussion'])
    await owner.call('send_message', [publicId, 'public discussion'])
    const messages = await owner.sql(`SELECT id FROM my_channel_messages WHERE channel_id = ${textId}`)
    await owner.call('pin_message', [textId, Number(messages.rows[0].id)])
    ownerConn = await connect(owner)
    memberConn = await connect(member)
    await ownerConn.reducers.joinVoiceChannel({ channelId: BigInt(voiceId) })
    await ownerConn.reducers.setTypingState({ scopeKey: `channel:${textId}`, isTyping: true })
    await new Promise<void>((resolve, reject) => {
      memberConn.subscriptionBuilder().onApplied(() => resolve()).onError(ctx => reject(ctx.event))
        .subscribe(['SELECT * FROM my_channels', 'SELECT * FROM my_channel_messages',
          'SELECT * FROM my_pinned_messages', 'SELECT * FROM my_voice_participants',
          'SELECT * FROM my_typing_states', 'SELECT * FROM my_read_states'])
    })
  })

  afterAll(() => { ownerConn?.disconnect(); memberConn?.disconnect() })

  it('exposes channel names and sections only to this space’s owner and moderators', async () => {
    for (const user of [owner, moderator, member, outsider]) {
      const { rows, error } = await user.sql('SELECT id, name, section FROM my_channels')
      expect(error).toBeNull()
      const ids = rows.map(row => Number(row.id))
      for (const id of hiddenIds) expect(ids.includes(id)).toBe(user === owner || user === moderator)
      if (user === member) {
        expect(ids).toContain(publicId)
        expect(JSON.stringify(rows)).not.toContain('Secret section')
      }
    }
  })

  it('also hides messages, pins, voice presence and typing, including direct history requests', async () => {
    await ownerConn.reducers.setTypingState({ scopeKey: `channel:${textId}`, isTyping: true })
    for (const view of ['my_channel_messages', 'my_pinned_messages', 'my_voice_participants', 'my_typing_states']) {
      expect((await moderator.sql(`SELECT * FROM ${view}`)).rows.length, view).toBeGreaterThan(0)
      const { rows, error } = await member.sql(`SELECT * FROM ${view}`)
      expect(error).toBeNull()
      expect(rows.filter(row => hiddenIds.includes(Number(row.channel_id)) || row.scope_key === `channel:${textId}`)).toEqual([])
    }
    const page = { channelId: BigInt(textId), before: Timestamp.fromDate(new Date(Date.now() + 60_000)), limit: 10 }
    expect(await memberConn.procedures.loadOlderChannelMessages(page)).toEqual([])
    expect(await memberConn.procedures.loadPinnedChannelMessages({ channelId: BigInt(textId) })).toEqual([])
    expect((await ownerConn.procedures.loadOlderChannelMessages(page)).map(row => row.content)).toEqual(['private discussion'])
    await expect(member.call('set_typing_state', [`channel:${textId}`, true])).rejects.toThrow(/moderator-only/)
    await expect(member.call('mark_channel_read', [textId])).rejects.toThrow(/moderator-only/)
  })

  it('removes protected data from an existing subscription after demotion', async () => {
    await owner.call('set_member_role', [serverId, member.idArg, variant('moderator')])
    await expect.poll(() => [...memberConn.db.my_channels.iter()].map(row => Number(row.id))).toEqual(expect.arrayContaining(hiddenIds))
    await memberConn.reducers.markChannelRead({ channelId: BigInt(textId) })
    await memberConn.reducers.setTypingState({ scopeKey: `channel:${textId}`, isTyping: true })
    await expect.poll(() => [...memberConn.db.my_pinned_messages.iter()].length).toBe(1)
    await owner.call('set_member_role', [serverId, member.idArg, variant('member')])
    await expect.poll(() => [...memberConn.db.my_channels.iter()].some(row => hiddenIds.includes(Number(row.id)))).toBe(false)
    await expect.poll(() => [...memberConn.db.my_channel_messages.iter()].map(row => row.content)).toEqual(['public discussion'])
    await expect.poll(() => [...memberConn.db.my_pinned_messages.iter()].length).toBe(0)
    await expect.poll(() => [...memberConn.db.my_voice_participants.iter()].length).toBe(0)
    await expect.poll(() => [...memberConn.db.my_typing_states.iter()].length).toBe(0)
    await expect.poll(() => [...memberConn.db.my_read_states.iter()].length).toBe(0)
    expect(await memberConn.procedures.loadPinnedChannelMessages({ channelId: BigInt(textId) })).toEqual([])
  })

  it('updates visibility when a public channel becomes moderator-only and back', async () => {
    await owner.call('update_channel', [publicId, none, some(true), none])
    await expect.poll(() => [...memberConn.db.my_channels.iter()].some(row => Number(row.id) === publicId)).toBe(false)
    await expect.poll(() => [...memberConn.db.my_channel_messages.iter()].length).toBe(0)
    await owner.call('update_channel', [publicId, none, some(false), none])
    await expect.poll(() => [...memberConn.db.my_channel_messages.iter()].map(row => row.content)).toEqual(['public discussion'])
  })
})
