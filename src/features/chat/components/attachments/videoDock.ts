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
  let animateHandoff = false
  let animation: Animation | null = null
  let frameTimer: ReturnType<typeof setInterval> | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let destination: HTMLElement | null = null
  const reservations = new Map<HTMLElement, string>()
  const reserve = (slot: HTMLElement, height: number) => {
    if (!reservations.has(slot)) reservations.set(slot, slot.style.minHeight)
    slot.style.minHeight = `${height}px`
  }
  const release = (slot: HTMLElement) => {
    const minHeight = reservations.get(slot)
    if (minHeight === undefined) return
    slot.style.minHeight = minHeight
    reservations.delete(slot)
  }
  let inlineSlot: HTMLElement | null = null
  const sizeObserver = new ResizeObserver(() => {
    if (!inlineSlot || container.parentElement !== inlineSlot) return
    const content = container.firstElementChild
    if (content) reserve(inlineSlot, content.getBoundingClientRect().height)
  })
  const watchInline = (slot: HTMLElement) => {
    inlineSlot = slot
    const content = container.firstElementChild
    if (content) {
      reserve(slot, content.getBoundingClientRect().height)
      sizeObserver.observe(content)
    }
  }
  const cancel = () => {
    clearInterval(frameTimer)
    clearTimeout(settleTimer)
    if (animation) { animation.onfinish = null; animation.cancel(); animation = null }
  }
  return {
    // Called by the store subscription before React hides/replaces either slot.
    capture(continuous = true) {
      sizeObserver.disconnect()
      inlineSlot = null
      if (!continuous) {
        for (const slot of reservations.keys()) release(slot)
      }
      animateHandoff = continuous && container.isConnected
      // Keep the outgoing message footprint while the same player is docked.
      if (animateHandoff && destination && container.parentElement === destination) {
        reserve(destination, Math.max(container.getBoundingClientRect().height, destination.getBoundingClientRect().height))
      }
    },
    move(target: HTMLElement, inline = false, presentation = container) {
      if (destination === target && container.isConnected) {
        if (inline && container.parentElement === target) watchInline(target)
        return
      }
      cancel()
      for (const slot of reservations.keys()) {
        if (!slot.isConnected) release(slot)
      }
      destination = target
      // Poster and portal can coexist during React's commit. Overlap them so
      // inserting the poster cannot shift the live video's animation origin.
      container.style.gridArea = '1 / 1'
      target.appendChild(container)
      release(target)
      if (inline) watchInline(target)
      const transition = animateHandoff || presentation !== container
      animateHandoff = false
      if (!transition || !presentation.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      // Animate in place: opacity/transform leave layout and the chat's scroll
      // position untouched, and playback stays in this single live container.
      animation = presentation.animate([
        { opacity: 0.4, transform: 'translateY(24px) scale(0.96)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
      animation.onfinish = cancel
      const started = performance.now()
      let manual = false
      // WebKit can suspend its animation clock while media/timers keep running.
      // Only drive the clock ourselves if it falls behind; normal frames stay native.
      frameTimer = setInterval(() => {
        if (!animation) return
        const elapsed = performance.now() - started
        if (!manual && elapsed - Number(animation.currentTime) > 50) {
          animation.pause()
          manual = true
        }
        if (manual) {
          animation.currentTime = Math.min(elapsed, 240)
          if (elapsed >= 240) cancel()
        }
      }, 16)
      settleTimer = setTimeout(cancel, 400)
    },
    destroy() {
      cancel()
      sizeObserver.disconnect()
      inlineSlot = null
      animateHandoff = false
      destination = null
      container.remove()
      for (const slot of reservations.keys()) release(slot)
    },
  }
}
