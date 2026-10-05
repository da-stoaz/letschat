/** Watch the stable message placeholder, which remains after the video moves. */
export function observeVideoDock(anchor: HTMLElement, onVisibility: (visible: boolean, autoReturn: boolean) => void) {
  let disposed = false
  const observer = new IntersectionObserver(([entry]) => {
    if (disposed || !entry) return
    // Hysteresis avoids bouncing between modes at the edge of the viewport.
    onVisibility(entry.isIntersecting, entry.isIntersecting && entry.intersectionRatio >= 0.25)
  }, { threshold: [0, 0.25] })
  observer.observe(anchor)
  return () => { disposed = true; observer.disconnect() }
}

/** Animate the live portal, never a screenshot or a second media element. */
export function createVideoDock(container: HTMLElement) {
  let from: DOMRect | null = null
  let animation: Animation | null = null
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let destination: HTMLElement | null = null
  let clearFlight: (() => void) | undefined
  const cancel = () => {
    clearTimeout(settleTimer)
    if (animation) { animation.onfinish = null; animation.cancel(); animation = null }
    clearFlight?.()
    clearFlight = undefined
  }
  return {
    // Called by the store subscription before React hides/replaces either slot.
    capture(continuous = true) {
      from = continuous && container.isConnected ? container.getBoundingClientRect() : null
    },
    move(target: HTMLElement) {
      if (destination === target && container.isConnected) return
      cancel()
      destination = target
      target.appendChild(container)
      const to = container.getBoundingClientRect()
      const start = from
      from = null
      if (!start?.width || !to.width || !to.height || !container.animate ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      // Reserve the destination's layout while the live player flies above
      // clipping/transform ancestors in the virtualized chat.
      const minHeight = target.style.minHeight
      target.style.minHeight = `${to.height}px`
      Object.assign(container.style, {
        position: 'fixed', left: `${to.left}px`, top: `${to.top}px`,
        width: `${to.width}px`, zIndex: '60', transformOrigin: 'top left',
      })
      document.body.appendChild(container)
      const followScroll = () => {
        const rect = target.getBoundingClientRect()
        container.style.left = `${rect.left}px`
        container.style.top = `${rect.top}px`
      }
      document.addEventListener('scroll', followScroll, true)
      clearFlight = () => {
        document.removeEventListener('scroll', followScroll, true)
        target.style.minHeight = minHeight
        container.removeAttribute('style')
      }
      // Uniform scale preserves the recorded aspect ratio throughout the move.
      // A virtualized jump may put the old row thousands of pixels away.
      const startLeft = Math.max(-start.width, Math.min(window.innerWidth, start.left))
      const startTop = Math.max(-start.height, Math.min(window.innerHeight, start.top))
      animation = container.animate([
        { transform: `translate(${startLeft - to.left}px, ${startTop - to.top}px) scale(${start.width / to.width})` },
        { transform: 'translate(0, 0) scale(1)' },
      ], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
      const finish = () => {
        cancel()
        if (target.isConnected) target.appendChild(container)
      }
      animation.onfinish = finish
      // Hidden/background webviews can suspend their animation timeline. Never
      // strand the live player in the overlay waiting for a compositor frame.
      settleTimer = setTimeout(finish, 300)
    },
    destroy() { cancel(); from = null; destination = null; container.remove() },
  }
}
