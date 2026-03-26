import { create } from 'zustand'
import type { TypingState as TypingStateRow } from '../types/domain'

type TypingByScope = Record<string, Record<string, number>>

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase()
}

interface TypingState {
  typingByScope: TypingByScope
  setTypingRows: (rows: TypingStateRow[], ttlMs?: number) => void
  pruneExpired: (nowMs?: number) => void
  reset: () => void
}

export const useTypingStore = create<TypingState>((set) => ({
  typingByScope: {},
  setTypingRows: (rows, ttlMs = 4500) => {
    const typingByScope: TypingByScope = {}

    for (const row of rows) {
      const scopeKey = row.scopeKey
      const identityKey = normalizeIdentity(row.userIdentity)
      const updatedAtMs = Date.parse(row.updatedAt)
      if (!Number.isFinite(updatedAtMs)) continue
      const expiresAt = updatedAtMs + ttlMs
      if (expiresAt <= Date.now()) continue

      const currentScope = typingByScope[scopeKey] ?? {}
      currentScope[identityKey] = expiresAt
      typingByScope[scopeKey] = currentScope
    }

    set({ typingByScope })
  },
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
  reset: () => set({ typingByScope: {} }),
}))
