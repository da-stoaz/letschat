import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParticipantEvent, Track, TrackEvent, type Room } from 'livekit-client'
import { useMediaDeviceStore } from '../stores/mediaDeviceStore'
import { watchNoiseFilter } from './noiseFilter'

const mocks = vi.hoisted(() => ({ init: vi.fn(async () => {}), destroy: vi.fn(async () => {}), failures: [] as (() => void)[] }))
vi.mock('./rnnoise', () => ({
  NoiseFilterProcessor: class {
    name = 'letschat-rnnoise'
    destroy = mocks.destroy
    constructor(fail: () => void) { mocks.failures.push(fail) }
  },
}))
vi.mock('./deepFilter', () => ({
  NoiseFilterProcessor: class {
    name = 'letschat-deepfilternet'
    destroy = mocks.destroy
    constructor(fail: () => void) { mocks.failures.push(fail) }
  },
}))
class Events extends EventTarget {
  on(event: string, callback: () => void) { this.addEventListener(event, callback); return this }
  off(event: string, callback: () => void) { this.removeEventListener(event, callback); return this }
  emit(event: string) { this.dispatchEvent(new Event(event)) }
}
function setup() {
  const track = Object.assign(new Events(), {
    isMuted: false,
    processor: undefined as { name: string; destroy: () => Promise<void> } | undefined,
    getProcessor() { return this.processor },
    setProcessor: vi.fn(async function (this: typeof track, processor: NonNullable<typeof track.processor>) {
      await mocks.init()
      this.processor = processor
    }),
    stopProcessor: vi.fn(async function (this: typeof track) { await this.processor?.destroy(); this.processor = undefined }),
  })
  const participant = Object.assign(new Events(), { current: track as typeof track | undefined, getTrackPublication(source: Track.Source) {
    expect(source).toBe(Track.Source.Microphone)
    return { audioTrack: this.current }
  } })
  const room = { localParticipant: participant } as unknown as Room
  const report = vi.fn()
  const dispose = watchNoiseFilter(room, report)
  disposers.push(dispose)
  return { track, participant, room, report, dispose }
}
const disposers: (() => void)[] = []
beforeEach(() => {
  vi.clearAllMocks()
  mocks.failures.length = 0
  mocks.init.mockImplementation(async () => {})
  useMediaDeviceStore.setState({ noiseFilterEnabled: true, noiseFilterModel: 'rnnoise' })
  vi.stubGlobal('AudioWorkletNode', class {})
  vi.stubGlobal('AudioContext', class {})
})
afterEach(async () => {
  disposers.splice(0).forEach(dispose => dispose())
  await new Promise(resolve => setTimeout(resolve, 0))
  vi.unstubAllGlobals()
})

describe('noise suppression on the actual microphone', () => {
  it('reports active only after attachment and removes the processor when disabled', async () => {
    const { track, report } = setup()
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ status: 'active', error: null }))
    expect(track.setProcessor).toHaveBeenCalledTimes(1)
    useMediaDeviceStore.getState().setNoiseFilterEnabled(false)
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ status: 'off', error: null }))
    expect(track.stopProcessor).toHaveBeenCalledTimes(1)
  })

  it('does not leave filtering on when disabled during model loading', async () => {
    let finish!: () => void
    mocks.init.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const { track, report } = setup()
    await vi.waitFor(() => expect(track.setProcessor).toHaveBeenCalledTimes(1))
    expect(report).toHaveBeenLastCalledWith({ status: 'loading', error: null })
    useMediaDeviceStore.getState().setNoiseFilterEnabled(false)
    finish()
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ status: 'off', error: null }))
    expect(track.getProcessor()).toBeUndefined()
    expect(report.mock.calls.some(([state]) => state.status === 'active')).toBe(false)
  })

  it('waits for a mic, follows replacement, and reflects mute/unmute and restart', async () => {
    const { participant, track, report } = setup()
    track.isMuted = true
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ status: 'idle', error: null }))
    expect(track.setProcessor).not.toHaveBeenCalled()
    track.isMuted = false
    track.emit(TrackEvent.Unmuted)
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ status: 'active', error: null }))
    track.emit(TrackEvent.Restarted)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(track.setProcessor).toHaveBeenCalledTimes(1)
    track.emit(TrackEvent.Ended)
    expect(report).toHaveBeenLastCalledWith({ status: 'idle', error: null })
    participant.current = undefined
    participant.emit(ParticipantEvent.LocalTrackUnpublished)
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ status: 'idle', error: null }))
    const replacement = Object.assign(new Events(), {
      isMuted: false, processor: undefined, getProcessor: track.getProcessor,
      setProcessor: track.setProcessor, stopProcessor: track.stopProcessor,
    })
    participant.current = replacement
    participant.emit(ParticipantEvent.LocalTrackPublished)
    await vi.waitFor(() => expect(track.setProcessor).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ status: 'active', error: null }))
    mocks.failures[0]() // A late error from the old mic must not disable its replacement.
    expect(report).toHaveBeenLastCalledWith({ status: 'active', error: null })
  })

  it('reports initialization failure and allows an explicit retry', async () => {
    mocks.init.mockRejectedValueOnce(new Error('WASM unavailable'))
    const { track, report } = setup()
    await vi.waitFor(() => expect(report.mock.lastCall?.[0].status).toBe('error'))
    expect(track.getProcessor()).toBeUndefined()
    useMediaDeviceStore.getState().setNoiseFilterEnabled(false)
    useMediaDeviceStore.getState().setNoiseFilterEnabled(true)
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith({ status: 'active', error: null }))
  })

  it('restores raw audio and exposes a worklet failure instead of claiming active', async () => {
    const { track, report } = setup()
    await vi.waitFor(() => expect(report.mock.lastCall?.[0].status).toBe('active'))
    mocks.failures[0]()
    await vi.waitFor(() => expect(track.getProcessor()).toBeUndefined())
    expect(report.mock.lastCall?.[0].status).toBe('error')
  })

  it('serializes StrictMode cleanup/remount and ignores late results after hangup', async () => {
    let finish!: () => void
    mocks.init.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const { room, track, report, dispose } = setup()
    await vi.waitFor(() => expect(track.setProcessor).toHaveBeenCalledTimes(1))
    dispose()
    const replacementReport = vi.fn()
    disposers.push(watchNoiseFilter(room, replacementReport))
    finish()
    await vi.waitFor(() => expect(replacementReport.mock.lastCall?.[0].status).toBe('active'))
    expect(report.mock.calls.some(([state]) => state.status === 'active')).toBe(false)
    expect(track.setProcessor).toHaveBeenCalledTimes(2)
  })

  it('does not show active on unsupported runtimes', async () => {
    vi.stubGlobal('AudioWorkletNode', undefined)
    const { track, report } = setup()
    await vi.waitFor(() => expect(report.mock.lastCall?.[0].status).toBe('error'))
    expect(track.setProcessor).not.toHaveBeenCalled()
  })

  it('switches both ways during a call and ignores errors from the previous model', async () => {
    const { track, report } = setup()
    await vi.waitFor(() => expect(report.mock.lastCall?.[0].status).toBe('active'))
    useMediaDeviceStore.getState().setNoiseFilterModel('deepfilternet')
    expect(report.mock.lastCall?.[0].status).toBe('loading')
    await vi.waitFor(() => expect(track.getProcessor()?.name).toBe('letschat-deepfilternet'))
    mocks.failures[0]()
    expect(report.mock.lastCall?.[0].status).toBe('active')
    useMediaDeviceStore.getState().setNoiseFilterModel('rnnoise')
    await vi.waitFor(() => expect(track.getProcessor()?.name).toBe('letschat-rnnoise'))
    expect(track.stopProcessor).toHaveBeenCalledTimes(2)
    expect(track.setProcessor).toHaveBeenCalledTimes(3)
  })

  it('discards an in-flight model when the user changes the selection again', async () => {
    let finish!: () => void
    mocks.init.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const { track, report } = setup()
    await vi.waitFor(() => expect(track.setProcessor).toHaveBeenCalledTimes(1))
    useMediaDeviceStore.getState().setNoiseFilterModel('deepfilternet')
    finish()
    await vi.waitFor(() => expect(report.mock.lastCall?.[0].status).toBe('active'))
    expect(track.getProcessor()?.name).toBe('letschat-deepfilternet')
    expect(track.stopProcessor).toHaveBeenCalledTimes(1)
  })

  it('keeps raw audio after a model load fails and recovers by selecting RNNoise', async () => {
    const { track, report } = setup()
    await vi.waitFor(() => expect(report.mock.lastCall?.[0].status).toBe('active'))
    mocks.init.mockRejectedValueOnce(new Error('Model download failed'))
    useMediaDeviceStore.getState().setNoiseFilterModel('deepfilternet')
    await vi.waitFor(() => expect(report.mock.lastCall?.[0].status).toBe('error'))
    expect(track.getProcessor()).toBeUndefined()
    useMediaDeviceStore.getState().setNoiseFilterModel('rnnoise')
    await vi.waitFor(() => expect(report.mock.lastCall?.[0].status).toBe('active'))
    expect(track.getProcessor()?.name).toBe('letschat-rnnoise')
  })
})
