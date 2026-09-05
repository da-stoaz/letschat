import { create } from 'zustand'
import type { Message, u64 } from '../types/domain'

interface MessagesState {
  messagesByChannel: Record<u64, Message[]>
  /**
   * Pages fetched from `load_older_channel_messages`, below the window
   * `my_channel_messages` subscribes to. Held separately so the next
   * subscription sync — which replaces the live window wholesale — cannot drop
   * them again.
   */
  olderByChannel: Record<u64, Message[]>
  /** Channels the server has no more history for. */
  historyExhausted: Record<u64, boolean>
  setChannelMessages: (channelId: u64, messages: Message[]) => void
  prependOlderMessages: (channelId: u64, older: Message[], exhausted: boolean) => void
  appendMessage: (message: Message) => void
}

/** Union of a backfilled page and the live window, oldest first; live wins ties. */
function mergeHistory(older: Message[] | undefined, live: Message[]): Message[] {
  if (!older || older.length === 0) return live
  const byId = new Map<number, Message>()
  for (const message of older) byId.set(message.id, message)
  for (const message of live) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}

function areMessagesEqual(a: Message[], b: Message[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (
      left.id !== right.id ||
      left.channelId !== right.channelId ||
      left.senderIdentity !== right.senderIdentity ||
      left.content !== right.content ||
      left.sentAt !== right.sentAt ||
      left.editedAt !== right.editedAt ||
      left.deleted !== right.deleted
    ) {
      return false
    }
  }
  return true
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  messagesByChannel: {},
  olderByChannel: {},
  historyExhausted: {},
  setChannelMessages: (channelId, messages) =>
    set((state) => {
      const merged = mergeHistory(state.olderByChannel[channelId], messages)
      const current = state.messagesByChannel[channelId] ?? []
      if (areMessagesEqual(current, merged)) return state
      return {
        messagesByChannel: { ...state.messagesByChannel, [channelId]: merged },
      }
    }),
  prependOlderMessages: (channelId, older, exhausted) =>
    set((state) => {
      const nextOlder = mergeHistory(state.olderByChannel[channelId], older)
      return {
        olderByChannel: { ...state.olderByChannel, [channelId]: nextOlder },
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: mergeHistory(nextOlder, state.messagesByChannel[channelId] ?? []),
        },
        historyExhausted: { ...state.historyExhausted, [channelId]: exhausted },
      }
    }),
  appendMessage: (message) => {
    const prev = get().messagesByChannel[message.channelId] ?? []
    const idx = prev.findIndex((row) => row.id === message.id)

    if (idx >= 0) {
      if (areMessagesEqual([prev[idx]], [message])) return
      const next = [...prev]
      next[idx] = message
      set((state) => ({
        messagesByChannel: {
          ...state.messagesByChannel,
          [message.channelId]: next,
        },
      }))
      return
    }

    set((state) => ({
      messagesByChannel: {
        ...state.messagesByChannel,
        [message.channelId]: [...prev, message],
      },
    }))
  },
}))
