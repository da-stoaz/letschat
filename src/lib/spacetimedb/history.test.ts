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
