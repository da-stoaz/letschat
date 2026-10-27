import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type CallAudioSource = 'voice' | 'screen'
type ParticipantVolumes = Record<string, Partial<Record<CallAudioSource, number>>>
type AudioPreferences = { masterVolume: number; participantVolumes: ParticipantVolumes }

const identityKey = (identity: string) => identity.trim().toLowerCase()
export const volumePercent = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100

export function participantVolume(preferences: AudioPreferences, identity: string, source: CallAudioSource) {
  return volumePercent(preferences.participantVolumes[identityKey(identity)]?.[source])
}

export function callTrackVolume(preferences: AudioPreferences, identity: string, source: CallAudioSource, deafened: boolean) {
  return deafened ? 0 : volumePercent(preferences.masterVolume) * participantVolume(preferences, identity, source) / 10_000
}

interface CallAudioState extends AudioPreferences {
  setMasterVolume: (volume: number) => void
  setParticipantVolume: (identity: string, source: CallAudioSource, volume: number) => void
}

// Listener preferences stay on this device and never change another user's audio.
export const useCallAudioStore = create<CallAudioState>()(persist((set) => ({
  masterVolume: 100,
  participantVolumes: {},
  setMasterVolume: volume => set({ masterVolume: volumePercent(volume) }),
  setParticipantVolume: (identity, source, volume) => set(state => {
    const key = identityKey(identity)
    const levels = { ...state.participantVolumes[key], [source]: volumePercent(volume) }
    if (levels[source] === 100) delete levels[source]
    const participantVolumes = { ...state.participantVolumes }
    if (Object.keys(levels).length) participantVolumes[key] = levels
    else delete participantVolumes[key]
    return { participantVolumes }
  }),
}), { name: 'letschat.call-audio', storage: createJSONStorage(() => localStorage) }))
