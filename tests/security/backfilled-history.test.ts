import { expect, it } from 'vitest'
import { Identity } from 'spacetimedb'
import { DbConnection } from '../../src/generated'
import { startHistoryRefresh } from '../../src/lib/spacetimedb/historyRefresh'
import { mapDirectMessage, mapMessage } from '../../src/lib/spacetimedb/mappers'
import { useMessagesStore } from '../../src/stores/messagesStore'
import { useDmStore } from '../../src/stores/dmStore'
import { BASE, DB, createChannel, createServer, makeAdmin, makeFriends, makeOpenJoinable, makeUser, none, ownerSql, timestamp } from './harness'

function connect(token: string): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connect timeout')), 10_000)
    DbConnection.builder().withUri(BASE).withDatabaseName(DB).withToken(token)
      .withCompression('none').withLightMode(false)
      .onConnect(conn => { clearTimeout(timeout); resolve(conn) })
      .onConnectError((_ctx, error) => { clearTimeout(timeout); reject(error) }).build()
  })
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(check()).toBe(true)
}

it('keeps backfilled channel messages and DMs current across two real clients, deletion, reconnect and access loss', async () => {
  const writer = await makeUser('backfill_writer')
  const reader = await makeUser('backfill_reader')
  const stranger = await makeUser('backfill_stranger')
  const worker = await makeAdmin('backfill_fixture')
  const serverId = await createServer(writer)
  const channelId = await createChannel(writer, serverId)
  await makeOpenJoinable(writer, serverId)
  await reader.call('join_discoverable_server', [serverId])
  await makeFriends(writer, reader)
  await worker.call('set_archive_service_identity', [worker.idArg])
  const sockets: DbConnection[] = []
  let stop: (() => void) | undefined
  const partner = writer.identity
  const oldChannels = () => useMessagesStore.getState().olderByChannel[channelId] ?? []
  const oldDms = () => useDmStore.getState().olderByConversation[partner] ?? []
  useMessagesStore.setState({ messagesByChannel: {}, olderByChannel: {}, historyExhausted: {} })
  useDmStore.setState({ conversations: {}, olderByConversation: {}, historyExhausted: {} })
  try {
    // Seed >200 rows without depending on the clock or sending 410 reducers.
    await writer.call('send_message', [channelId, 'backfill channel seed'])
    await writer.call('send_direct_message', [reader.idArg, 'backfill dm seed'])
    const channelSeed = Number((await writer.sql('SELECT id, content FROM my_channel_messages')).rows.find(row => row.content === 'backfill channel seed')!.id)
    const dmSeed = Number((await writer.sql('SELECT id, content FROM my_direct_messages')).rows.find(row => row.content === 'backfill dm seed')!.id)
    const channels = Array.from({ length: 205 }, (_, i) => [channelSeed + i, channelId, writer.idArg, `channel-${i}`, timestamp(1_790_000_000_000_000 + i), none, false])
    const dms = Array.from({ length: 205 }, (_, i) => [dmSeed + i, writer.idArg, reader.idArg, `dm-${i}`, timestamp(1_790_000_000_000_000 + i), none, false, false])
    await worker.call('archive_restore_message', [channels])
    await worker.call('archive_restore_direct_message', [dms])
    const sender = await connect(writer.token)
    sockets.push(sender)
    let receiver = await connect(reader.token)
    sockets.push(receiver)
    const subscribe = async (conn: DbConnection) => {
      const sync = () => {
        useMessagesStore.getState().setChannelMessages(channelId, [...conn.db.my_channel_messages.iter()].map(mapMessage))
        useDmStore.getState().setConversation(partner, [...conn.db.my_direct_messages.iter()].map(mapDirectMessage))
      }
      for (const table of [conn.db.my_channel_messages, conn.db.my_direct_messages]) {
        table.onInsert(sync)
        table.onUpdate(sync)
        table.onDelete(sync)
      }
      await new Promise<void>((resolve, reject) => conn.subscriptionBuilder()
        .onApplied(() => { sync(); resolve() }).onError((_ctx, error) => reject(error))
        .subscribe(['SELECT * FROM my_channel_messages', 'SELECT * FROM my_direct_messages']))
    }
    await subscribe(receiver)
    const liveChannel = [...receiver.db.my_channel_messages.iter()].sort((a, b) => Number(a.id - b.id))
    const liveDm = [...receiver.db.my_direct_messages.iter()].sort((a, b) => Number(a.id - b.id))
    expect(liveChannel).toHaveLength(200)
    expect(liveDm).toHaveLength(200)
    useMessagesStore.getState().prependOlderMessages(channelId, (await receiver.procedures.loadOlderChannelMessagesPage({
      channelId: BigInt(channelId), before: liveChannel[0].sentAt, beforeId: liveChannel[0].id, limit: 100,
    })).map(mapMessage), true)
    useDmStore.getState().prependOlderMessages(partner, (await receiver.procedures.loadOlderDirectMessagesPage({
      partner: new Identity(partner), before: liveDm[0].sentAt, beforeId: liveDm[0].id, limit: 100,
    })).map(mapDirectMessage), true)
    expect(oldChannels()).toHaveLength(5)
    expect(oldDms()).toHaveLength(5)

    await sender.reducers.editMessage({ messageId: BigInt(channelSeed), newContent: 'edited outside window' })
    await sender.reducers.editDirectMessage({ messageId: BigInt(dmSeed), newContent: 'DM edited outside window' })
    // Reproduces the original two-client bug: neither bounded view changed.
    expect(oldChannels()[0].content).toBe('channel-0')
    expect(oldDms()[0].content).toBe('dm-0')
    stop = startHistoryRefresh(receiver)
    await until(() => oldChannels()[0]?.content === 'edited outside window' && oldDms()[0]?.content === 'DM edited outside window')

    await sender.reducers.deleteMessage({ messageId: BigInt(channelSeed) })
    await sender.reducers.deleteDirectMessage({ messageId: BigInt(dmSeed) })
    await until(() => oldChannels()[0]?.deleted === true && oldDms()[0]?.deletedBySender === true)
    await receiver.reducers.deleteDirectMessage({ messageId: BigInt(dmSeed) }) // both deleted => physical removal
    ownerSql(`DELETE FROM message WHERE id = ${channelSeed + 1}`)
    await until(() => !oldDms().some(row => row.id === dmSeed) && !oldChannels().some(row => row.id === channelSeed + 1))

    stop()
    receiver.disconnect()
    await sender.reducers.editMessage({ messageId: BigInt(channelSeed + 2), newContent: 'changed while offline' })
    receiver = await connect(reader.token)
    sockets.push(receiver)
    await subscribe(receiver)
    stop = startHistoryRefresh(receiver)
    await until(() => oldChannels().some(row => row.content === 'changed while offline'))

    // Revalidation never trusts supplied IDs or the claimed scope/partner.
    expect(await receiver.procedures.refreshChannelMessages({ channelId: BigInt(channelId + 1), messageIds: [BigInt(channelSeed)] })).toEqual([])
    expect(await receiver.procedures.refreshDirectMessages({ partner: new Identity(stranger.identity), messageIds: [BigInt(dmSeed + 1)] })).toEqual([])
    expect(await receiver.procedures.refreshChannelMessages({ channelId: BigInt(channelId), messageIds: Array(201).fill(BigInt(channelSeed)) })).toHaveLength(200)
    await receiver.reducers.leaveServer({ serverId: BigInt(serverId) })
    await until(() => oldChannels().length === 0 && useMessagesStore.getState().messagesByChannel[channelId]?.length === 0)
    expect(await receiver.procedures.refreshChannelMessages({ channelId: BigInt(channelId), messageIds: [BigInt(channelSeed)] })).toEqual([])
  } finally {
    stop?.()
    sockets.forEach(conn => conn.disconnect())
    ownerSql('DELETE FROM storage_restore_fence')
    ownerSql(`UPDATE user SET is_admin = false WHERE identity = 0x${worker.identity}`)
    useMessagesStore.setState({ messagesByChannel: {}, olderByChannel: {}, historyExhausted: {} })
    useDmStore.setState({ conversations: {}, olderByConversation: {}, historyExhausted: {} })
  }
}, 60_000)
