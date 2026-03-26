import { create } from 'zustand'
import type { DmVoiceParticipant } from '../types/domain'

interface DmVoiceState {
  participantsByRoom: Record<string, DmVoiceParticipant[]>
  setRoomParticipants: (roomKey: string, participants: DmVoiceParticipant[]) => void
}

function areDmParticipantsEqual(a: DmVoiceParticipant[], b: DmVoiceParticipant[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (
      left.roomKey !== right.roomKey ||
      left.userIdentity !== right.userIdentity ||
      left.userA !== right.userA ||
      left.userB !== right.userB ||
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

export const useDmVoiceStore = create<DmVoiceState>((set) => ({
  participantsByRoom: {},
  setRoomParticipants: (roomKey, participants) =>
    set((state) => {
      const current = state.participantsByRoom[roomKey] ?? []
      if (areDmParticipantsEqual(current, participants)) return state
      return {
        participantsByRoom: { ...state.participantsByRoom, [roomKey]: participants },
      }
    }),
}))
