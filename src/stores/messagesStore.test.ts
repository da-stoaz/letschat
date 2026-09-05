import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { Message } from '../types/domain'

function message(id: number, sentAt: string, content = `m${id}`): Message {
  return {
    id,
    channelId: 1,
    senderIdentity: '0xabc',
    content,
    sentAt,
    editedAt: null,
    deleted: false,
  }
}

const live = [message(3, '2026-09-01T10:00:00.000Z'), message(4, '2026-09-01T11:00:00.000Z')]
const older = [message(1, '2026-08-01T10:00:00.000Z'), message(2, '2026-08-01T11:00:00.000Z')]

describe('messagesStore history backfill', () => {
  beforeEach(() => {
    useMessagesStore.setState({ messagesByChannel: {}, olderByChannel: {}, historyExhausted: {} })
  })

  it('keeps a backfilled page when the subscription syncs again', () => {
    const store = useMessagesStore.getState()
    store.setChannelMessages(1, live)
    store.prependOlderMessages(1, older, false)

    // A resync replaces the live window wholesale — the older page must survive.
    useMessagesStore.getState().setChannelMessages(1, live)

    expect(useMessagesStore.getState().messagesByChannel[1].map((m) => m.id)).toEqual([1, 2, 3, 4])
  })

  it('lets the live row win when a page overlaps it', () => {
    const store = useMessagesStore.getState()
    store.setChannelMessages(1, [message(2, '2026-08-01T11:00:00.000Z', 'edited'), ...live])
    store.prependOlderMessages(1, older, false)

    const rows = useMessagesStore.getState().messagesByChannel[1]
    expect(rows.map((m) => m.id)).toEqual([1, 2, 3, 4])
    expect(rows.find((m) => m.id === 2)?.content).toBe('edited')
  })

  it('records exhaustion so the feed stops asking', () => {
    useMessagesStore.getState().setChannelMessages(1, live)
    useMessagesStore.getState().prependOlderMessages(1, older, true)

    expect(useMessagesStore.getState().historyExhausted[1]).toBe(true)
  })
})
