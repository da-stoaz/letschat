import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSelfStore } from '@/stores/selfStore'
import { useVideoPlayerStore } from '@/stores/videoPlayerStore'
import { InlineVideo } from './InlineVideo'

/** Lives outside the virtual message list: scrolling cannot destroy a pop-out. */
export function VideoPlayerHost() {
  const { player, close } = useVideoPlayerStore()
  const user = useSelfStore(state => state.user)
  const [expanded, setExpanded] = useState(false)
  const [measured, setMeasured] = useState<{ key: string; ratio: number } | null>(null)
  const storageKey = player?.storageKey
  const measure = useCallback((ratio: number) => {
    if (storageKey) setMeasured(previous => previous?.key === storageKey && previous.ratio === ratio ? previous : { key: storageKey, ratio })
  }, [storageKey])
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!player) return
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [player, close])
  useEffect(() => useSelfStore.subscribe((state, previous) => {
    if (state.user?.identity !== previous.user?.identity) close()
  }), [close])
  if (!player || !user) return null
  const ratio = measured?.key === player.storageKey ? measured.ratio : player.aspectRatio ?? 16 / 9
  const mediaWidth = (expanded ? 78 : 40) * ratio
  return (
    <section aria-label={`Video player: ${player.fileName}`} className={expanded
      ? 'fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border bg-background p-3 shadow-2xl'
      : 'fixed right-3 bottom-3 z-50 max-h-[calc(100dvh-1.5rem)] overflow-auto rounded-xl border bg-background p-2 shadow-2xl'}
      style={{ width: expanded ? `min(calc(100vw - 1.5rem), calc(${mediaWidth}dvh + 1.5rem))` : `min(32rem, calc(100vw - 1.5rem), calc(${mediaWidth}dvh + 1rem))` }}>
      <div className="flex items-center gap-2 pb-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{player.fileName}</p>
        <Button size="icon-sm" variant="ghost" aria-label={expanded ? 'Minimize video' : 'Expand video'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2Icon /> : <Maximize2Icon />}</Button>
        <Button ref={closeRef} size="icon-sm" variant="ghost" aria-label="Close video" onClick={close}><XIcon /></Button>
      </div>
      <InlineVideo key={player.storageKey} {...player} persistent expanded={expanded} onAspectRatio={measure} onStop={close} />
    </section>
  )
}
