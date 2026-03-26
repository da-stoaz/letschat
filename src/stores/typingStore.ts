import { create } from 'zustand'
import type { Identity } from '../types/domain'

type TypingByScope = Record<string, Record<string, number>>

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase()
}

interface TypingState {
  typingByScope: TypingByScope
  setTyping: (scopeKey: string, identity: Identity, isTyping: boolean, ttlMs?: number) => void
  clearIdentity: (identity: Identity) => void
  pruneExpired: (nowMs?: number) => void
}

export const useTypingStore = create<TypingState>((set) => ({
  typingByScope: {},
  setTyping: (scopeKey, identity, isTyping, ttlMs = 4500) =>
    set((state) => {
      const key = normalizeIdentity(identity)
      const currentScope = state.typingByScope[scopeKey] ?? {}
      if (isTyping) {
        const expiresAt = Date.now() + ttlMs
        if ((currentScope[key] ?? 0) >= expiresAt) return state
        return {
          typingByScope: {
            ...state.typingByScope,
            [scopeKey]: {
              ...currentScope,
              [key]: expiresAt,
            },
          },
        }
      }

      if (!(key in currentScope)) return state
      const nextScope = { ...currentScope }
      delete nextScope[key]
      const nextTypingByScope = { ...state.typingByScope }
      if (Object.keys(nextScope).length === 0) {
        delete nextTypingByScope[scopeKey]
      } else {
        nextTypingByScope[scopeKey] = nextScope
      }
      return { typingByScope: nextTypingByScope }
    }),
  clearIdentity: (identity) =>
    set((state) => {
      const key = normalizeIdentity(identity)
      let changed = false
      const next: TypingByScope = {}
      for (const [scopeKey, entries] of Object.entries(state.typingByScope)) {
        if (!(key in entries)) {
          next[scopeKey] = entries
          continue
        }
        const copy = { ...entries }
        delete copy[key]
        changed = true
        if (Object.keys(copy).length > 0) {
          next[scopeKey] = copy
        }
      }
      return changed ? { typingByScope: next } : state
    }),
  pruneExpired: (nowMs = Date.now()) =>
    set((state) => {
      let changed = false
      const next: TypingByScope = {}
      for (const [scopeKey, entries] of Object.entries(state.typingByScope)) {
        const filtered = Object.fromEntries(
          Object.entries(entries).filter(([, expiresAt]) => expiresAt > nowMs),
        )
        if (Object.keys(filtered).length > 0) {
          next[scopeKey] = filtered
        }
        if (Object.keys(filtered).length !== Object.keys(entries).length) {
          changed = true
        }
      }
      return changed ? { typingByScope: next } : state
    }),
}))
