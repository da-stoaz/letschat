// A paused video keeps downloading in WebKit (it buffers progressive MP4 far
// ahead of the playhead), so a video paused this long is unloaded.
const PAUSED_UNLOAD_MS = 10_000

type PlaybackOptions = {
  hls?: boolean
  autoplay?: boolean
  originalUrl?: string
  persistent?: boolean
  onError?: () => void
  onBlocked?: () => void
}

/**
 * Wires one playback session to a video element and returns its teardown.
 * The source is set here, not through a JSX prop: teardown detaches it, and
 * React would not re-apply an unchanged prop when the effect runs again
 * (StrictMode's mount → cleanup → mount), so every setup must be complete.
 */
export function attachInlineVideo(
  video: HTMLVideoElement,
  url: string,
  startAt: number,
  onStop: (position: number) => void,
  options: PlaybackOptions = {},
): () => void {
  let disposed = false
  let destroyHls: (() => void) | undefined
  const play = () => { if (options.autoplay === false) return; void video.play().catch(() => { if (!disposed) options.onBlocked?.() }) }
  const seek = () => { if (startAt > 0) video.currentTime = startAt }
  const error = () => { if (!disposed) options.onError?.() }
  video.addEventListener('error', error)
  video.addEventListener('loadedmetadata', seek)
  if (options.hls && !video.canPlayType('application/vnd.apple.mpegurl')) {
    void import('hls.js').then(({ default: Hls }) => {
      if (disposed) return
      if (!Hls.isSupported()) {
        video.src = options.originalUrl ?? url
        play()
        return
      }
      const hls = new Hls({ startPosition: startAt, maxBufferLength: 30, maxMaxBufferLength: 60, capLevelToPlayerSize: true })
      destroyHls = () => hls.destroy()
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) { hls.destroy(); destroyHls = undefined; error() } })
      hls.on(Hls.Events.MANIFEST_PARSED, play)
      hls.loadSource(url)
      hls.attachMedia(video)
    }).catch(error)
  } else {
    video.src = startAt > 0 && !options.hls ? `${url}#t=${startAt}` : url
    play()
  }
  let pausedTimer: ReturnType<typeof setTimeout> | undefined
  const stop = () => onStop(video.ended ? 0 : video.currentTime)
  const handlePause = () => {
    clearTimeout(pausedTimer)
    if (!video.ended && !options.persistent) pausedTimer = setTimeout(stop, PAUSED_UNLOAD_MS)
  }
  const handlePlay = () => clearTimeout(pausedTimer)
  const observer = new IntersectionObserver(([entry]) => {
    if (entry && !entry.isIntersecting && !options.persistent) stop()
  })

  video.addEventListener('pause', handlePause)
  video.addEventListener('play', handlePlay)
  video.addEventListener('ended', stop)
  observer.observe(video)
  // The player mounts on the user's play click, so it starts with sound. A
  // blocked play() leaves the controls to the user; an aborted one is teardown.
  return () => {
    disposed = true
    clearTimeout(pausedTimer)
    observer.disconnect()
    video.removeEventListener('pause', handlePause)
    video.removeEventListener('play', handlePlay)
    video.removeEventListener('ended', stop)
    video.removeEventListener('error', error)
    video.removeEventListener('loadedmetadata', seek)
    destroyHls?.()
    // Unmounting alone does not stop the download; detaching the source does.
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}
