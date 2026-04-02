import { create } from 'zustand'
import type { ReadState } from '../types/domain'

interface ReadStore {
  rowsByScope: Record<string, ReadState>
  setReadRows: (rows: ReadState[]) => void
  getLastReadAt: (scopeKey: string) => string | null
  reset: () => void
}

export const useReadStore = create<ReadStore>()((set, get) => ({
  rowsByScope: {},
  setReadRows: (rows) =>
    set((state) => {
      const next: Record<string, ReadState> = {}
      for (const row of rows) {
        const existing = state.rowsByScope[row.scopeKey]
        if (!existing || Date.parse(row.lastReadAt) >= Date.parse(existing.lastReadAt)) {
          next[row.scopeKey] = row
        } else {
          next[row.scopeKey] = existing
        }
      }
      return { rowsByScope: next }
    }),
  getLastReadAt: (scopeKey) => get().rowsByScope[scopeKey]?.lastReadAt ?? null,
  reset: () => set({ rowsByScope: {} }),
}))
