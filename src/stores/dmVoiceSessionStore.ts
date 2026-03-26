import { create } from 'zustand'
import type { Room } from 'livekit-client'
import type { Identity } from '../types/domain'

interface DmVoiceSessionState {
  room: Room | null
  joinedPartnerIdentity: Identity | null
  joining: boolean
  error: string | null
  setRoom: (room: Room | null) => void
  setJoinedPartnerIdentity: (identity: Identity | null) => void
  setJoining: (joining: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

export const useDmVoiceSessionStore = create<DmVoiceSessionState>((set) => ({
  room: null,
  joinedPartnerIdentity: null,
  joining: false,
  error: null,
  setRoom: (room) => set((state) => (state.room === room ? state : { room })),
  setJoinedPartnerIdentity: (joinedPartnerIdentity) =>
    set((state) =>
      state.joinedPartnerIdentity === joinedPartnerIdentity ? state : { joinedPartnerIdentity },
    ),
  setJoining: (joining) => set((state) => (state.joining === joining ? state : { joining })),
  setError: (error) => set((state) => (state.error === error ? state : { error })),
  reset: () => set({ room: null, joinedPartnerIdentity: null, joining: false, error: null }),
}))
