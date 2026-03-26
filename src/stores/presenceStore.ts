import { create } from 'zustand'
import type { PresenceState as PresenceStateRow } from '../types/domain'

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase()
}

interface PresenceState {
  nowMs: number
  onlineByIdentity: Record<string, boolean>
  lastActiveByIdentity: Record<string, number>
  setNowMs: (nowMs: number) => void
  setPresenceRows: (rows: PresenceStateRow[]) => void
  reset: () => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  nowMs: Date.now(),
  onlineByIdentity: {},
  lastActiveByIdentity: {},
  setNowMs: (nowMs) => set((state) => (state.nowMs === nowMs ? state : { nowMs })),
  setPresenceRows: (rows) => {
    const onlineByIdentity: Record<string, boolean> = {}
    const lastActiveByIdentity: Record<string, number> = {}

    for (const row of rows) {
      const key = normalizeIdentity(row.identity)
      onlineByIdentity[key] = row.online
      const activeAtMs = Date.parse(row.lastInteractionAt)
      if (Number.isFinite(activeAtMs)) {
        lastActiveByIdentity[key] = activeAtMs
      }
    }

    set({ onlineByIdentity, lastActiveByIdentity })
  },
  reset: () =>
    set({
      nowMs: Date.now(),
      onlineByIdentity: {},
      lastActiveByIdentity: {},
    }),
}))
