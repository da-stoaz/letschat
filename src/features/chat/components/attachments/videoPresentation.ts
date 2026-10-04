/** Shared sizing for the poster, attachment card and live video. */
export function videoSize(aspectRatio: number, viewportHeight: number) {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9
  return { aspectRatio: ratio, width: `min(100%, ${viewportHeight * ratio}dvh)` }
}

/** Decode readiness and buffering are independent of compositor callbacks.
 * requestVideoFrameCallback may never fire for background/occluded media or
 * a stream whose audio starts before video. It must never gate the controls.
 */
export function observeVideoPresentation(video: HTMLVideoElement, callbacks: {
  onFrame: () => void
  onBuffering: (buffering: boolean) => void
  onRatio: (ratio: number) => void
  onMissingPicture: (missing: boolean) => void
}) {
  let pictureTimeout: ReturnType<typeof setTimeout> | undefined
  const dimensions = () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      clearTimeout(pictureTimeout)
      callbacks.onMissingPicture(false)
      callbacks.onRatio(video.videoWidth / video.videoHeight)
    }
  }
  const ready = () => {
    dimensions()
    if (video.readyState >= 2) callbacks.onFrame()
    callbacks.onBuffering(false)
  }
  const playing = () => {
    ready()
    clearTimeout(pictureTimeout)
    if (video.videoWidth === 0) pictureTimeout = setTimeout(() => {
      if (!video.paused && video.videoWidth === 0) callbacks.onMissingPicture(true)
    }, 5000)
  }
  const progress = () => { if (!video.paused && video.readyState >= 2) ready() }
  const waiting = () => callbacks.onBuffering(true)
  const paused = () => callbacks.onBuffering(false)
  const emptied = () => { clearTimeout(pictureTimeout); callbacks.onMissingPicture(false) }
  const listeners = { loadedmetadata: dimensions, resize: dimensions, loadeddata: ready, playing,
    canplay: ready, timeupdate: progress, waiting, pause: paused, ended: paused, emptied }
  for (const [name, handler] of Object.entries(listeners)) video.addEventListener(name, handler)
  return () => {
    clearTimeout(pictureTimeout)
    for (const [name, handler] of Object.entries(listeners)) video.removeEventListener(name, handler)
  }
}
