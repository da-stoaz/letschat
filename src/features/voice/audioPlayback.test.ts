import { describe, expect, it, vi } from 'vitest'
import { watchAudioPlayback } from './audioPlayback'

function sink() {
  const events = new EventTarget()
  return { play: vi.fn(async () => {}), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), events }
}

describe('call audio playback recovery', () => {
  it('reports a blocked sink and retries that sink synchronously from a tap', async () => {
    const element = sink()
    const blocked = vi.fn()
    element.play.mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
    const playback = watchAudioPlayback(element, blocked)
    playback.retry()
    await vi.waitFor(() => expect(blocked).toHaveBeenLastCalledWith(true))
    playback.retry()
    expect(element.play).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false))
  })

  it('keeps recovery available when retry fails again', async () => {
    const element = sink()
    element.play.mockRejectedValue(new Error('Playback failed'))
    const blocked = vi.fn()
    const playback = watchAudioPlayback(element, blocked)
    playback.retry()
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledWith(true))
    playback.retry()
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledTimes(2))
    expect(blocked).toHaveBeenLastCalledWith(true)
  })

  it('clears recovery when the attached track starts playing', () => {
    const element = sink()
    const blocked = vi.fn()
    watchAudioPlayback(element, blocked)
    element.events.dispatchEvent(new Event('playing'))
    expect(blocked).toHaveBeenCalledWith(false)
  })

  it('ignores late failures after a track is removed or the call ends', async () => {
    const element = sink()
    let reject!: (error: Error) => void
    element.play.mockReturnValue(new Promise<void>((_resolve, no) => { reject = no }))
    const blocked = vi.fn()
    const playback = watchAudioPlayback(element, blocked)
    playback.retry()
    playback.dispose()
    reject(new Error('Old track'))
    await Promise.resolve()
    element.events.dispatchEvent(new Event('playing'))
    expect(blocked).not.toHaveBeenCalled()
  })
})
