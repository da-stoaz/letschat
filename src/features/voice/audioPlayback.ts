type AudioElement = Pick<HTMLAudioElement, 'play' | 'addEventListener' | 'removeEventListener'>

/** Retry the actual attached sink during a user gesture, not a detached replacement. */
export function watchAudioPlayback(element: AudioElement, onBlocked: (blocked: boolean) => void) {
  let disposed = false
  let attempt = 0
  const onPlaying = () => {
    attempt++
    if (!disposed) onBlocked(false)
  }
  element.addEventListener('playing', onPlaying)

  const retry = () => {
    const current = ++attempt
    const failed = () => { if (!disposed && current === attempt) onBlocked(true) }
    try {
      // Invoke synchronously so the browser retains the tap's user activation.
      void element.play().then(() => {
        if (!disposed && current === attempt) onBlocked(false)
      }, failed)
    } catch {
      failed()
    }
  }

  return {
    retry,
    dispose: () => {
      disposed = true
      element.removeEventListener('playing', onPlaying)
    },
  }
}
