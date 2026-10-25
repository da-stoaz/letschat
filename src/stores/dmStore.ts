import { refreshCachedRows, updateCachedRows } from './historyCache'
import { compareMessages } from '../lib/messageOrder'
import { create } from 'zustand'
import type { DirectMessage, Identity } from '../types/domain'

interface DmState {
  conversations: Record<Identity, DirectMessage[]>
  /** Backfilled pages below the subscription window — see `messagesStore`. */
  olderByConversation: Record<Identity, DirectMessage[]>
  /** Conversations the server has no more history for. */
  historyExhausted: Record<Identity, boolean>
  setConversation: (identity: Identity, messages: DirectMessage[]) => void
  prependOlderMessages: (identity: Identity, older: DirectMessage[], exhausted: boolean) => void
  refreshOlderMessages: (identity: Identity, requested: DirectMessage[], refreshed: DirectMessage[], live: DirectMessage[]) => void
  appendMessage: (identity: Identity, message: DirectMessage) => void
}

/** Union of a backfilled page and the live window, oldest first; live wins ties. */
function mergeHistory(older: DirectMessage[] | undefined, live: DirectMessage[]): DirectMessage[] {
  if (!older || older.length === 0) return [...live].sort(compareMessages)
  const byId = new Map<number, DirectMessage>()
  for (const message of older) byId.set(message.id, message)
  for (const message of live) byId.set(message.id, message)
  return [...byId.values()].sort(compareMessages)
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
      left.editedAt !== right.editedAt ||
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
  olderByConversation: {},
  historyExhausted: {},
  setConversation: (identity, messages) =>
    set((state) => {
      const older = updateCachedRows(state.olderByConversation[identity] ?? [], messages)
      const merged = mergeHistory(older, messages)
      const current = state.conversations[identity] ?? []
      if (areDirectMessagesEqual(current, merged) && areDirectMessagesEqual(state.olderByConversation[identity] ?? [], older)) return state
      return {
        olderByConversation: { ...state.olderByConversation, [identity]: older },
        conversations: { ...state.conversations, [identity]: merged },
      }
    }),
  prependOlderMessages: (identity, older, exhausted) =>
    set((state) => {
      const nextOlder = mergeHistory(state.olderByConversation[identity], older)
      return {
        olderByConversation: { ...state.olderByConversation, [identity]: nextOlder },
        conversations: {
          ...state.conversations,
          [identity]: mergeHistory(nextOlder, state.conversations[identity] ?? []),
        },
        historyExhausted: { ...state.historyExhausted, [identity]: exhausted },
      }
    }),
  refreshOlderMessages: (identity, requested, refreshed, live) =>
    set((state) => {
      const older = updateCachedRows(refreshCachedRows(state.olderByConversation[identity] ?? [], requested, refreshed), live)
      const merged = mergeHistory(older, live)
      const exhausted = refreshed.length < requested.length ? false : state.historyExhausted[identity]
      if (areDirectMessagesEqual(state.olderByConversation[identity] ?? [], older)
        && areDirectMessagesEqual(state.conversations[identity] ?? [], merged)
        && state.historyExhausted[identity] === exhausted) return state
      return {
        olderByConversation: { ...state.olderByConversation, [identity]: older },
        historyExhausted: { ...state.historyExhausted, [identity]: exhausted },
        conversations: { ...state.conversations, [identity]: merged },
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
        current.editedAt === message.editedAt &&
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
