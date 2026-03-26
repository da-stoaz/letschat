import { create } from 'zustand'
import type { Room } from 'livekit-client'
import type { u64 } from '../types/domain'

interface VoiceSessionState {
  room: Room | null
  joinedChannelId: u64 | null
  joining: boolean
  error: string | null
  setRoom: (room: Room | null) => void
  setJoinedChannelId: (channelId: u64 | null) => void
  setJoining: (joining: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

export const useVoiceSessionStore = create<VoiceSessionState>((set) => ({
  room: null,
  joinedChannelId: null,
  joining: false,
  error: null,
  setRoom: (room) => set((state) => (state.room === room ? state : { room })),
  setJoinedChannelId: (joinedChannelId) =>
    set((state) => (state.joinedChannelId === joinedChannelId ? state : { joinedChannelId })),
  setJoining: (joining) => set((state) => (state.joining === joining ? state : { joining })),
  setError: (error) => set((state) => (state.error === error ? state : { error })),
  reset: () => set({ room: null, joinedChannelId: null, joining: false, error: null }),
}))
