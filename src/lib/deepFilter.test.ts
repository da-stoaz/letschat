import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Track, type AudioProcessorOptions } from 'livekit-client'
import { NoiseFilterProcessor } from './deepFilter'

const createWorklet = vi.hoisted(() => vi.fn())
vi.mock('@workadventure/noise-suppression/deepfilternet', () => ({ createDeepFilterNetAudioWorklet: createWorklet }))

function setup(ready: Promise<unknown> = Promise.resolve()) {
  const port = new EventTarget() as EventTarget & { close: ReturnType<typeof vi.fn> }
  port.close = vi.fn()
  const node = { port, onprocessorerror: null as (() => void) | null }
  const worklet = { node, ready, dispose: vi.fn() }
  createWorklet.mockResolvedValue(worklet)
  const output = { stop: vi.fn() }
  const source = { connect: vi.fn(() => ({ connect: vi.fn() })), disconnect: vi.fn() }
  const context = {
    state: 'running', resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    createMediaStreamSource: vi.fn(() => source),
    createMediaStreamDestination: vi.fn(() => ({ stream: { getAudioTracks: () => [output] } })),
  }
  const AudioContext = vi.fn(function () { return context })
  vi.stubGlobal('AudioContext', AudioContext)
  vi.stubGlobal('MediaStream', class {})
  const track = { stop: vi.fn() }
  const options = { kind: Track.Kind.Audio, track } as unknown as AudioProcessorOptions
  const fail = vi.fn()
  const processor = new NoiseFilterProcessor(fail)
  return { processor, options, fail, context, AudioContext, worklet, source, output, track }
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('DeepFilterNet microphone processing', () => {
  it('waits for the actual model, uses 48 kHz, and releases resources without stopping the microphone', async () => {
    let resolve!: () => void
    const { processor, options, context, AudioContext, worklet, source, output, track } = setup(new Promise<void>(done => { resolve = done }))
    const init = processor.init(options)
    await vi.waitFor(() => expect(createWorklet).toHaveBeenCalledTimes(1))
    expect(processor.processedTrack).toBeUndefined()
    expect(source.connect).not.toHaveBeenCalled()
    resolve()
    await init
    expect(AudioContext).toHaveBeenCalledWith({ sampleRate: 48_000, sinkId: { type: 'none' } })
    expect(processor.processedTrack).toBe(output)
    await processor.destroy()
    expect(worklet.dispose).toHaveBeenCalledOnce()
    expect(worklet.node.port.close).toHaveBeenCalledOnce()
    expect(output.stop).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(track.stop).not.toHaveBeenCalled()
  })

  it('cleans up after model initialization fails', async () => {
    let reject!: (reason: Error) => void
    const { processor, options, worklet, context } = setup(new Promise<void>((_, fail) => { reject = fail }))
    const init = processor.init(options)
    const rejected = expect(init).rejects.toThrow('Bad model')
    await vi.waitFor(() => expect(createWorklet).toHaveBeenCalledOnce())
    reject(new Error('Bad model'))
    await rejected
    expect(processor.processedTrack).toBeUndefined()
    expect(worklet.dispose).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('reports worklet errors and overload, and detaches error listeners on disposal', async () => {
    const { processor, options, worklet, fail } = setup()
    await processor.init(options)
    worklet.node.port.dispatchEvent(new MessageEvent('message', { data: { type: 'error' } }))
    expect(fail).toHaveBeenCalledOnce()
    createWorklet.mock.calls[0][1].onOverload(0.8)
    expect(fail).toHaveBeenLastCalledWith('DeepFilterNet cannot keep up on this device. Try RNNoise instead.')
    await processor.destroy()
    worklet.node.port.dispatchEvent(new MessageEvent('message', { data: { type: 'error' } }))
    expect(fail).toHaveBeenCalledTimes(2)
    expect(worklet.node.onprocessorerror).toBeNull()
  })
})
