import { watchAudioPlayback } from './audioPlayback'

let sharedContext: AudioContext | undefined
let users = 0

/** Amplify before the HTML audio sink, so setSinkId still selects the output device. */
export function createCallAudioPlayback(track: MediaStreamTrack, element: HTMLAudioElement, volume: number, onBlocked: (blocked: boolean) => void) {
  const context = sharedContext ??= new AudioContext()
  const stream = new MediaStream([track])
  const source = context.createMediaStreamSource(stream)
  const gain = context.createGain()
  const output = context.createMediaStreamDestination()
  gain.gain.value = volume
  source.connect(gain).connect(output)
  users++

  // Keep Chrome's remote WebRTC playout active, but only the processed sink audible.
  // This element is not registered with LiveKit, whose startAudio() unmutes sinks.
  const incoming = new Audio()
  incoming.muted = true
  incoming.srcObject = stream
  void incoming.play().catch(() => undefined)
  element.srcObject = output.stream
  element.volume = 1
  element.muted = volume === 0

  let disposed = false
  let elementBlocked = false
  const report = () => { if (!disposed) onBlocked(elementBlocked || context.state !== 'running') }
  const playback = watchAudioPlayback(element, blocked => { elementBlocked = blocked; report() })
  context.addEventListener('statechange', report)

  return {
    setVolume(value: number) {
      // Silence immediately on deafen; smooth other changes to avoid clicks.
      gain.gain.cancelScheduledValues(context.currentTime)
      if (value === 0) gain.gain.setValueAtTime(0, context.currentTime)
      else gain.gain.setTargetAtTime(value, context.currentTime, 0.01)
      element.muted = value === 0
    },
    retry() {
      // Both calls must start in the button's user gesture. A suspended context's
      // resume promise may stay pending, so report its state without awaiting it.
      void context.resume().then(report, report)
      playback.retry()
      report()
    },
    dispose() {
      disposed = true
      playback.dispose()
      context.removeEventListener('statechange', report)
      incoming.pause()
      incoming.srcObject = null
      element.pause()
      element.srcObject = null
      source.disconnect()
      gain.disconnect()
      output.stream.getTracks().forEach(track => track.stop())
      if (--users === 0) {
        sharedContext = undefined
        void context.close().catch(() => undefined)
      }
    },
  }
}
