import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineVideo } from './inlineVideoSession'

class FakeVideo {
  src = ''
  ended = false
  currentTime = 0
  loads = 0
  private listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
  pause(): void {}
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
  load(): void {
    this.loads += 1
  }
}

let observerCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null

describe('attachInlineVideo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof observerCallback) { observerCallback = callback }
      observe(): void {}
      disconnect(): void {}
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const attach = (video: FakeVideo, startAt: number, onStop: (position: number) => void) =>
    attachInlineVideo(video as unknown as HTMLVideoElement, 'https://storage.test/v.mp4', startAt, onStop)

  it('survives a StrictMode mount → cleanup → mount with a playable source', () => {
    const video = new FakeVideo()
    attach(video, 0, vi.fn())()
    expect(video.src).toBe('')
    attach(video, 0, vi.fn())
    expect(video.src).toBe('https://storage.test/v.mp4')
  })

  it('aborts the download on teardown by detaching the source', () => {
    const video = new FakeVideo()
    const teardown = attach(video, 12.5, vi.fn())
    expect(video.src).toBe('https://storage.test/v.mp4#t=12.5')
    teardown()
    expect(video.src).toBe('')
    expect(video.loads).toBe(1)
  })

  it('stops after a long pause, when scrolled away, and resumes from the start after the end', () => {
    const video = new FakeVideo()
    const onStop = vi.fn()
    attach(video, 0, onStop)

    video.currentTime = 2
    video.emit('pause')
    video.emit('play')
    vi.advanceTimersByTime(60_000)
    expect(onStop).not.toHaveBeenCalled()

    video.emit('pause')
    vi.advanceTimersByTime(10_000)
    expect(onStop).toHaveBeenLastCalledWith(2)

    observerCallback?.([{ isIntersecting: false }])
    expect(onStop).toHaveBeenCalledTimes(2)

    video.ended = true
    video.emit('ended')
    expect(onStop).toHaveBeenLastCalledWith(0)
  })
})
