import { create } from 'zustand'
import type { Identity } from '../types/domain'

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase()
}

interface PresenceState {
  nowMs: number
  lastSeenByIdentity: Record<string, number>
  lastActiveByIdentity: Record<string, number>
  setNowMs: (nowMs: number) => void
  touchSeen: (identity: Identity, atMs?: number) => void
  touchActive: (identity: Identity, atMs?: number) => void
  reset: () => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  nowMs: Date.now(),
  lastSeenByIdentity: {},
  lastActiveByIdentity: {},
  setNowMs: (nowMs) => set((state) => (state.nowMs === nowMs ? state : { nowMs })),
  touchSeen: (identity, atMs) =>
    set((state) => {
      const key = normalizeIdentity(identity)
      const nextAt = atMs ?? Date.now()
      const previous = state.lastSeenByIdentity[key] ?? 0
      if (nextAt <= previous) return state
      return {
        lastSeenByIdentity: {
          ...state.lastSeenByIdentity,
          [key]: nextAt,
        },
      }
    }),
  touchActive: (identity, atMs) =>
    set((state) => {
      const key = normalizeIdentity(identity)
      const nextAt = atMs ?? Date.now()
      const previousSeen = state.lastSeenByIdentity[key] ?? 0
      const previousActive = state.lastActiveByIdentity[key] ?? 0
      if (nextAt <= previousSeen && nextAt <= previousActive) return state
      return {
        lastSeenByIdentity: {
          ...state.lastSeenByIdentity,
          [key]: Math.max(previousSeen, nextAt),
        },
        lastActiveByIdentity: {
          ...state.lastActiveByIdentity,
          [key]: Math.max(previousActive, nextAt),
        },
      }
    }),
  reset: () =>
    set({
      nowMs: Date.now(),
      lastSeenByIdentity: {},
      lastActiveByIdentity: {},
    }),
}))

