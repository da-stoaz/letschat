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

function areParticipantsEqual(a: VoiceParticipant[], b: VoiceParticipant[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (
      left.channelId !== right.channelId ||
      left.userIdentity !== right.userIdentity ||
      left.joinedAt !== right.joinedAt ||
      left.muted !== right.muted ||
      left.deafened !== right.deafened ||
      left.sharingScreen !== right.sharingScreen ||
      left.sharingCamera !== right.sharingCamera
    ) {
      return false
    }
  }
  return true
}

export const useVoiceStore = create<VoiceState>((set) => ({
  participantsByChannel: {},
  activeChannelId: null,
  localTracks: [],
  setParticipants: (channelId, participants) =>
    set((state) => {
      const current = state.participantsByChannel[channelId] ?? []
      if (areParticipantsEqual(current, participants)) return state
      return {
        participantsByChannel: { ...state.participantsByChannel, [channelId]: participants },
      }
    }),
  setActiveChannelId: (channelId) =>
    set((state) => (state.activeChannelId === channelId ? state : { activeChannelId: channelId })),
  setLocalTracks: (tracks) => set({ localTracks: tracks }),
}))
