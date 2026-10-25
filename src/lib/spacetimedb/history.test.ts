import { beforeEach, expect, it, vi } from 'vitest'
import { Timestamp } from 'spacetimedb'
import { useDmStore } from '../../stores/dmStore'
import { mapDirectMessage, mapMessage, type DbRow } from './mappers'
import { useMessagesStore } from '../../stores/messagesStore'
import { callProcedure } from './connection'
import { cancelHistoryRequests, loadChannelMessage, loadOlderChannelMessages, loadOlderDirectMessages, loadPinnedChannelMessages } from './history'
import type { Message } from '../../types/domain'

vi.mock('./connection', () => ({ callProcedure: vi.fn() }))
const message = (id: number): Message => ({ id, channelId: 1, senderIdentity: 'me', content: String(id), sentAt: new Date(id * 1000).toISOString(), editedAt: null, deleted: false })
beforeEach(() => {
  cancelHistoryRequests()
  vi.resetAllMocks()
  useDmStore.setState({ conversations: {}, olderByConversation: {}, historyExhausted: {} })
  useMessagesStore.setState({ messagesByChannel: { 1: [message(201)] }, olderByChannel: {}, historyExhausted: {} })
})

it('discards a page from a disconnected session without cancelling a newer request', async () => {
  let finishOld!: (rows: Message[]) => void
  let finishNew!: (rows: Message[]) => void
  vi.mocked(callProcedure)
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
  const old = loadOlderChannelMessages(1)
  cancelHistoryRequests()
  const current = loadOlderChannelMessages(1)
  finishOld([message(1)])
  await old
  expect(useMessagesStore.getState().olderByChannel).toEqual({})
  const concurrent = loadOlderChannelMessages(1)
  expect(callProcedure).toHaveBeenCalledTimes(2)
  finishNew([message(200)])
  await Promise.all([current, concurrent])
  expect(useMessagesStore.getState().olderByChannel[1].map(row => row.id)).toEqual([200])
})

it('shares in-flight history, allows retry after failure, and keeps pin previews out of the paging cursor', async () => {
  let fail!: (error: Error) => void
  vi.mocked(callProcedure).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
  const first = loadOlderChannelMessages(1)
  const second = loadOlderChannelMessages(1)
  expect(callProcedure).toHaveBeenCalledTimes(1)
  fail(new Error('Offline'))
  await expect(first).rejects.toThrow('Offline')
  await expect(second).rejects.toThrow('Offline')
  vi.mocked(callProcedure).mockResolvedValueOnce([message(1)])
  expect(await loadPinnedChannelMessages(1)).toEqual([message(1)])
  expect(useMessagesStore.getState().messagesByChannel[1]).toEqual([message(201)])
  vi.mocked(callProcedure).mockResolvedValueOnce([message(200)])
  await loadChannelMessage(1, 200)
  expect(useMessagesStore.getState().messagesByChannel[1].map(row => row.id)).toEqual([200, 201])
})

it('uses the completed page as the cursor for the next page when jumping to an old message', async () => {
  let finishPage!: (rows: Message[]) => void
  vi.mocked(callProcedure).mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve }))
  vi.mocked(callProcedure).mockResolvedValueOnce([message(1)])
  const jump = loadChannelMessage(1, 1)
  expect(callProcedure).toHaveBeenCalledTimes(1)
  finishPage(Array.from({ length: 100 }, (_, index) => message(index + 101)))
  await jump
  expect(callProcedure).toHaveBeenCalledTimes(2)
  expect(vi.mocked(callProcedure).mock.calls.map(([, args]) => (args.before as { toDate(): Date }).toDate().getTime())).toEqual([201000, 101000])
  expect(useMessagesStore.getState().messagesByChannel[1].map(row => row.id)).toEqual([1, ...Array.from({ length: 101 }, (_, index) => index + 101)])
})

it.each(['channel', 'dm'])('pages every %s message across microseconds and equal timestamps without duplicates', async kind => {
  const partner = 'a'.repeat(64)
  const base = 1_790_000_000_000_000n
  const raw = Array.from({ length: 205 }, (_, index) => ({
    ...message(index + 1), recipientIdentity: partner,
    sentAt: new Timestamp(base + (index < 150 ? 123n : 456n)),
  }))
  const live = raw.slice(-5).reverse()
  if (kind === 'channel') useMessagesStore.getState().setChannelMessages(1, live.map(mapMessage))
  else useDmStore.getState().setConversation(partner, live.map(mapDirectMessage))

  vi.mocked(callProcedure).mockImplementation(async (_name, args) => {
    const before = (args.before as Timestamp).microsSinceUnixEpoch
    const id = args.beforeId as bigint
    return raw.filter(row => row.sentAt.microsSinceUnixEpoch < before
      || (row.sentAt.microsSinceUnixEpoch === before && BigInt(row.id) < id)).slice(-Number(args.limit)) as DbRow[]
  })
  const load = () => kind === 'channel' ? loadOlderChannelMessages(1) : loadOlderDirectMessages(partner)
  await load()
  await load()
  await load()
  expect(vi.mocked(callProcedure).mock.calls.map(([name, args]) => [name, (args.before as Timestamp).microsSinceUnixEpoch, args.beforeId])).toEqual([
    [kind === 'channel' ? 'loadOlderChannelMessagesPage' : 'loadOlderDirectMessagesPage', base + 456n, 201n],
    [kind === 'channel' ? 'loadOlderChannelMessagesPage' : 'loadOlderDirectMessagesPage', base + 123n, 101n],
    [kind === 'channel' ? 'loadOlderChannelMessagesPage' : 'loadOlderDirectMessagesPage', base + 123n, 1n],
  ])
  const rows = kind === 'channel' ? useMessagesStore.getState().messagesByChannel[1] : useDmStore.getState().conversations[partner]
  expect(rows.map(row => row.id)).toEqual(raw.map(row => row.id))
  const exhausted = kind === 'channel' ? useMessagesStore.getState().historyExhausted[1] : useDmStore.getState().historyExhausted[partner]
  expect(exhausted).toBe(true)
})

it('uses the legacy timestamp procedure only when the server lacks the cursor procedure', async () => {
  vi.mocked(callProcedure).mockRejectedValueOnce('No such procedure')
  vi.mocked(callProcedure).mockResolvedValueOnce([])
  await loadOlderChannelMessages(1)
  expect(vi.mocked(callProcedure).mock.calls.map(([name]) => name)).toEqual(['loadOlderChannelMessagesPage', 'loadOlderChannelMessages'])
  expect(vi.mocked(callProcedure).mock.calls[1][1]).not.toHaveProperty('beforeId')
})

it.each(['timeout', 'permission denied'])('keeps %s failures retryable without claiming history is exhausted', async error => {
  vi.mocked(callProcedure).mockRejectedValueOnce(new Error(error))
  await expect(loadOlderChannelMessages(1)).rejects.toThrow(error)
  expect(callProcedure).toHaveBeenCalledTimes(1)
  expect(useMessagesStore.getState().historyExhausted[1]).toBeUndefined()
  vi.mocked(callProcedure).mockResolvedValueOnce([])
  await loadOlderChannelMessages(1)
  expect(useMessagesStore.getState().historyExhausted[1]).toBe(true)
})
