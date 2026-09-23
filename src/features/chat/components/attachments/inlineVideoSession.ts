// A paused video keeps downloading in WebKit (it buffers progressive MP4 far
// ahead of the playhead), so a video paused this long is unloaded.
const PAUSED_UNLOAD_MS = 10_000

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
): () => void {
  video.src = startAt > 0 ? `${url}#t=${startAt}` : url
  let pausedTimer: ReturnType<typeof setTimeout> | undefined
  const stop = () => onStop(video.ended ? 0 : video.currentTime)
  const handlePause = () => {
    clearTimeout(pausedTimer)
    if (!video.ended) pausedTimer = setTimeout(stop, PAUSED_UNLOAD_MS)
  }
  const handlePlay = () => clearTimeout(pausedTimer)
  const observer = new IntersectionObserver(([entry]) => {
    if (entry && !entry.isIntersecting) stop()
  })

  video.addEventListener('pause', handlePause)
  video.addEventListener('play', handlePlay)
  video.addEventListener('ended', stop)
  observer.observe(video)
  return () => {
    clearTimeout(pausedTimer)
    observer.disconnect()
    video.removeEventListener('pause', handlePause)
    video.removeEventListener('play', handlePlay)
    video.removeEventListener('ended', stop)
    // Unmounting alone does not stop the download; detaching the source does.
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}
