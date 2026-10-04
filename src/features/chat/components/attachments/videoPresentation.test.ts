import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InlineVideo } from './InlineVideo'
import { observeVideoPresentation, videoSize } from './videoPresentation'

class Media extends EventTarget {
  readyState = 0
  videoWidth = 0
  videoHeight = 0
  paused = false
  // Simulates browsers that expose the API but never present a callback.
  requestVideoFrameCallback = vi.fn()
  emit(name: string) { this.dispatchEvent(new Event(name)) }
}

function setup() {
  const video = new Media()
  const callbacks = { onFrame: vi.fn(), onBuffering: vi.fn(), onRatio: vi.fn(), onMissingPicture: vi.fn() }
  const cleanup = observeVideoPresentation(video as unknown as HTMLVideoElement, callbacks)
  return { video, callbacks, cleanup }
}

describe('video presentation', () => {
  afterEach(() => { vi.useRealTimers() })
  it('renders controls before any frame event and keeps video out of intrinsic layout sizing', () => {
    const markup = renderToStaticMarkup(createElement(InlineVideo, {
      url: '/video.mp4', storageKey: 'video', fileName: 'video.mp4', startAt: 0, onStop: () => {},
    }))
    const video = markup.match(/<video[^>]*>/)?.[0] ?? ''
    expect(video).toContain('controls=""')
    expect(video).toContain('absolute inset-0')
    expect(markup).not.toContain('dvh *')
  })

  it('clears the spinner and reveals decoded media without a compositor callback', () => {
    const { video, callbacks } = setup()
    video.videoWidth = 640
    video.videoHeight = 480
    video.readyState = 2
    video.emit('playing')
    expect(callbacks.onBuffering).toHaveBeenLastCalledWith(false)
    expect(callbacks.onFrame).toHaveBeenCalledOnce()
    expect(video.requestVideoFrameCallback).not.toHaveBeenCalled()
  })

  it('uses real dimensions after missing/wrong poster metadata, including HLS resolution changes', () => {
    const { video, callbacks, cleanup } = setup()
    video.emit('loadedmetadata')
    expect(callbacks.onRatio).not.toHaveBeenCalled()
    video.videoWidth = 1080
    video.videoHeight = 1920
    video.emit('resize')
    expect(callbacks.onRatio).toHaveBeenLastCalledWith(9 / 16)
    video.videoWidth = 1440
    video.videoHeight = 1080
    video.emit('resize')
    expect(callbacks.onRatio).toHaveBeenLastCalledWith(4 / 3)
    cleanup()
    video.emit('loadeddata')
    expect(callbacks.onFrame).not.toHaveBeenCalled()
  })

  it('ends buffering on pause or media progress, including audio before video', () => {
    const { video, callbacks } = setup()
    video.emit('waiting')
    expect(callbacks.onBuffering).toHaveBeenLastCalledWith(true)
    video.emit('pause')
    expect(callbacks.onBuffering).toHaveBeenLastCalledWith(false)
    video.emit('waiting')
    video.readyState = 4
    video.emit('timeupdate')
    expect(callbacks.onBuffering).toHaveBeenLastCalledWith(false)
  })

  it('explains audio-only playback and clears the notice when video dimensions arrive', () => {
    vi.useFakeTimers()
    const { video, callbacks, cleanup } = setup()
    video.readyState = 4
    video.emit('playing')
    vi.advanceTimersByTime(5000)
    expect(callbacks.onMissingPicture).toHaveBeenLastCalledWith(true)
    video.videoWidth = 640
    video.videoHeight = 480
    video.emit('resize')
    expect(callbacks.onMissingPicture).toHaveBeenLastCalledWith(false)
    cleanup()
  })

  it('bounds portrait and landscape sizing without CSS multiplication or invalid ratios', () => {
    expect(videoSize(9 / 16, 60)).toEqual({ aspectRatio: 9 / 16, width: 'min(100%, 33.75dvh)' })
    expect(videoSize(4 / 3, 60)).toEqual({ aspectRatio: 4 / 3, width: 'min(100%, 80dvh)' })
    expect(videoSize(NaN, 60)).toEqual(videoSize(16 / 9, 60))
    expect(videoSize(0, 60)).toEqual(videoSize(16 / 9, 60))
  })
})
