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
  let animateFromOrigin = true
  let clearFlight: (() => void) | undefined
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
    clearTimeout(settleTimer)
    if (animation) { animation.onfinish = null; animation.cancel(); animation = null }
    clearFlight?.()
    clearFlight = undefined
  }
  return {
    // Called by the store subscription before React hides/replaces either slot.
    capture(continuous = true, originVisible = true) {
      sizeObserver.disconnect()
      inlineSlot = null
      if (!continuous) {
        for (const slot of reservations.keys()) release(slot)
      }
      from = continuous && container.isConnected ? container.getBoundingClientRect() : null
      animateFromOrigin = originVisible
      // The poster has no playback footer. Keep the full outgoing footprint
      // so the virtualizer and browser scroll anchoring see no row-size change.
      if (from && destination && container.parentElement === destination) {
        reserve(destination, Math.max(from.height, destination.getBoundingClientRect().height))
      }
    },
    move(target: HTMLElement, inline = false) {
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
      const to = container.getBoundingClientRect()
      if (inline) watchInline(target)
      const start = from
      from = null
      if (!start?.width || !to.width || !to.height || !container.animate ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      // Automatic exits start outside the chat's clipping viewport. Flying
      // that rectangle above the page would reveal a large offscreen player.
      if (!animateFromOrigin) {
        animation = container.animate([
          { opacity: 0, transform: 'translateY(8px) scale(0.98)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ], { duration: 160, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
        animation.onfinish = cancel
        settleTimer = setTimeout(cancel, 300)
        return
      }

      // Reserve the destination's layout while the live player flies above
      // clipping/transform ancestors in the virtualized chat.
      reserve(target, to.height)
      sizeObserver.disconnect()
      inlineSlot = null
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
        container.removeAttribute('style')
        container.style.gridArea = '1 / 1'
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
        if (target.isConnected) {
          target.appendChild(container)
          release(target)
          if (inline) watchInline(target)
        }
      }
      animation.onfinish = finish
      // Hidden/background webviews can suspend their animation timeline. Never
      // strand the live player in the overlay waiting for a compositor frame.
      settleTimer = setTimeout(finish, 300)
    },
    destroy() {
      cancel()
      sizeObserver.disconnect()
      inlineSlot = null
      from = null
      destination = null
      container.remove()
      for (const slot of reservations.keys()) release(slot)
    },
  }
}
