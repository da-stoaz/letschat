import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor'
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import { Track, type AudioProcessorOptions, type TrackProcessor } from 'livekit-client'

let model: Promise<ArrayBuffer> | undefined
function loadModel() {
  return model ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((error) => {
    model = undefined // A temporary download failure must not poison later attempts.
    throw error
  })
}

/** Same-origin, single-threaded RNNoise; works with self-hosted LiveKit, without SAB. */
export class NoiseFilterProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'letschat-rnnoise'
  processedTrack?: MediaStreamTrack
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private node?: RnnoiseWorkletNode

  private onFailure: () => void

  constructor(onFailure: () => void) { this.onFailure = onFailure }

  async init({ track }: AudioProcessorOptions) {
    // RNNoise requires 48 kHz. A dedicated context resamples even 44.1 kHz
    // microphones, without changing the room's playback context or device.
    // Chromium's silent sink keeps its clock running without opening speakers.
    // WebKit ignores this optional dictionary member.
    const context = new AudioContext({ sampleRate: 48_000, sinkId: { type: 'none' } } as AudioContextOptions)
    this.context = context
    try {
      const [wasmBinary] = await Promise.all([loadModel(), context.audioWorklet.addModule(workletUrl), context.resume()])
      if (context.state !== 'running') throw new Error('Audio processing could not start.')
      const node = new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 })
      this.node = node
      node.channelCount = 1
      node.channelCountMode = 'explicit'
      node.onprocessorerror = () => this.onFailure()
      const destination = context.createMediaStreamDestination()
      this.processedTrack = destination.stream.getAudioTracks()[0]
      this.source = context.createMediaStreamSource(new MediaStream([track]))
      this.source.connect(node).connect(destination)
      // No connection to context.destination: never monitor the user's own mic.
    } catch (error) {
      await this.destroy()
      throw error
    }
  }

  async restart(options: AudioProcessorOptions) {
    await this.destroy()
    try { await this.init(options) }
    catch (error) { this.onFailure(); throw error }
  }

  async destroy() {
    this.source?.disconnect()
    if (this.node) {
      this.node.onprocessorerror = null
      this.node.destroy()
      this.node.port.close()
      this.node.disconnect()
    }
    this.processedTrack?.stop()
    if (this.context && this.context.state !== 'closed') await this.context.close()
    this.source = undefined
    this.node = undefined
    this.processedTrack = undefined
    this.context = undefined
  }
}
