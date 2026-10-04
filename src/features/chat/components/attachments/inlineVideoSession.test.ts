import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineVideo } from './inlineVideoSession'

const hlsMock = vi.hoisted(() => ({ created: 0, destroyed: 0, events: new Map<string, (...args: unknown[]) => void>() }))
vi.mock('hls.js', () => ({ default: class {
  static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' }
  static isSupported() { return true }
  constructor() { hlsMock.created++ }
  on(event: string, handler: (...args: unknown[]) => void) { hlsMock.events.set(event, handler) }
  loadSource() {}
  attachMedia() {}
  destroy() { hlsMock.destroyed++ }
} }))

class FakeVideo {
  src = ''
  ended = false
  currentTime = 0
  loads = 0
  plays = 0
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
  play(): Promise<void> {
    this.plays += 1
    return Promise.resolve()
  }
  pause(): void {}
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
  canPlayType(): string { return '' }
  load(): void {
    this.loads += 1
  }
}

let observerCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null

describe('attachInlineVideo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    hlsMock.created = 0
    hlsMock.destroyed = 0
    hlsMock.events.clear()
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
    expect(video.plays).toBe(2)
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
  it('destroys HLS on unmount and ignores an import that resolves after teardown', async () => {
    const video = new FakeVideo()
    const setup = () => attachInlineVideo(video as unknown as HTMLVideoElement, '/master.m3u8', 12, vi.fn(), { hls: true })
    setup()()
    await vi.dynamicImportSettled()
    expect(hlsMock.created).toBe(0)
    const teardown = setup()
    await vi.dynamicImportSettled()
    expect(hlsMock.created).toBe(1)
    hlsMock.events.get('manifest')?.()
    expect(video.plays).toBe(1)
    video.emit('loadedmetadata')
    expect(video.currentTime).toBe(12)
    teardown()
    expect(hlsMock.destroyed).toBe(1)
    expect(video.src).toBe('')
  })

  it('surfaces fatal streaming errors and keeps a pop-out alive offscreen or paused', async () => {
    const video = new FakeVideo()
    const stop = vi.fn()
    const error = vi.fn()
    const teardown = attachInlineVideo(video as unknown as HTMLVideoElement, '/master.m3u8', 0, stop, { hls: true, persistent: true, onError: error })
    await vi.dynamicImportSettled()
    video.emit('pause')
    vi.advanceTimersByTime(60_000)
    observerCallback?.([{ isIntersecting: false }])
    expect(stop).not.toHaveBeenCalled()
    hlsMock.events.get('error')?.('error', { fatal: true })
    expect(error).toHaveBeenCalledOnce()
    expect(hlsMock.destroyed).toBe(1)
    teardown()
  })

  it('uses native HLS without loading hls.js and exposes blocked autoplay', async () => {
    const video = new FakeVideo()
    video.canPlayType = () => 'probably'
    video.play = () => Promise.reject(new Error('blocked'))
    const blocked = vi.fn()
    const teardown = attachInlineVideo(video as unknown as HTMLVideoElement, '/master.m3u8', 10, vi.fn(), { hls: true, onBlocked: blocked })
    await Promise.resolve()
    expect(video.src).toBe('/master.m3u8')
    expect(hlsMock.created).toBe(0)
    expect(blocked).toHaveBeenCalledOnce()
    teardown()
  })

})
