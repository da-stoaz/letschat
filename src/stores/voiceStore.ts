import { create } from 'zustand'
import type { VoiceParticipant, u64 } from '../types/domain'

interface VoiceState {
  participantsByChannel: Record<u64, VoiceParticipant[]>
  activeChannelId: u64 | null
  localTracks: unknown[]
  setParticipants: (channelId: u64, participants: VoiceParticipant[]) => void
  setActiveChannelId: (channelId: u64 | null) => void
  setLocalTracks: (tracks: unknown[]) => void
}

export const useVoiceStore = create<VoiceState>((set) => ({
  participantsByChannel: {},
  activeChannelId: null,
  localTracks: [],
  setParticipants: (channelId, participants) =>
    set((state) => ({
      participantsByChannel: { ...state.participantsByChannel, [channelId]: participants },
    })),
  setActiveChannelId: (channelId) => set({ activeChannelId: channelId }),
  setLocalTracks: (tracks) => set({ localTracks: tracks }),
}))
