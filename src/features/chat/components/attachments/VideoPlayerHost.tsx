import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSelfStore } from '@/stores/selfStore'
import { useVideoPlayerStore } from '@/stores/videoPlayerStore'
import { InlineVideo } from './InlineVideo'
import { createVideoDock } from './videoDock'

/** Owns the only active player, even while its DOM is docked inside a chat row. */
export function VideoPlayerHost() {
  const { player, anchor, visibleAnchor, focusOnOpen, setAspectRatio, stop, close } = useVideoPlayerStore()
  const user = useSelfStore(state => state.user)
  const [expanded, setExpanded] = useState(false)
  // React always portals into this same node. Changing a portal target would
  // remount the video, discard its HLS buffer and restart large range requests.
  const [container] = useState(() => document.createElement('div'))
  const [dock] = useState(() => createVideoDock(container))
  const floatingSlot = useRef<HTMLDivElement>(null)
  const floatingSection = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const floating = !anchor
  const key = player?.storageKey
  const dismiss = useCallback(() => {
    const video = container.querySelector('video')
    const position = video && (video.readyState >= 1 || video.currentTime > 0) ? video.currentTime : undefined
    useVideoPlayerStore.getState().dismiss(video?.ended ? 0 : position)
  }, [container])

  useLayoutEffect(() => useVideoPlayerStore.subscribe((state, previous) => {
    if (state.anchor !== previous.anchor || state.player?.storageKey !== previous.player?.storageKey) {
      dock.capture(state.player?.storageKey === previous.player?.storageKey)
    }
  }), [dock])

  useLayoutEffect(() => {
    if (!key || !user) { dock.destroy(); return }
    const target = anchor?.isConnected ? anchor : floatingSlot.current
    if (target) dock.move(target, Boolean(anchor?.isConnected), anchor?.isConnected ? container : floatingSection.current ?? container)
  }, [anchor, container, dock, key, user])
  useEffect(() => () => dock.destroy(), [dock])

  useEffect(() => {
    if (!key || !floating) return
    const previous = document.activeElement as HTMLElement | null
    if (focusOnOpen) closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (focusOnOpen && previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [key, floating, focusOnOpen, dismiss])
  useEffect(() => useSelfStore.subscribe((state, previous) => {
    if (state.user?.identity !== previous.user?.identity) close()
  }), [close])

  if (!player || !user) return null
  const ratio = player.aspectRatio ?? 16 / 9
  const mediaWidth = (expanded ? 78 : 40) * ratio
  return <>
    <section ref={floatingSection} hidden={!floating} aria-label={`Video player: ${player.fileName}`} className={expanded
      ? 'fixed left-1/2 top-1/2 z-50 max-h-[calc(var(--app-height,100dvh)-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border bg-background p-3 shadow-2xl'
      : 'fixed right-3 bottom-3 z-50 max-h-[calc(var(--app-height,100dvh)-1.5rem)] overflow-auto rounded-xl border bg-background p-2 shadow-2xl'}
      style={{ top: expanded ? 'calc(var(--app-top, 0px) + var(--app-height, 100dvh) / 2)' : undefined, bottom: expanded ? undefined : 'calc(0.75rem + env(safe-area-inset-bottom) + max(0px, 100dvh - var(--app-height, 100dvh) - var(--app-top, 0px)))', width: expanded ? `min(calc(100vw - 1.5rem), calc(${mediaWidth}dvh + 1.5rem))` : `min(32rem, calc(100vw - 1.5rem), calc(${mediaWidth}dvh + 1rem))` }}>
      <div className="flex items-center gap-2 pb-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{player.fileName}</p>
        <Button size="icon-sm" variant="ghost" aria-label={expanded ? 'Minimize video' : 'Expand video'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2Icon /> : <Maximize2Icon />}</Button>
        <Button ref={closeRef} size="icon-sm" variant="ghost" aria-label={visibleAnchor ? 'Return video to chat' : 'Close video'} onClick={dismiss}><XIcon /></Button>
      </div>
      <div ref={floatingSlot} />
    </section>
    {createPortal(<InlineVideo key={player.storageKey} {...player} persistent expanded={floating && expanded}
      onAspectRatio={setAspectRatio} onStop={stop} docked={!floating} />, container)}
  </>
}
