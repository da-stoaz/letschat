import { createDeepFilterNetAudioWorklet, type DeepFilterNetAudioWorkletHandle } from '@workadventure/noise-suppression/deepfilternet'
import { Track, type AudioProcessorOptions, type TrackProcessor } from 'livekit-client'

/** Full-band 48 kHz DeepFilterNet3; all assets come from the client build. */
export class NoiseFilterProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'letschat-deepfilternet'
  processedTrack?: MediaStreamTrack
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private worklet?: DeepFilterNetAudioWorkletHandle
  private onFailure: (message?: string) => void

  constructor(onFailure: (message?: string) => void) { this.onFailure = onFailure }

  async init({ track }: AudioProcessorOptions) {
    const context = new AudioContext({ sampleRate: 48_000, sinkId: { type: 'none' } } as AudioContextOptions)
    this.context = context
    try {
      await context.resume()
      if (context.state !== 'running') throw new Error('Audio processing could not start.')
      const worklet = await createDeepFilterNetAudioWorklet(context, {
        onOverload: () => this.onFailure('DeepFilterNet cannot keep up on this device. Try RNNoise instead.'),
      })
      this.worklet = worklet
      worklet.node.onprocessorerror = () => this.onFailure()
      worklet.node.port.addEventListener('message', this.onMessage)
      // Readiness includes model initialization, not just node creation.
      await worklet.ready
      const destination = context.createMediaStreamDestination()
      this.processedTrack = destination.stream.getAudioTracks()[0]
      this.source = context.createMediaStreamSource(new MediaStream([track]))
      this.source.connect(worklet.node).connect(destination)
      // Never connect the microphone to the user's speakers.
    } catch (error) {
      await this.destroy()
      throw error
    }
  }

  private onMessage = (event: MessageEvent<{ type: string }>) => {
    if (event.data.type === 'error') this.onFailure()
  }

  async restart(options: AudioProcessorOptions) {
    await this.destroy()
    try { await this.init(options) }
    catch (error) { this.onFailure(); throw error }
  }

  async destroy() {
    this.source?.disconnect()
    if (this.worklet) {
      this.worklet.node.onprocessorerror = null
      this.worklet.node.port.removeEventListener('message', this.onMessage)
      this.worklet.dispose()
      this.worklet.node.port.close()
    }
    this.processedTrack?.stop()
    if (this.context && this.context.state !== 'closed') await this.context.close()
    this.source = undefined
    this.worklet = undefined
    this.processedTrack = undefined
    this.context = undefined
  }
}
