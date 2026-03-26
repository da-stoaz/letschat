import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface MediaDeviceState {
  audioInputId: string | null
  audioOutputId: string | null
  videoInputId: string | null
  setAudioInputId: (deviceId: string | null) => void
  setAudioOutputId: (deviceId: string | null) => void
  setVideoInputId: (deviceId: string | null) => void
}

export const useMediaDeviceStore = create<MediaDeviceState>()(
  persist(
    (set) => ({
      audioInputId: null,
      audioOutputId: null,
      videoInputId: null,
      setAudioInputId: (audioInputId) =>
        set((state) => (state.audioInputId === audioInputId ? state : { audioInputId })),
      setAudioOutputId: (audioOutputId) =>
        set((state) => (state.audioOutputId === audioOutputId ? state : { audioOutputId })),
      setVideoInputId: (videoInputId) =>
        set((state) => (state.videoInputId === videoInputId ? state : { videoInputId })),
    }),
    {
      name: 'letschat.media-devices',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
