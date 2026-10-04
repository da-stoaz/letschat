import { create } from 'zustand'
import type { VideoSource } from '@/features/chat/components/attachments/InlineVideo'

type Player = VideoSource & { startAt: number }
export const useVideoPlayerStore = create<{
  player: Player | null
  open: (player: Player) => void
  close: () => void
}>(set => ({ player: null, open: player => set({ player }), close: () => set({ player: null }) }))
