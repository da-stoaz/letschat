import { create } from 'zustand'
import type { PinnedMessage, u64 } from '../types/domain'

interface PinsState {
  pinsByChannel: Record<u64, PinnedMessage[]>
  setChannelPins: (channelId: u64, pins: PinnedMessage[]) => void
}

function arePinsEqual(a: PinnedMessage[], b: PinnedMessage[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].pinId !== b[i].pinId || a[i].messageId !== b[i].messageId) return false
  }
  return true
}

export const usePinsStore = create<PinsState>((set) => ({
  pinsByChannel: {},
  setChannelPins: (channelId, pins) =>
    set((state) => {
      const current = state.pinsByChannel[channelId] ?? []
      if (arePinsEqual(current, pins)) return state
      return { pinsByChannel: { ...state.pinsByChannel, [channelId]: pins } }
    }),
}))
