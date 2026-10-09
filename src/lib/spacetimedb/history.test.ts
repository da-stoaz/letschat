import { beforeEach, expect, it, vi } from 'vitest'
import { useMessagesStore } from '../../stores/messagesStore'
import { callProcedure } from './connection'
import { loadChannelMessage, loadOlderChannelMessages, loadPinnedChannelMessages } from './history'
import type { Message } from '../../types/domain'

vi.mock('./connection', () => ({ callProcedure: vi.fn() }))
vi.mock('./mappers', () => ({ mapMessage: (row: unknown) => row, mapDirectMessage: (row: unknown) => row, toReducerIdentity: (id: string) => id }))
const message = (id: number): Message => ({ id, channelId: 1, senderIdentity: 'me', content: String(id), sentAt: new Date(id * 1000).toISOString(), editedAt: null, deleted: false })
beforeEach(() => {
  vi.clearAllMocks()
  useMessagesStore.setState({ messagesByChannel: { 1: [message(201)] }, olderByChannel: {}, historyExhausted: {} })
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
