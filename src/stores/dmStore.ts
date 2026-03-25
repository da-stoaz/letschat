import { create } from 'zustand'
import type { DirectMessage, Identity } from '../types/domain'

interface DmState {
  conversations: Record<Identity, DirectMessage[]>
  setConversation: (identity: Identity, messages: DirectMessage[]) => void
  appendMessage: (identity: Identity, message: DirectMessage) => void
}

export const useDmStore = create<DmState>((set, get) => ({
  conversations: {},
  setConversation: (identity, messages) =>
    set((state) => ({
      conversations: { ...state.conversations, [identity]: messages },
    })),
  appendMessage: (identity, message) => {
    const prev = get().conversations[identity] ?? []
    set((state) => ({
      conversations: { ...state.conversations, [identity]: [...prev, message] },
    }))
  },
}))
