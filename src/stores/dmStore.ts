import { create } from 'zustand'
import type { DirectMessage, Identity } from '../types/domain'

interface DmState {
  conversations: Record<Identity, DirectMessage[]>
  setConversation: (identity: Identity, messages: DirectMessage[]) => void
  appendMessage: (identity: Identity, message: DirectMessage) => void
}

function areDirectMessagesEqual(a: DirectMessage[], b: DirectMessage[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (
      left.id !== right.id ||
      left.senderIdentity !== right.senderIdentity ||
      left.recipientIdentity !== right.recipientIdentity ||
      left.content !== right.content ||
      left.sentAt !== right.sentAt ||
      left.deletedBySender !== right.deletedBySender ||
      left.deletedByRecipient !== right.deletedByRecipient
    ) {
      return false
    }
  }
  return true
}

export const useDmStore = create<DmState>((set, get) => ({
  conversations: {},
  setConversation: (identity, messages) =>
    set((state) => {
      const current = state.conversations[identity] ?? []
      if (areDirectMessagesEqual(current, messages)) return state
      return {
        conversations: { ...state.conversations, [identity]: messages },
      }
    }),
  appendMessage: (identity, message) => {
    const prev = get().conversations[identity] ?? []
    const idx = prev.findIndex((row) => row.id === message.id)
    if (idx >= 0) {
      const current = prev[idx]
      if (
        current.senderIdentity === message.senderIdentity &&
        current.recipientIdentity === message.recipientIdentity &&
        current.content === message.content &&
        current.sentAt === message.sentAt &&
        current.deletedBySender === message.deletedBySender &&
        current.deletedByRecipient === message.deletedByRecipient
      ) {
        return
      }
      const next = [...prev]
      next[idx] = message
      set((state) => ({
        conversations: { ...state.conversations, [identity]: next },
      }))
      return
    }

    set((state) => ({
      conversations: { ...state.conversations, [identity]: [...prev, message] },
    }))
  },
}))
