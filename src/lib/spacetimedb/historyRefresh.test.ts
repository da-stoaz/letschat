import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Identity, Timestamp } from 'spacetimedb'
import type { DbConnection } from '../../generated'
import { useMessagesStore } from '../../stores/messagesStore'
import { useDmStore } from '../../stores/dmStore'
import { mapDirectMessage, mapMessage } from './mappers'
import { startHistoryRefresh } from './historyRefresh'

const me = new Identity('a'.repeat(64))
const partner = new Identity('b'.repeat(64))
const key = partner.toHexString()
const channelRow = (id: number, content = `message ${id}`) => ({
  id: BigInt(id), channelId: 1n, senderIdentity: me, content,
  sentAt: new Timestamp(BigInt(id) * 1000n), editedAt: undefined, deleted: false,
})
const dmRow = (id: number, content = `dm ${id}`) => ({
  ...channelRow(id, content), recipientIdentity: partner,
  deletedBySender: false, deletedByRecipient: false,
})
const stops: (() => void)[] = []
function fixture() {
  const channelLive = [channelRow(999)]
  const dmLive = [dmRow(999)]
  const procedures = { refreshChannelMessages: vi.fn(), refreshDirectMessages: vi.fn() }
  const conn = {
    isActive: true, identity: me, procedures,
    db: { my_channel_messages: { iter: () => channelLive.values() }, my_direct_messages: { iter: () => dmLive.values() } },
  } as unknown as DbConnection
  return { conn, procedures, channelLive, dmLive }
}
beforeEach(() => {
  vi.useFakeTimers()
  useMessagesStore.setState({ messagesByChannel: {}, olderByChannel: {}, historyExhausted: {} })
  useDmStore.setState({ conversations: {}, olderByConversation: {}, historyExhausted: {} })
})
afterEach(() => {
  stops.splice(0).forEach(stop => stop())
  vi.useRealTimers()
})

it('refreshes channel/DM edits and deletion flags, removes hard deletions, and retains other pages', async () => {
  const { conn, procedures } = fixture()
  useMessagesStore.getState().prependOlderMessages(1, [1, 2].map(id => mapMessage(channelRow(id))), true)
  useDmStore.getState().prependOlderMessages(key, [1, 2].map(id => mapDirectMessage(dmRow(id))), true)
  procedures.refreshChannelMessages.mockResolvedValueOnce([{ ...channelRow(1, 'edited'), editedAt: new Timestamp(5000n) }])
  procedures.refreshDirectMessages.mockResolvedValueOnce([{ ...dmRow(1, 'edited dm'), editedAt: new Timestamp(5000n), deletedByRecipient: true }])
  stops.push(startHistoryRefresh(conn))
  await vi.advanceTimersByTimeAsync(0)
  expect(useMessagesStore.getState().messagesByChannel[1].map(row => row.content)).toEqual(['edited', 'message 999'])
  expect(useDmStore.getState().conversations[key][0]).toMatchObject({ content: 'edited dm', deletedByRecipient: true })
  expect(useDmStore.getState().conversations[key].map(row => row.id)).toEqual([1, 999])

  procedures.refreshChannelMessages.mockResolvedValueOnce([{ ...channelRow(1, '[message deleted]'), deleted: true }])
  procedures.refreshDirectMessages.mockResolvedValueOnce([])
  await vi.advanceTimersByTimeAsync(5000)
  expect(useMessagesStore.getState().olderByChannel[1][0].deleted).toBe(true)
  expect(useDmStore.getState().conversations[key].map(row => row.id)).toEqual([999])
  expect(useMessagesStore.getState().historyExhausted[1]).toBe(false)
})

it('sends nothing without backfill and bounds large caches to batches of 200', async () => {
  const { conn, procedures } = fixture()
  stops.push(startHistoryRefresh(conn))
  await vi.advanceTimersByTimeAsync(0)
  expect(procedures.refreshChannelMessages).not.toHaveBeenCalled()
  expect(procedures.refreshDirectMessages).not.toHaveBeenCalled()
  const rows = Array.from({ length: 405 }, (_, i) => channelRow(i + 1))
  useMessagesStore.getState().prependOlderMessages(1, rows.map(mapMessage), false)
  procedures.refreshChannelMessages.mockImplementation(async ({ messageIds }) => rows.filter(row => messageIds.includes(row.id)))
  await vi.advanceTimersByTimeAsync(5000)
  expect(procedures.refreshChannelMessages.mock.calls.map(([args]) => args.messageIds.length)).toEqual([200, 200, 5])
  expect(useMessagesStore.getState().olderByChannel[1]).toHaveLength(405)
  const unchanged = useMessagesStore.getState().messagesByChannel[1]
  await vi.advanceTimersByTimeAsync(5000)
  expect(useMessagesStore.getState().messagesByChannel[1]).toBe(unchanged)
})

it('ignores in-flight responses after stop and revalidates retained history immediately on reconnect', async () => {
  const { conn, procedures } = fixture()
  useMessagesStore.getState().prependOlderMessages(1, [mapMessage(channelRow(1))], false)
  let finish!: (rows: ReturnType<typeof channelRow>[]) => void
  procedures.refreshChannelMessages.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const stop = startHistoryRefresh(conn)
  stop()
  useMessagesStore.setState({ messagesByChannel: {}, olderByChannel: {}, historyExhausted: {} })
  finish([channelRow(1, 'old connection')])
  await vi.advanceTimersByTimeAsync(0)
  expect(useMessagesStore.getState().messagesByChannel).toEqual({})
  useMessagesStore.getState().prependOlderMessages(1, [mapMessage(channelRow(1))], false)
  procedures.refreshChannelMessages.mockResolvedValueOnce([channelRow(1, 'after reconnect')])
  stops.push(startHistoryRefresh(conn))
  await vi.advanceTimersByTimeAsync(0)
  expect(useMessagesStore.getState().olderByChannel[1][0].content).toBe('after reconnect')
})

it('retains cached content on transport failure and retries; missing procedures stop probing an older module', async () => {
  const { conn, procedures } = fixture()
  useMessagesStore.getState().prependOlderMessages(1, [mapMessage(channelRow(1))], true)
  procedures.refreshChannelMessages.mockRejectedValueOnce(new Error('connection lost'))
  procedures.refreshChannelMessages.mockResolvedValueOnce([channelRow(1, 'recovered')])
  procedures.refreshChannelMessages.mockRejectedValueOnce('No such procedure')
  stops.push(startHistoryRefresh(conn))
  await vi.advanceTimersByTimeAsync(0)
  expect(useMessagesStore.getState().olderByChannel[1][0].content).toBe('message 1')
  await vi.advanceTimersByTimeAsync(5000)
  expect(useMessagesStore.getState().olderByChannel[1][0].content).toBe('recovered')
  await vi.advanceTimersByTimeAsync(15_000)
  expect(procedures.refreshChannelMessages).toHaveBeenCalledTimes(3)
})

it('does not let an older refresh overwrite a live update or a newly loaded page', async () => {
  const { conn, procedures, channelLive } = fixture()
  useMessagesStore.getState().prependOlderMessages(1, [mapMessage(channelRow(1))], false)
  let finish!: (rows: ReturnType<typeof channelRow>[]) => void
  procedures.refreshChannelMessages.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  stops.push(startHistoryRefresh(conn))
  channelLive.push(channelRow(1, 'newer live edit'))
  useMessagesStore.getState().setChannelMessages(1, channelLive.map(mapMessage))
  useMessagesStore.getState().prependOlderMessages(1, [mapMessage(channelRow(0))], true)
  finish([channelRow(1, 'stale response')])
  await vi.advanceTimersByTimeAsync(0)
  expect(useMessagesStore.getState().olderByChannel[1].map(row => row.content)).toEqual(['message 0', 'newer live edit'])
  channelLive.splice(1) // the updated row leaves the recent window again
  useMessagesStore.getState().setChannelMessages(1, channelLive.map(mapMessage))
  expect(useMessagesStore.getState().messagesByChannel[1][1].content).toBe('newer live edit')
})

it('keeps other DM conversations out of a refreshed note-to-self thread', async () => {
  const { conn, procedures, dmLive } = fixture()
  const own = me.toHexString()
  const note = { ...dmRow(1), recipientIdentity: me }
  useDmStore.getState().prependOlderMessages(own, [mapDirectMessage(note)], false)
  dmLive.push({ ...dmRow(2), recipientIdentity: me })
  procedures.refreshDirectMessages.mockResolvedValueOnce([note])
  stops.push(startHistoryRefresh(conn))
  await vi.advanceTimersByTimeAsync(0)
  expect(useDmStore.getState().conversations[own].map(row => row.id)).toEqual([1, 2])
})
