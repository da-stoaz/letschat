import { create } from 'zustand'
import type { VideoSource } from '@/features/chat/components/attachments/InlineVideo'

type Player = VideoSource & { startAt: number; originId: string }
export const useVideoPlayerStore = create<{
  player: Player | null
  anchor: HTMLElement | null
  visibleAnchor: HTMLElement | null
  autoFloating: boolean
  focusOnOpen: boolean
  open: (player: Player, anchor?: HTMLElement) => void
  float: (focus?: boolean) => void
  releaseAnchor: (anchor: HTMLElement) => void
  setVisibility: (originId: string, anchor: HTMLElement, visible: boolean, autoReturn?: boolean) => void
  setAspectRatio: (ratio: number) => void
  dismiss: (position?: number) => void
  stop: (position?: number) => void
  close: () => void
}>((set, get) => {
  // Session-only, keyed by message/attachment so virtualized remounts can resume.
  const positions = new Map<string, number>()
  const inactive = { player: null, anchor: null, visibleAnchor: null, autoFloating: false, focusOnOpen: false }
  return {
    ...inactive,
    open: (player, anchor) => {
      const position = positions.get(player.originId)
      set({ player: position === undefined ? player : { ...player, startAt: position },
        anchor: anchor ?? null, visibleAnchor: anchor ?? null, autoFloating: false, focusOnOpen: !anchor })
    },
    float: (focus = true) => set({ anchor: null, autoFloating: !focus, focusOnOpen: focus }),
    releaseAnchor: anchor => {
      const state = get()
      if (state.visibleAnchor === anchor) set({ visibleAnchor: null })
      if (state.anchor !== anchor) return
      // Layout cleanup runs before virtualization removes this DOM row. This
      // also catches fast scrolls that unmount it before IntersectionObserver.
      const video = anchor.querySelector('video')
      if (!video || (!video.paused && !video.ended)) state.float(false)
      else state.stop(video.ended ? 0 : video.currentTime)
    },
    setVisibility: (originId, anchor, visible, autoReturn = visible) => {
      const state = get()
      if (state.player?.originId !== originId) return
      if (visible && anchor.isConnected) {
        set({ visibleAnchor: anchor, ...(state.autoFloating && autoReturn ? { anchor, autoFloating: false, focusOnOpen: false } : {}) })
      } else state.releaseAnchor(anchor)
    },
    setAspectRatio: ratio => set(state => state.player && state.player.aspectRatio !== ratio
      ? { player: { ...state.player, aspectRatio: ratio } } : state),
    dismiss: position => {
      const state = get()
      if (state.player && state.visibleAnchor?.isConnected) {
        // Closing the floating presentation must not tear down its media session.
        set({ anchor: state.visibleAnchor, autoFloating: false, focusOnOpen: false })
      } else state.stop(position)
    },
    stop: position => {
      const player = get().player
      if (player) {
        const resumeAt = position !== undefined && Number.isFinite(position) ? Math.max(0, position) : player.startAt
        positions.delete(player.originId)
        if (resumeAt > 0) positions.set(player.originId, resumeAt)
        if (positions.size > 100) positions.delete(positions.keys().next().value!)
      }
      set(inactive)
    },
    // Signing out/account changes also discard the previous user's resume data.
    close: () => { positions.clear(); set(inactive) },
  }
})
