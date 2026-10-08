import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function useViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    const update = () => {
      // Let pinch zoom retain its native behavior; only fit the unzoomed viewport.
      if (viewport && viewport.scale === 1) {
        root.style.setProperty('--app-height', `${viewport.height}px`)
        root.style.setProperty('--app-top', `${viewport.offsetTop}px`)
      } else {
        root.style.removeProperty('--app-height')
        root.style.removeProperty('--app-top')
      }
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      root.style.removeProperty('--app-height')
      root.style.removeProperty('--app-top')
    }
  }, [])
}

export function useContainerWidth() {
  const ref = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(() => window.innerWidth)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}
