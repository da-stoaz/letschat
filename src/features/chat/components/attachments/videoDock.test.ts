import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideoDock, observeVideoDock } from './videoDock'
import { useVideoPlayerStore } from '@/stores/videoPlayerStore'

const source = { originId: 'message:video', storageKey: 'video', url: '/video.mp4', fileName: 'video.mp4', startAt: 0 }
const store = () => useVideoPlayerStore.getState()
function anchor(paused = false, ended = false) {
  return { isConnected: true, querySelector: () => ({ paused, ended }) } as unknown as HTMLElement
}

function observe(paused = false, ended = false) {
  let callback: IntersectionObserverCallback
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { callback = cb }
    observe = vi.fn()
    disconnect = disconnect
  })
  const row = anchor(paused, ended)
  store().open(source, row)
  const visibility = vi.fn((visible: boolean, autoReturn: boolean) => store().setVisibility(source.originId, row, visible, autoReturn))
  const cleanup = observeVideoDock(row, visibility)
  const intersect = (isIntersecting: boolean, intersectionRatio = 1) => callback([{ isIntersecting, intersectionRatio } as IntersectionObserverEntry], {} as IntersectionObserver)
  return { row, visibility, cleanup, intersect, disconnect }
}

afterEach(() => { store().close(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('automatic video pop-out', () => {
  it('floats playing media only after it leaves the viewport', () => {
    const test = observe()
    test.intersect(true)
    expect(store().anchor).toBe(test.row)
    test.intersect(false)
    expect(store().anchor).toBeNull()
    expect(store().player).toBe(source)
    test.intersect(true, 0.01)
    expect(store().anchor).toBeNull()
    test.intersect(true, 0.3)
    expect(store().anchor).toBe(test.row)
  })

  it.each([[true, false], [false, true]])('does not open a floating player for paused/ended media', (paused, ended) => {
    const test = observe(paused, ended)
    test.intersect(false)
    expect(store().player).toBeNull()
  })

  it('ignores queued observer notifications after switching players or floating', () => {
    const test = observe()
    test.cleanup()
    test.intersect(false)
    expect(test.disconnect).toHaveBeenCalledOnce()
    expect(test.visibility).not.toHaveBeenCalled()
  })

  it('preserves the source and measured aspect ratio when virtualization removes a playing row', () => {
    const row = anchor()
    store().open(source, row)
    store().setAspectRatio(4 / 3)
    const playing = store().player
    store().releaseAnchor(row)
    expect(store().player).toBe(playing)
    expect(store().player?.aspectRatio).toBe(4 / 3)
    expect(store().anchor).toBeNull()
    expect(store().focusOnOpen).toBe(false)
  })

  it('unloads a paused row without affecting another row’s playback', () => {
    const oldRow = anchor(true)
    store().open(source, oldRow)
    store().releaseAnchor(oldRow)
    expect(store().player).toBeNull()
    const currentRow = anchor()
    store().open({ ...source, storageKey: 'other' }, currentRow)
    store().releaseAnchor(oldRow)
    expect(store().anchor).toBe(currentRow)
    expect(store().player?.storageKey).toBe('other')
  })

  it('returns to the original message after virtualization remounts it, not another copy of the attachment', () => {
    const row = anchor()
    store().open(source, row)
    store().releaseAnchor(row)
    const remounted = anchor()
    store().setVisibility('different-message:video', remounted, true)
    expect(store().anchor).toBeNull()
    store().setVisibility(source.originId, remounted, true)
    expect(store().anchor).toBe(remounted)
    expect(store().player).toBe(source)
    expect(store().autoFloating).toBe(false)
    expect(store().focusOnOpen).toBe(false)
  })

  it('keeps a manually opened player alive when its old row unmounts', () => {
    const row = anchor()
    store().open(source, row)
    store().float()
    store().releaseAnchor(row)
    store().setVisibility(source.originId, anchor(), true)
    expect(store().anchor).toBeNull()
    expect(store().player).toBe(source)
    expect(store().focusOnOpen).toBe(true)
    store().close()
    expect(store().player).toBeNull()
    expect(store().anchor).toBeNull()
  })

  it.each([false, true])('closing a visible pop-out preserves the same playing or paused session (%s)', paused => {
    const row = anchor(paused)
    store().open(source, row)
    store().float()
    store().dismiss(42)
    expect(store().anchor).toBe(row)
    expect(store().player).toBe(source)
    expect(store().player?.startAt).toBe(0) // No source-effect restart or seek.
    expect(store().focusOnOpen).toBe(false)
    expect(store().autoFloating).toBe(false)
  })

  it('returns a manual pop-out to its visible remounted origin', () => {
    const oldRow = anchor()
    store().open(source, oldRow)
    store().float()
    store().releaseAnchor(oldRow)
    const remounted = anchor()
    store().setVisibility(source.originId, remounted, true)
    expect(store().anchor).toBeNull()
    store().dismiss(42)
    expect(store().anchor).toBe(remounted)
    expect(store().player).toBe(source)
  })

  it('Close can return to a partially visible message before the automatic-return threshold', () => {
    const test = observe()
    test.intersect(false)
    test.intersect(true, 0.1)
    expect(store().anchor).toBeNull()
    expect(store().visibleAnchor).toBe(test.row)
    store().dismiss(42)
    expect(store().anchor).toBe(test.row)
    expect(store().player).toBe(source)
  })

  it('closing offscreen remembers each video independently and resumes after remount', () => {
    const row = anchor()
    store().open(source, row)
    store().float()
    store().setVisibility(source.originId, row, false)
    store().dismiss(42)
    expect(store().player).toBeNull()
    const other = { ...source, originId: 'another:video' }
    store().open(other)
    expect(store().player?.startAt).toBe(0)
    store().dismiss(12)
    store().open(source, anchor())
    expect(store().player?.startAt).toBe(42)
    store().stop(43)
    store().open(other)
    expect(store().player?.startAt).toBe(12)
  })

  it('does not return into a detached placeholder and does not lose a pending resume seek', () => {
    const row = anchor()
    store().open({ ...source, startAt: 42 }, row)
    store().float()
    Object.assign(row, { isConnected: false })
    store().dismiss()
    expect(store().player).toBeNull()
    store().open(source)
    expect(store().player?.startAt).toBe(42)
  })

  it('finished playback restarts from zero and signing out clears saved positions', () => {
    store().open(source)
    store().stop(42)
    store().open(source)
    store().stop(0) // Native ended event.
    store().open(source)
    expect(store().player?.startAt).toBe(0)
    store().stop(42)
    store().close() // Account change/sign-out.
    store().open(source)
    expect(store().player?.startAt).toBe(0)
  })
})

class Slot {
  isConnected = true
  style: Record<string, string> = { minHeight: '' }
  parentElement: Slot | null = null
  firstElementChild: Slot | null = null
  rect: { left: number; top: number; width: number; height: number }
  constructor(rect = { left: 0, top: 0, width: 800, height: 450 }) { this.rect = rect }
  appendChild(child: Slot) { child.parentElement = this }
  getBoundingClientRect() { return this.parentElement?.rect ?? this.rect }
  removeAttribute() { this.style = {} }
  remove() { this.parentElement = null }
}

function flight(reduced = false) {
  const body = new Slot()
  vi.stubGlobal('document', { body, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900, matchMedia: () => ({ matches: reduced }) })
  let resize: () => void = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  const animations: { cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; currentTime: number; onfinish: (() => void) | null }[] = []
  const container = Object.assign(new Slot(), { animate: vi.fn(() => {
    const animation = { cancel: vi.fn(), pause: vi.fn(), currentTime: 0, onfinish: null as (() => void) | null }
    animations.push(animation)
    return animation
  }) })
  const inline = new Slot()
  const floating = new Slot({ left: 600, top: 500, width: 400, height: 225 })
  const dock = createVideoDock(container as unknown as HTMLElement)
  dock.move(inline as unknown as HTMLElement)
  return { body, container, inline, floating, animations, dock, resize: () => resize(), disconnect }
}

describe('video docking animation', () => {
  it('leaves a progressing native clock alone and clears timers on dismissal', () => {
    vi.useFakeTimers()
    const { dock, floating, animations } = flight()
    dock.capture()
    dock.move(floating as unknown as HTMLElement)
    animations[0].currentTime = 80
    vi.advanceTimersByTime(80)
    expect(animations[0].pause).not.toHaveBeenCalled()
    expect(animations[0].currentTime).toBe(80)
    dock.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('animates the whole floating card and cancels it if native animation frames stall', () => {
    vi.useFakeTimers()
    const { dock, container, floating } = flight()
    const animation = { cancel: vi.fn(), pause: vi.fn(), currentTime: 0, onfinish: null as (() => void) | null }
    const card = Object.assign(new Slot(), { animate: vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => typeof animation>(() => animation) })
    dock.capture()
    dock.move(floating as unknown as HTMLElement, false, card as unknown as HTMLElement)
    expect(container.parentElement).toBe(floating)
    expect(container.animate).not.toHaveBeenCalled()
    expect(card.animate).toHaveBeenCalledOnce()
    // Keep playing media visible even at the first frame in a suspended webview.
    expect(card.animate.mock.calls[0]?.[0]).toEqual([
      { opacity: 0.4, transform: 'translateY(24px) scale(0.96)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ])
    vi.advanceTimersByTime(80)
    expect(animation.pause).toHaveBeenCalledOnce()
    expect(animation.currentTime).toBe(80)
    vi.advanceTimersByTime(80)
    expect(animation.currentTime).toBe(160)
    vi.advanceTimersByTime(80)
    expect(animation.cancel).toHaveBeenCalledOnce()
    expect(animation.onfinish).toBeNull()
  })

  it('reserves the inline content before departure can shrink it to floating dimensions', () => {
    const { dock, container, inline, floating, resize, disconnect } = flight()
    const content = new Slot()
    container.firstElementChild = content
    dock.move(floating as unknown as HTMLElement)
    dock.move(inline as unknown as HTMLElement, true)
    expect(inline.style.minHeight).toBe('450px')
    content.rect.height = 480 // Metadata/footer/viewport changes while inline.
    resize()
    expect(inline.style.minHeight).toBe('480px')
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ ...inline.rect, height: 300 })
    inline.rect.height = 480
    dock.capture(true)
    expect(disconnect).toHaveBeenCalled()
    dock.move(floating as unknown as HTMLElement)
    content.rect.height = 225
    resize() // Ignore a queued notification for the now floating content.
    expect(inline.style.minHeight).toBe('480px')
    dock.destroy()
    expect(inline.style.minHeight).toBe('')
  })

  it.each([-500, 1000])('animates exits at the destination when the source is offscreen at y=%s', top => {
    const { dock, container, inline, floating, animations } = flight()
    inline.rect.top = top
    dock.capture(true)
    dock.move(floating as unknown as HTMLElement)
    expect(container.parentElement).toBe(floating)
    expect(inline.style.minHeight).toBe('450px')
    expect(container.animate.mock.calls[0]).toEqual([
      [{ opacity: 0.4, transform: 'translateY(24px) scale(0.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
      { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    ])
    animations[0].onfinish?.()
    dock.capture()
    dock.move(inline as unknown as HTMLElement)
    expect(container.animate.mock.calls[1]).toEqual([
      [{ opacity: 0.4, transform: 'translateY(24px) scale(0.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
      { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    ])
  })

  it('preserves the outgoing row footprint until playback returns or is dismissed', () => {
    const { dock, container, inline, floating, animations } = flight()
    inline.style.minHeight = '80px'
    dock.capture()
    expect(inline.style.minHeight).toBe('450px')
    dock.move(floating as unknown as HTMLElement)
    animations[0].onfinish?.()
    expect(inline.style.minHeight).toBe('450px')
    expect(container.style.gridArea).toBe('1 / 1')
    dock.capture()
    dock.move(inline as unknown as HTMLElement)
    animations[1].onfinish?.()
    expect(inline.style.minHeight).toBe('80px')
    dock.capture()
    dock.move(floating as unknown as HTMLElement)
    dock.destroy()
    expect(inline.style.minHeight).toBe('80px')
    expect(floating.style.minHeight).toBe('')
  })

  it('fades the same live container in place without overlays or scroll listeners', () => {
    const { dock, container, inline, floating, animations } = flight()
    dock.capture()
    dock.move(floating as unknown as HTMLElement)
    expect(container.parentElement).toBe(floating)
    expect(container.style.position).toBeUndefined()
    expect(document.addEventListener).not.toHaveBeenCalled()
    expect(floating.style.minHeight).toBe('')
    expect(container.animate.mock.calls[0]).toEqual([
      [{ opacity: 0.4, transform: 'translateY(24px) scale(0.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
      { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    ])
    animations[0].onfinish?.()
    expect(container.parentElement).toBe(floating)
    expect(floating.style.minHeight).toBe('')
    dock.capture()
    dock.move(inline as unknown as HTMLElement)
    animations[1].onfinish?.()
    expect(container.parentElement).toBe(inline)
  })

  it('cancels an interrupted transition without allowing its old completion to move the player back', () => {
    const { dock, inline, floating, container, animations } = flight()
    dock.capture()
    dock.move(floating as unknown as HTMLElement)
    dock.capture()
    dock.move(inline as unknown as HTMLElement)
    expect(animations[0].cancel).toHaveBeenCalledOnce()
    expect(animations[0].onfinish).toBeNull()
    expect(floating.style.minHeight).toBe('225px')
    animations[1].onfinish?.()
    expect(container.parentElement).toBe(inline)
    expect(container.style.position).toBeUndefined()
    dock.destroy()
    expect(container.parentElement).toBeNull()
    expect(floating.style.minHeight).toBe('')
  })

  it('settles even when a background webview suspends animation frames', () => {
    vi.useFakeTimers()
    const { dock, floating, container, animations } = flight()
    dock.capture()
    dock.move(floating as unknown as HTMLElement)
    vi.advanceTimersByTime(400)
    expect(container.parentElement).toBe(floating)
    expect(animations[0].onfinish).toBeNull()
  })

  it('respects reduced motion without delaying the handoff', () => {
    const { dock, floating, container } = flight(true)
    dock.capture()
    dock.move(floating as unknown as HTMLElement)
    expect(container.parentElement).toBe(floating)
    expect(container.animate).not.toHaveBeenCalled()
    expect(floating.style.minHeight).toBe('')
  })
})
