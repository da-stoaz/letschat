import { create } from 'zustand'
import type { Message, u64 } from '../types/domain'

interface MessagesState {
  messagesByChannel: Record<u64, Message[]>
  setChannelMessages: (channelId: u64, messages: Message[]) => void
  appendMessage: (message: Message) => void
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
  setChannelMessages: (channelId, messages) =>
    set((state) => {
      const current = state.messagesByChannel[channelId] ?? []
      if (areMessagesEqual(current, messages)) return state
      return {
        messagesByChannel: { ...state.messagesByChannel, [channelId]: messages },
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
