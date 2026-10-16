import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ScreenShareQuality } from '../lib/screenShare'

export type NoiseFilterModel = 'rnnoise' | 'deepfilternet'

interface MediaDeviceState {
  audioInputId: string | null
  audioOutputId: string | null
  videoInputId: string | null
  noiseFilterEnabled: boolean
  noiseFilterModel: NoiseFilterModel
  screenShareQuality: ScreenShareQuality
  screenShareAudio: boolean
  setAudioInputId: (deviceId: string | null) => void
  setAudioOutputId: (deviceId: string | null) => void
  setVideoInputId: (deviceId: string | null) => void
  setNoiseFilterEnabled: (enabled: boolean) => void
  setNoiseFilterModel: (model: NoiseFilterModel) => void
  setScreenShareQuality: (quality: ScreenShareQuality) => void
  setScreenShareAudio: (enabled: boolean) => void
  toggleNoiseFilter: () => void
}

export const useMediaDeviceStore = create<MediaDeviceState>()(
  persist(
    (set) => ({
      audioInputId: null,
      audioOutputId: null,
      videoInputId: null,
      noiseFilterEnabled: true,
      noiseFilterModel: 'rnnoise',
      screenShareQuality: 'auto',
      screenShareAudio: false,
      setAudioInputId: (audioInputId) =>
        set((state) => (state.audioInputId === audioInputId ? state : { audioInputId })),
      setAudioOutputId: (audioOutputId) =>
        set((state) => (state.audioOutputId === audioOutputId ? state : { audioOutputId })),
      setVideoInputId: (videoInputId) =>
        set((state) => (state.videoInputId === videoInputId ? state : { videoInputId })),
      setNoiseFilterEnabled: (noiseFilterEnabled) =>
        set((state) => (state.noiseFilterEnabled === noiseFilterEnabled ? state : { noiseFilterEnabled })),
      setNoiseFilterModel: (noiseFilterModel) =>
        set((state) => (state.noiseFilterModel === noiseFilterModel ? state : { noiseFilterModel })),
      setScreenShareQuality: (screenShareQuality) => set({ screenShareQuality }),
      setScreenShareAudio: (screenShareAudio) => set({ screenShareAudio }),
      toggleNoiseFilter: () => set((state) => ({ noiseFilterEnabled: !state.noiseFilterEnabled })),
    }),
    {
      name: 'letschat.media-devices',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
