import { create } from 'zustand'
import type { Message, u64 } from '../types/domain'

interface MessagesState {
  messagesByChannel: Record<u64, Message[]>
  setChannelMessages: (channelId: u64, messages: Message[]) => void
  appendMessage: (message: Message) => void
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  messagesByChannel: {},
  setChannelMessages: (channelId, messages) =>
    set((state) => ({
      messagesByChannel: { ...state.messagesByChannel, [channelId]: messages },
    })),
  appendMessage: (message) => {
    const prev = get().messagesByChannel[message.channelId] ?? []
    set((state) => ({
      messagesByChannel: {
        ...state.messagesByChannel,
        [message.channelId]: [...prev, message],
      },
    }))
  },
}))
